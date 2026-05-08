# Implementation Plan: Hands-Free Conversational Voice Agent

We will transition the voice agent from a manual "Push-to-Talk" recorder to a fully **hands-free, continuous conversational loop** (like Alexa or Siri) that automatically speaks, listens, transcribes, and responds.

To fulfill the user's request for a **free, keyless** solution, we will implement this using the browser's native **Web Speech API** (`SpeechRecognition` and `SpeechSynthesis`).

---

## User Review Required

> [!IMPORTANT]
> **No API Keys Required (100% Free)**:
> - **Speech-to-Text (STT)**: Powered by `webkitSpeechRecognition`, which is built directly into Chrome, Safari, and Edge. It transcribes voice in real-time and automatically detects when the user finishes speaking (silence detection).
> - **Text-to-Speech (TTS)**: Powered by `window.speechSynthesis`, which converts text responses to speech locally using high-quality system voices with zero network latency.

---

## Proposed Changes

### 1. 🎨 Frontend Client (`/frontend`)

We will completely upgrade the Voice Agent widget to support hands-free continuous conversations.

#### [MODIFY] [VoiceAgentWidget.tsx](file:///Users/pramodthebe/Desktop/predictive_state_updates/frontend/src/components/VoiceAgentWidget.tsx)
- Upgrade the component to manage a robust state machine for continuous speech interaction:
  1. **Idle Mode**: Widget is ready to be activated.
  2. **Speaking Mode**: The AI is speaking its response out loud. Speech Recognition is paused to prevent the mic from transcribing the bot's own voice.
  3. **Listening Mode**: Speech Recognition is active. It transcribes user speech in real-time and detects when the user stops speaking.
- On receiving final transcribed input, it POSTs directly to the FastAPI agent backend to fetch the textual response and document edits.
- Once the text is returned:
  - The editor content updates with predictive highlights.
  - The browser speaks the summary response out loud.
  - Once the speech finishes, it automatically starts listening again!

---

### 2. 🐍 Backend API (`/backend`)

We will add a simple, fast HTTP endpoint to process conversational text and execute the LangGraph graph without WebSocket serialization overhead.

#### [MODIFY] [main.py](file:///Users/pramodthebe/Desktop/predictive_state_updates/backend/main.py)
- Create an `/api/voice-chat` POST endpoint that receives the transcribed text, runs it through the `VoicePipeline` orchestrator, and returns the agent's textual summary and updated document.

---

## Verification Plan

### Manual Verification
- Start the servers.
- Open [http://localhost:5174/](http://localhost:5174/).
- Click the floating microphone button to enter **Hands-free Voice Mode**.
- The bot will greet you: *"Hi! I am your co-editor. What would you like to write today?"*
- Speak naturally: *"Write a short pirate story."*
- Pause speaking. The app will automatically detect you finished, display your transcription, edit the document, and speak back to you out loud!
- Once it finishes speaking, it will automatically listen for your next instruction (fully hands-free!).
