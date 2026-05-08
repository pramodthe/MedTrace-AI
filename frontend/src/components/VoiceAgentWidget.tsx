import React, { useState, useRef, useEffect } from "react";
import MarkdownIt from "markdown-it";

interface VoiceAgentWidgetProps {
  editor: any;
  setAgentState: (s: any) => void;
  setCurrentDocument: (s: string) => void;
}

const md = new MarkdownIt({
  typographer: true,
  html: true,
});

export const VoiceAgentWidget: React.FC<VoiceAgentWidgetProps> = ({
  editor,
  setAgentState,
  setCurrentDocument,
}) => {
  const [isActive, setIsActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [userSubtitle, setUserSubtitle] = useState("");
  const [agentSubtitle, setAgentSubtitle] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const recognitionRef = useRef<any>(null);
  const isSpeakingRef = useRef(false);
  const isActiveRef = useRef(false);

  // Keep refs synchronized to avoid closure stale state issues in callback events
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
    isActiveRef.current = isActive;
  }, [isSpeaking, isActive]);

  // Setup browser SpeechRecognition
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setErrorMsg("Web Speech API is not supported in this browser. Please use Google Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setIsListening(true);
      setErrorMsg("");
    };

    recognition.onend = () => {
      setIsListening(false);
      // Restart listening automatically ONLY if hands-free is active and AI is not speaking
      if (isActiveRef.current && !isSpeakingRef.current && !isProcessing) {
        try {
          recognition.start();
        } catch (e) {
          console.log("Recognition start suppressed:", e);
        }
      }
    };

    recognition.onresult = async (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (!transcript || transcript.trim().length < 2) return;

      setUserSubtitle(transcript);
      setIsProcessing(true);
      
      // Stop recognition while processing to prevent duplicate events
      try {
        recognition.stop();
      } catch (e) {}

      await handleVoiceQuery(transcript);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        setErrorMsg("Microphone permission denied.");
        setIsActive(false);
      }
    };

    return () => {
      try {
        recognition.abort();
      } catch (e) {}
    };
  }, [editor]);

  // Transmit transcribed speech to the FastAPI backend and speak the response
  const handleVoiceQuery = async (query: string) => {
    try {
      const response = await fetch("http://localhost:8000/api/voice-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: query }),
      });

      if (!response.ok) {
        throw new Error("Failed to process agent request.");
      }

      const data = await response.json();
      setIsProcessing(false);

      if (data.document && editor) {
        const htmlContent = md.render(data.document);
        editor.commands.setContent(htmlContent);
        setCurrentDocument(data.document);
        setAgentState({ document: data.document });
      }

      setAgentSubtitle(data.verbal_response);
      await speak(data.verbal_response);

    } catch (err: any) {
      console.error("Voice chat request failed:", err);
      setErrorMsg("Failed to connect to AI backend.");
      setIsProcessing(false);
      // Resume listening on error
      if (isActiveRef.current) {
        try {
          recognitionRef.current?.start();
        } catch (e) {}
      }
    }
  };

  // Convert text response to speech locally using SynthesisUtterance
  const speak = (text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) {
        resolve();
        return;
      }

      // Cancel any ongoing speaking
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      
      // Try to select a high-quality native English voice if available
      const voices = window.speechSynthesis.getVoices();
      const preferedVoice = voices.find(
        (v) => v.name.includes("Google US English") || v.name.includes("Samantha") || v.lang === "en-US"
      );
      if (preferedVoice) {
        utterance.voice = preferedVoice;
      }

      utterance.onstart = () => {
        setIsSpeaking(true);
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        resolve();
        // Automatically resume listening for the user's turn
        if (isActiveRef.current) {
          setTimeout(() => {
            try {
              if (isActiveRef.current && !isSpeakingRef.current) {
                recognitionRef.current?.start();
              }
            } catch (e) {}
          }, 300);
        }
      };

      utterance.onerror = (e) => {
        console.error("Speech Synthesis Error:", e);
        setIsSpeaking(false);
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  };

  const toggleHandsFreeMode = async () => {
    if (isActive) {
      // Deactivate Voice Mode
      setIsActive(false);
      setIsListening(false);
      setIsSpeaking(false);
      setUserSubtitle("");
      setAgentSubtitle("");
      window.speechSynthesis?.cancel();
      try {
        recognitionRef.current?.stop();
      } catch (e) {}
    } else {
      // Activate Voice Mode
      setIsActive(true);
      setUserSubtitle("");
      setAgentSubtitle("Initialising hands-free voice mode...");
      
      // Welcome message to greet the user
      const greeting = "Hi! I am your AI co-editor. What would you like to write or modify today?";
      setAgentSubtitle(greeting);
      await speak(greeting);
    }
  };

  return (
    <div className="voice-widget-container">
      {/* Subtitles Fading Overlays */}
      {(userSubtitle || agentSubtitle || errorMsg) && (
        <div className="subtitles-overlay">
          {errorMsg && <div className="subtitle-box error-sub">{errorMsg}</div>}
          {userSubtitle && <div className="subtitle-box user-sub">🗣️ You: "{userSubtitle}"</div>}
          {agentSubtitle && <div className="subtitle-box agent-sub">🤖 AI: "{agentSubtitle}"</div>}
        </div>
      )}

      {/* Main Microphone Action Button */}
      <button
        className={`voice-action-btn ${isListening ? "active" : ""} ${isSpeaking ? "speaking" : ""} ${isProcessing ? "processing" : ""}`}
        onClick={toggleHandsFreeMode}
        title={isActive ? "Disable Hands-Free Voice" : "Enable Hands-Free Voice"}
      >
        <div className="btn-glow-ring"></div>
        {isListening ? (
          <div className="waveform-waves">
            <span></span>
            <span></span>
            <span></span>
          </div>
        ) : isSpeaking ? (
          <div className="speaking-wave">
            <span></span>
            <span></span>
            <span></span>
          </div>
        ) : isProcessing ? (
          <div className="voice-spinner"></div>
        ) : (
          <svg className="mic-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
          </svg>
        )}
      </button>
    </div>
  );
};
