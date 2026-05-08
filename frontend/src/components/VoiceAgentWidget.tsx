import React, { useState, useRef, useEffect } from "react";

interface VoiceAgentWidgetProps {
  editor: any;
  setCurrentDocument: (s: string) => void;
  setAgentState: (s: any) => void;
  onSessionCreated: (session: any) => void;
}

export const VoiceAgentWidget: React.FC<VoiceAgentWidgetProps> = ({
  editor,
  setCurrentDocument,
  setAgentState,
  onSessionCreated,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const startTimeRef = useRef<number>(0);

  // Web Audio Visualizer References
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Clean up timers and audio contexts on unmount
  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  // Format seconds to mm:ss
  const formatTime = (secs: number) => {
    const minutes = Math.floor(secs / 60);
    const seconds = secs % 60;
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  const startRecording = async () => {
    setErrorMsg("");
    audioChunksRef.current = [];
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
        const durationSecs = Math.round((Date.now() - startTimeRef.current) / 1000);
        const durationStr = formatTime(durationSecs);
        
        // Stop all audio tracks
        stream.getTracks().forEach((track) => track.stop());

        await uploadRecording(audioBlob, durationStr);
      };

      // Set up Web Audio Analyser for gorgeous canvas visualizer
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      setIsRecording(true);
      setRecordingTime(0);
      startTimeRef.current = Date.now();
      
      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

      mediaRecorder.start();
      drawVisualizer();

    } catch (err: any) {
      console.error("Failed to start recording:", err);
      setErrorMsg("Microphone access denied or unsupported.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      clearInterval(timerRef.current);
      setIsRecording(false);
      
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    }
  };

  // Render a gorgeous, fluid, real-time waveform on canvas
  const drawVisualizer = () => {
    if (!canvasRef.current || !analyserRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const renderFrame = () => {
      animationFrameRef.current = requestAnimationFrame(renderFrame);
      analyser.getByteFrequencyData(dataArray);

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const barWidth = (width / bufferLength) * 1.8;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const percent = dataArray[i] / 255;
        const barHeight = percent * height * 0.85;

        // Create a premium glowing blue/purple gradient
        const gradient = ctx.createLinearGradient(0, height / 2 - barHeight / 2, 0, height / 2 + barHeight / 2);
        gradient.addColorStop(0, "#3b82f6");
        gradient.addColorStop(0.5, "#8b5cf6");
        gradient.addColorStop(1, "#3b82f6");

        ctx.fillStyle = gradient;
        
        // Draw centered capsule bars for high-end Siri/Stitch styling
        ctx.beginPath();
        ctx.roundRect(x, height / 2 - barHeight / 2, barWidth - 2, barHeight, 4);
        ctx.fill();

        x += barWidth;
      }
    };

    renderFrame();
  };

  const uploadRecording = async (blob: Blob, duration: string) => {
    setIsUploading(true);
    
    try {
      // Convert Blob to Base64
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64Audio = reader.result as string;

        const response = await fetch("http://localhost:8000/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audio_base64: base64Audio,
            duration: duration,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to upload recording.");
        }

        const newSession = await response.json();
        setIsUploading(false);

        // Update parent state with newly created SQLite session
        onSessionCreated(newSession);

      };
    } catch (err: any) {
      console.error("Upload failed:", err);
      setErrorMsg("Failed to upload and transcribe audio.");
      setIsUploading(false);
    }
  };

  return (
    <div className="stitch-recorder-card">
      <h3 className="recorder-title">🎙️ Voice Recorder Hub</h3>
      <p className="recorder-desc">Record your dictation. Once finished, click Stop to transcribe and generate your report.</p>

      {/* Real-time Moving Canvas Visualizer */}
      <div className={`visualizer-container ${isRecording ? "active" : ""}`}>
        {isRecording ? (
          <canvas ref={canvasRef} className="visualizer-canvas" width="280" height="100" />
        ) : (
          <div className="visualizer-placeholder">
            <span>Ready to Record</span>
          </div>
        )}
      </div>

      {errorMsg && <div className="recorder-error">{errorMsg}</div>}

      <div className="recorder-footer">
        {isRecording && <span className="timer-badge">● {formatTime(recordingTime)}</span>}
        
        {isUploading ? (
          <button className="record-btn uploading" disabled>
            <div className="recorder-spinner"></div> Transcribing...
          </button>
        ) : isRecording ? (
          <button className="record-btn stop" onClick={stopRecording}>
            <div className="stop-icon"></div> Stop & Save
          </button>
        ) : (
          <button className="record-btn start" onClick={startRecording}>
            <div className="mic-icon"></div> Start Recording
          </button>
        )}
      </div>
    </div>
  );
};
