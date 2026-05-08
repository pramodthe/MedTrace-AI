import base64
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from copilotkit import LangGraphAGUIAgent
from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from agent import graph
from voice_handler import VoicePipeline
from dotenv import load_dotenv
load_dotenv()

app = FastAPI(title="Predictive State Updates Agent Backend")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add the LangGraph AG-UI endpoint
add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="predictive_state_updates",
        description="Predictive State Updates LangGraph Agent",
        graph=graph,
    ),
    path="/",
)

class VoiceChatRequest(BaseModel):
    text: str
    document: str | None = None
    thread_id: str | None = "voice_session"

@app.post("/api/voice-chat")
async def voice_chat_endpoint(request: VoiceChatRequest):
    """
    HTTP POST endpoint for text-based voice agent requests.
    """
    pipeline = VoicePipeline()
    agent_result = await pipeline.run_agent_pipeline(
        text=request.text,
        document=request.document,
        thread_id=request.thread_id
    )
    return {
        "verbal_response": agent_result["verbal_response"],
        "document": agent_result["document"]
    }

@app.websocket("/ws/voice")
async def websocket_voice_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time voice-to-voice interaction.
    """
    await websocket.accept()
    print("[VoiceWS] Connection accepted.")
    pipeline = VoicePipeline()
    
    try:
        while True:
            # Receive raw binary audio bytes from the client
            audio_bytes = await websocket.receive_bytes()
            print(f"[VoiceWS] Received audio chunk: {len(audio_bytes)} bytes.")
            
            # 1. Transcribe the audio chunk
            transcribed_text = await pipeline.transcribe_audio(audio_bytes)
            print(f"[VoiceWS] Transcribed: '{transcribed_text}'")
            
            if not transcribed_text or len(transcribed_text.strip()) < 2:
                await websocket.send_json({"type": "silent", "message": "No voice detected."})
                continue
                
            # 2. Run through the LangGraph co-editor agent
            agent_result = await pipeline.run_agent_pipeline(transcribed_text)
            verbal_response = agent_result["verbal_response"]
            updated_document = agent_result["document"]
            print(f"[VoiceWS] Agent Response: '{verbal_response}'")
            
            # 3. Generate speech audio bytes
            speech_bytes = await pipeline.generate_speech(verbal_response)
            audio_base64 = base64.b64encode(speech_bytes).decode("utf-8")
            
            # 4. Send combined response to the client
            await websocket.send_json({
                "type": "response",
                "user_text": transcribed_text,
                "agent_text": verbal_response,
                "document": updated_document,
                "audio": audio_base64
            })
    except WebSocketDisconnect:
        print("[VoiceWS] Connection disconnected.")
    except Exception as e:
        print(f"[VoiceWS] Error in voice pipeline: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
