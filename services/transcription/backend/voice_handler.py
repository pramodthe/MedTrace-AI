"""
Voice handler for real-time speech-to-speech interaction.
"""

import os
import uuid
from openai import OpenAI
from agent import graph, write_document_local

class VoicePipeline:
    """
    Orchestrates real-time speech transcription, agent reasoning, and text-to-speech generation.
    """
    def __init__(self):
        self.api_key = os.environ.get("OPENAI_API_KEY", None)
        self.base_url = os.environ.get("OPENAI_BASE_URL", None)
        
        # Initialize default client (with custom base URL e.g. TokenRouter)
        self.client = OpenAI(api_key=self.api_key, base_url=self.base_url)
        
        # Initialize fallback client pointing directly to OpenAI for audio endpoints if needed
        self.fallback_client = OpenAI(api_key=self.api_key, base_url="https://api.openai.com/v1")

    async def transcribe_audio(self, audio_bytes: bytes) -> str:
        """
        Transcribes incoming audio bytes and segments speakers (diarization) using Gemini 2.5 Flash.
        """
        import base64
        import httpx
        
        is_mp3 = (
            audio_bytes.startswith(b"ID3") or 
            audio_bytes.startswith(b"\xff\xfb") or 
            audio_bytes.startswith(b"\xff\xf3") or 
            audio_bytes.startswith(b"\xff\xf2")
        )
        mime_type = "audio/mp3" if is_mp3 else "audio/wav"
        
        gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not gemini_key:
            raise ValueError("GEMINI_API_KEY or GOOGLE_API_KEY is not configured in the environment.")
            
        try:
            base64_data = base64.b64encode(audio_bytes).decode("utf-8")
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}"
            
            payload = {
                "contents": [{
                    "parts": [
                        {
                            "inlineData": {
                                "mimeType": mime_type,
                                "data": base64_data
                            }
                        },
                        {
                            "text": (
                                "You are an expert medical transcriptionist. Transcribe the provided audio between a clinician and a patient. "
                                "Segment the conversation accurately into alternating speaker turns, labelling each line clearly as either "
                                "'Clinician: [speech]' or 'Patient: [speech]' based on who is speaking (speaker diarization). "
                                "Do not add any other commentary, introductions, or summaries. Return only the diarized transcription."
                            )
                        }
                    ]
                }]
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(url, json=payload, timeout=60.0)
                response.raise_for_status()
                result = response.json()
                
                transcript = result["candidates"][0]["content"]["parts"][0]["text"]
                print(f"[STT] Gemini Transcription successful:\n{transcript}")
                return transcript
        except Exception as e:
            print(f"[STT] Gemini Transcription failed: {e}")
            raise e

    async def generate_speech(self, text: str) -> bytes:
        """
        Converts text response to speech audio bytes using OpenAI TTS.
        """
        try:
            response = self.client.audio.speech.create(
                model="tts-1",
                voice="alloy",
                input=text,
                response_format="mp3"
            )
            return response.content
        except Exception as e:
            print(f"[TTS] Custom endpoint failed, trying fallback: {e}")
            try:
                response = self.fallback_client.audio.speech.create(
                    model="tts-1",
                    voice="alloy",
                    input=text,
                    response_format="mp3"
                )
                return response.content
            except Exception as fallback_err:
                print(f"[TTS] Fallback failed too: {fallback_err}. Returning empty speech content.")
                return b""

    async def run_agent_pipeline(self, text: str, document: str = None, thread_id: str = "voice_session") -> dict:
        """
        Passes user input through the compiled co-editor LangGraph graph and returns the verbal response and document updates.
        """
        # Configure thread for checkpointer memory Saver
        config = {"configurable": {"thread_id": thread_id}}
        
        # Load current state from the graph checkpointer
        state = await graph.aget_state(config)
        messages = list(state.values.get("messages", [])) if state.values else []
        
        # Prioritize live document text from frontend editor
        if document is None:
            document = state.values.get("document", "") if state.values else ""
        
        # Append new user message
        from langchain_core.messages import HumanMessage
        messages.append(HumanMessage(content=text))
        
        # Execute agent graph
        result_state = await graph.ainvoke({
            "messages": messages,
            "tools": [],
            "document": document
        }, config=config)
        
        # Extract verbal response from the newly generated assistant messages
        verbal_response = "I have updated the document."
        new_document = result_state.get("document", document)
        
        # Read the content of the last assistant message
        for msg in reversed(result_state.get("messages", [])):
            is_ai = False
            content = ""
            if isinstance(msg, dict):
                is_ai = msg.get("role") == "assistant" or msg.get("type") == "ai"
                content = msg.get("content", "")
            else:
                is_ai = getattr(msg, "type", None) == "ai" or getattr(msg, "role", None) == "assistant"
                content = getattr(msg, "content", "")
                
            if is_ai and content:
                verbal_response = content
                break
                
        return {
            "verbal_response": verbal_response,
            "document": new_document
        }
