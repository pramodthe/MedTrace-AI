import { useCallback, useEffect, useState, useRef } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChatConfigurationProvider,
  useAgent,
  UseAgentUpdate,
  useCopilotKit,
  useHumanInTheLoop,
  useRenderToolCall,
} from "@copilotkit/react-core/v2";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import MarkdownIt from "markdown-it";
import { diffWords } from "diff";

import "@copilotkit/react-core/v2/styles.css";
import "./style.css";

const extensions = [StarterKit];

const defaultSession = {
  id: "preloaded-knee-consultation",
  timestamp: new Date().toISOString(),
  duration: "03:45",
  transcript: "",
  report: `## Reason for visit
Hard lump behind the knee.

## History of present illness (HPI)
- The patient is seen today for a medical concern involving a hard **lump** behind the knee. They are not sure what caused it, but noticed it a few days ago.
- Can feel the lump when they flex their leg.
- Noticed after a recent soccer practice.`,
  audio_base64: ""
};

export default function App() {
  return (
    // useSingleEndpoint defaults true in <CopilotKit/>; multi-route Express needs REST (GET …/info).
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      showDevConsole={true}
      agent="predictive_state_updates"
    >
      <CopilotChatConfigurationProvider agentId="predictive_state_updates">
      <div className="clinical-app-layout">
        <header className="app-header">
          <div className="logo-container">
            <div className="logo-icon">🩺</div>
            <h1 className="app-title">Clinical Cortex <span style={{ fontWeight: 400, color: "var(--stitch-secondary)" }}>— MedTrace AI</span></h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-semibold bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded-full border border-emerald-100 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span> Live Handshake Active
            </span>
          </div>
        </header>
        <main className="clinical-main-content">
          <DocumentEditor />
        </main>
      </div>
      </CopilotChatConfigurationProvider>
    </CopilotKit>
  );
}

interface AgentState {
  document: string;
}

const base64ToBlob = (base64Str: string) => {
  if (!base64Str) return null;
  try {
    const parts = base64Str.split(",");
    const mime = parts[0].match(/:(.*?);/)?.[1] || "audio/wav";
    const base64Data = parts[1] || parts[0];
    const bstr = atob(base64Data);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch (e) {
    console.error("Failed to parse base64 audio:", e);
    return null;
  }
};

interface AudioVisualizerProps {
  blob: Blob;
  width: number;
  height: number;
  barWidth?: number;
  gap?: number;
  barColor?: string;
  barPlayedColor?: string;
  currentTime?: number;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  blob,
  width,
  height,
  barWidth = 2,
  gap = 1.5,
  barColor = "#dadce0",
  barPlayedColor = "#f29900",
  currentTime = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peaksRef = useRef<number[]>([]);
  const durationRef = useRef<number>(0);

  useEffect(() => {
    if (!blob) return;

    const decodeAudio = async () => {
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        durationRef.current = audioBuffer.duration;
        await audioCtx.close();

        const numBars = Math.floor(width / (barWidth + gap));
        const rawData = audioBuffer.getChannelData(0);
        const blockSize = Math.floor(rawData.length / numBars);
        const peaks: number[] = [];

        for (let i = 0; i < numBars; i++) {
          let max = 0;
          for (let j = 0; j < blockSize; j++) {
            const val = Math.abs(rawData[i * blockSize + j]);
            if (val > max) max = val;
          }
          peaks.push(max);
        }
        peaksRef.current = peaks;
        draw();
      } catch (err) {
        console.error("Error decoding audio for visualizer:", err);
      }
    };

    decodeAudio();
  }, [blob, width, barWidth, gap]);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas || peaksRef.current.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const numBars = peaksRef.current.length;
    const progress = durationRef.current > 0 ? currentTime / durationRef.current : 0;
    const playedBars = Math.floor(progress * numBars);

    peaksRef.current.forEach((peak, i) => {
      const x = i * (barWidth + gap);
      const barHeight = peak * height * 0.9 + 2; // minimum height 2px
      ctx.fillStyle = i < playedBars ? barPlayedColor : barColor;
      
      ctx.beginPath();
      ctx.roundRect(x, height / 2 - barHeight / 2, barWidth, barHeight, 4);
      ctx.fill();
    });
  };

  useEffect(() => {
    draw();
  }, [currentTime]);

  return <canvas ref={canvasRef} width={width} height={height} />;
};

interface LiveAudioVisualizerProps {
  mediaRecorder: MediaRecorder;
  width: number;
  height: number;
  barColor?: string;
}

const LiveAudioVisualizer: React.FC<LiveAudioVisualizerProps> = ({
  mediaRecorder,
  width,
  height,
  barColor = "#0b57d0",
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!mediaRecorder || !mediaRecorder.stream) return;

    let audioCtx: AudioContext | null = null;
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(mediaRecorder.stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const draw = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        animationFrameRef.current = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        ctx.clearRect(0, 0, width, height);

        const barWidth = (width / bufferLength) * 0.8;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const percent = dataArray[i] / 255;
          const barHeight = percent * height * 0.85 + 2;

          ctx.fillStyle = barColor;
          ctx.beginPath();
          ctx.roundRect(x, height / 2 - barHeight / 2, barWidth - 1, barHeight, 4);
          ctx.fill();

          x += barWidth + 1;
        }
      };

      draw();
    } catch (err) {
      console.error("Failed to setup LiveAudioVisualizer:", err);
    }

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioCtx) audioCtx.close();
    };
  }, [mediaRecorder, width, height, barColor]);

  return <canvas ref={canvasRef} width={width} height={height} />;
};

const DocumentEditor = () => {
  const editor = useEditor({
    extensions,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "tiptap" },
    },
  });

  const [currentDocument, setCurrentDocument] = useState("");
  const [sessions, setSessions] = useState<any[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>("preloaded-knee-consultation");
  const [playingSessionId, setPlayingSessionId] = useState<string | null>(null);
  const [commandText, setCommandText] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Audio Visualize specific states
  const [activeAudioBlob, setActiveAudioBlob] = useState<Blob | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0);

  // Microphone voice recording states
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [aiBubbleDismissed, setAiBubbleDismissed] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const startTimeRef = useRef<number>(0);

  // Cleanup hooks on unmount
  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
    };
  }, []);

  // Format seconds to mm:ss
  const formatTime = (secs: number) => {
    const minutes = Math.floor(secs / 60);
    const seconds = secs % 60;
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  // Start microphone audio recording
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
        
        stream.getTracks().forEach((track) => track.stop());

        await uploadRecording(audioBlob, durationStr);
      };

      setIsRecording(true);
      setRecordingTime(0);
      startTimeRef.current = Date.now();
      
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

      mediaRecorder.start();

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
    }
  };

  const handleAudioUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setErrorMsg("");

    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const durationSecs = Math.round(audioBuffer.duration);
      const durationStr = formatTime(durationSecs);
      await audioCtx.close();

      await uploadRecording(file, durationStr);
    } catch (err) {
      console.error("Failed to decode uploaded audio file:", err);
      // Fallback with default duration estimate
      await uploadRecording(file, "02:15");
    }
  };

  const uploadRecording = async (blob: Blob, duration: string) => {
    setIsUploading(true);
    setErrorMsg("");
    
    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        try {
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
            throw new Error(`Server returned status ${response.status}`);
          }

          const newSession = await response.json();
          if (newSession.error) {
            throw new Error(newSession.error);
          }

          setIsUploading(false);
          handleSessionCreated(newSession);
        } catch (innerErr: any) {
          console.error("Async upload callback failed:", innerErr);
          setErrorMsg(innerErr.message || "Failed to transcribe audio.");
          setIsUploading(false);
        }
      };
    } catch (err: any) {
      console.error("Upload failed:", err);
      setErrorMsg("Failed to upload audio.");
      setIsUploading(false);
    }
  };

  // Fetch SQLite sessions
  useEffect(() => {
    fetch("http://localhost:8000/api/sessions")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const loadedSessions = [defaultSession, ...data];
          setSessions(loadedSessions);
          loadSession(defaultSession);
        } else {
          setSessions([defaultSession]);
          loadSession(defaultSession);
        }
      })
      .catch((err) => {
        console.error("Error fetching sessions:", err);
        setSessions([defaultSession]);
        loadSession(defaultSession);
      });
  }, []);

  const loadSession = (session: any) => {
    setActiveSessionId(session.id);
    const htmlContent = fromMarkdown(session.report);
    editor?.commands.setContent(htmlContent);
    setCurrentDocument(session.report);
    setAgentState({ document: session.report });
  };

  const handleSessionCreated = (newSession: any) => {
    setSessions((prev) => {
      const filtered = prev.filter(s => s.id !== "preloaded-knee-consultation");
      return [newSession, ...filtered];
    });
    loadSession(newSession);
  };

  const playAudio = (session: any) => {
    if (!session.audio_base64?.trim()) {
      return;
    }

    if (playingSessionId === session.id) {
      audioRef.current?.pause();
      setPlayingSessionId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(session.audio_base64);
      audioRef.current = audio;
      setPlayingSessionId(session.id);
      audio.play();
      audio.ontimeupdate = () => {
        setPlaybackTime(audio.currentTime);
      };
      audio.onended = () => {
        setPlayingSessionId(null);
        setPlaybackTime(0);
      };
    }
  };

  // Headless CopilotKit command send logic
  const handleSendCommand = async () => {
    if (!commandText.trim()) return;
    const textToSend = commandText;
    setCommandText("");
    
    try {
      agent.addMessage({
        id: Math.random().toString(36).substring(7),
        role: "user",
        content: textToSend,
      });
      await agent.runAgent();
    } catch (err) {
      console.error("Error sending headless command:", err);
    }
  };

  const renderToolCall = useRenderToolCall();
  const { copilotkit, executingToolCallIds } = useCopilotKit();

  const { agent } = useAgent({
    agentId: "predictive_state_updates",
    updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],
  });

  const agentState = agent.state as AgentState | undefined;
  const setAgentState = (s: AgentState) => agent.setState(s);
  const isLoading = agent.isRunning;

  const assistantMessages = agent.messages.filter(m => m.role === "assistant" && m.content);
  const latestAssistantMessage = assistantMessages[assistantMessages.length - 1];
  const hasBubble = isLoading || !!latestAssistantMessage;

  const activeToolCallMessage = agent.messages.find(
    (m) =>
      m.role === "assistant" &&
      (m as any).toolCalls &&
      (m as any).toolCalls.some(
        (tc: any) =>
          !agent.messages.some(
            (tm) => tm.role === "tool" && (tm as any).toolCallId === tc.id
          )
      )
  );

  const activeToolCall = (activeToolCallMessage as any)?.toolCalls?.find(
    (tc: any) =>
      !agent.messages.some(
        (tm) => tm.role === "tool" && (tm as any).toolCallId === tc.id
      )
  );

  const renderedTool = activeToolCall ? renderToolCall({ toolCall: activeToolCall }) : null;
  const hasHITL = !!renderedTool;

  useEffect(() => {
    if (isLoading) setAiBubbleDismissed(false);
  }, [isLoading]);

  const wasRunning = useRef(false);

  useEffect(() => {
    editor?.setEditable(!isLoading);
  }, [isLoading, editor]);

  useEffect(() => {
    if (wasRunning.current && !isLoading) {
      if (currentDocument.trim().length > 0 && currentDocument !== agentState?.document) {
        const newDocument = agentState?.document || "";
        const diff = diffPartialText(currentDocument, newDocument, true);
        const markdown = fromMarkdown(diff);
        editor?.commands.setContent(markdown);
      }
    }
    wasRunning.current = isLoading;
  }, [isLoading, agentState?.document, currentDocument, editor]);

  useEffect(() => {
    if (isLoading) {
      if (currentDocument.trim().length > 0) {
        const newDocument = agentState?.document || "";
        const diff = diffPartialText(currentDocument, newDocument);
        const markdown = fromMarkdown(diff);
        editor?.commands.setContent(markdown);
      } else {
        const markdown = fromMarkdown(agentState?.document || "");
        editor?.commands.setContent(markdown);
      }
    }
  }, [agentState?.document, isLoading, currentDocument, editor]);

  const text = editor?.getText() || "";

  const currentDocumentRef = useRef(currentDocument);
  const agentStateRef = useRef(agentState);
  const editorRef = useRef(editor);
  const agentRef = useRef(agent);
  currentDocumentRef.current = currentDocument;
  agentStateRef.current = agentState;
  editorRef.current = editor;
  agentRef.current = agent;

  useEffect(() => {
    if (!isLoading) {
      setCurrentDocument(text);
      setAgentState({
        document: text,
      });
    }
  }, [text, isLoading]);

  // HITL: keep deps stable ([]). CopilotKit's useFrontendTool re-runs removeTool/addTool when deps
  // change; streaming document updates were unregistering confirm_changes during processAgentResult,
  // so the tool never reached "executing" and respond stayed undefined (disabled buttons).
  const confirmChangesRender = useCallback(
    ({ args, respond, status }: { args: any; respond: any; status: any }) => (
      <ConfirmChanges
        args={args}
        respond={respond}
        status={status}
        onReject={() => {
          const doc = currentDocumentRef.current;
          editorRef.current?.commands.setContent(fromMarkdown(doc));
          agentRef.current.setState({ document: doc });
        }}
        onConfirm={() => {
          const doc = agentStateRef.current?.document || "";
          editorRef.current?.commands.setContent(fromMarkdown(doc));
          setCurrentDocument(doc);
          agentRef.current.setState({ document: doc });
        }}
      />
    ),
    []
  );

  // Omit agentId so getTool() resolves via global fallback (name match, !tool.agentId).
  // Scoped registration + HttpAgent agentId sometimes missed the tool during processAgentResult.
  useHumanInTheLoop(
    {
      name: "confirm_changes",
      render: confirmChangesRender,
    },
    []
  );

  // LangGraph + HttpAgent sometimes omits the synthetic confirm assistant message from
  // runAgentResult.newMessages, so processAgentResult never runs the frontend tool and
  // Confirm stays disabled. Re-drive processAgentResult once per pending toolCall id.
  const confirmKickAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const tc = activeToolCall as { id?: string; function?: { name?: string } } | undefined;
    const msg = activeToolCallMessage as { id?: string; role?: string } | undefined;
    if (!tc?.id || tc.function?.name !== "confirm_changes" || !msg?.id) return;
    const toolCallId = tc.id;
    if (isLoading) return;
    if (executingToolCallIds.has(toolCallId)) return;

    const hasToolResult = agent.messages.some(
      (tm) => tm.role === "tool" && (tm as { toolCallId?: string }).toolCallId === toolCallId
    );
    if (hasToolResult) {
      confirmKickAttemptedRef.current.delete(toolCallId);
      return;
    }
    if (confirmKickAttemptedRef.current.has(toolCallId)) return;
    confirmKickAttemptedRef.current.add(toolCallId);

    const runHandler = (
      copilotkit as unknown as {
        runHandler?: {
          processAgentResult: (p: {
            runAgentResult: { newMessages: unknown[] };
            agent: typeof agent;
          }) => Promise<unknown>;
        };
      }
    ).runHandler;
    if (!runHandler?.processAgentResult) {
      confirmKickAttemptedRef.current.delete(toolCallId);
      return;
    }

    void runHandler
      .processAgentResult({
        runAgentResult: { newMessages: [msg] },
        agent,
      })
      .catch((err: unknown) => {
        console.error("[HITL] confirm_changes processAgentResult kick failed:", err);
        confirmKickAttemptedRef.current.delete(toolCallId);
      });
  }, [
    activeToolCall,
    activeToolCallMessage,
    agent,
    copilotkit,
    executingToolCallIds,
    isLoading,
  ]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || defaultSession;
  const sessionHasAudio = Boolean(activeSession?.audio_base64?.trim());

  const waveformHostRef = useRef<HTMLDivElement | null>(null);
  const [waveDims, setWaveDims] = useState({ width: 280, height: 32 });

  useEffect(() => {
    const el = waveformHostRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.max(160, Math.floor(el.clientWidth));
      setWaveDims((d) => (d.width === w ? d : { ...d, width: w }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (activeSession?.audio_base64) {
      const blob = base64ToBlob(activeSession.audio_base64);
      setActiveAudioBlob(blob);
    } else {
      setActiveAudioBlob(null);
    }
  }, [activeSessionId, activeSession?.audio_base64]);
  
  // Parse alternating transcript dialogue lines for left/right bubbles
  const parseTranscript = (rawText: string) => {
    const lines = rawText.split("\n").filter((l) => l.trim().length > 0);
    return lines.map((line, idx) => {
      const isClinician = line.toLowerCase().startsWith("clinician:") || line.toLowerCase().startsWith("doctor:");
      const isPatient = line.toLowerCase().startsWith("patient:");
      
      const cleanText = line.replace(/^(clinician:|doctor:|patient:)\s*/i, "");
      const speaker = isClinician ? "Clinician" : isPatient ? "Patient" : idx % 2 === 0 ? "Clinician" : "Patient";
      const time = `14:0${2 + Math.min(idx, 7)} PM`;
      
      return { speaker, time, text: cleanText };
    });
  };

  const parsedTranscript = parseTranscript(activeSession.transcript);

  return (
    <div className="document-editor-workspace">
      <div className="stitch-outer-frame-card">
      {/* One row: left stack (audio + transcript) | insights fills same height as grid */}
      <div className="stitch-columns-grid relative">
        <div className="stitch-left-stack">
          <div className="stitch-consultation-header">
            <div className="consultation-header-toolbar">
              <div className="consultation-header-status">
                {errorMsg && <p className="consultation-error">{errorMsg}</p>}
                {!errorMsg && !sessionHasAudio && !isRecording && (
                  <p className="consultation-hint">No audio for this session — waveform appears after you record or upload.</p>
                )}
              </div>
              <div className="consultation-header-actions">
                {isRecording ? (
                  <button type="button" className="stitch-action-pill stop-rec" onClick={stopRecording}>
                    ⏹ Stop ({formatTime(recordingTime)})
                  </button>
                ) : isUploading ? (
                  <button type="button" className="stitch-action-pill stop-rec" disabled>
                    Transcribing...
                  </button>
                ) : (
                  <button type="button" className="stitch-action-pill start-rec" onClick={startRecording}>
                    🎙️ Record
                  </button>
                )}
                <label className="stitch-action-pill outline cursor-pointer">
                  📁 Upload
                  <input 
                    type="file" 
                    accept="audio/*" 
                    className="hidden" 
                    onChange={handleAudioUpload}
                    style={{ display: "none" }}
                    disabled={isRecording || isUploading}
                  />
                </label>
              </div>
            </div>

            <div className="stitch-playback-row">
              <div className="playback-controls">
                <button 
                  type="button"
                  className={`playback-play-btn ${playingSessionId === activeSession.id ? "playing" : ""} ${!sessionHasAudio && !isRecording ? "disabled" : ""}`}
                  onClick={() => playAudio(activeSession)}
                  disabled={!sessionHasAudio && !isRecording}
                  title={!sessionHasAudio && !isRecording ? "Add audio to enable playback" : undefined}
                >
                  {playingSessionId === activeSession.id ? "⏸" : "▶"}
                </button>
              </div>

              <div className="waveform-timeline-host" ref={waveformHostRef}>
                <div className="waveform-timeline-container">
                {isRecording && mediaRecorderRef.current ? (
                  <LiveAudioVisualizer
                    mediaRecorder={mediaRecorderRef.current}
                    width={waveDims.width}
                    height={waveDims.height}
                    barColor="#0052cc"
                  />
                ) : activeAudioBlob ? (
                  <AudioVisualizer
                    blob={activeAudioBlob}
                    width={waveDims.width}
                    height={waveDims.height}
                    barWidth={1.5}
                    gap={1}
                    barColor="#cbd5e1"
                    barPlayedColor="#0052cc"
                    currentTime={playbackTime}
                  />
                ) : (
                  <div className="waveform-empty-placeholder" role="status" aria-label="No audio waveform for this session">
                    <span className="waveform-empty-line" aria-hidden />
                    <span className="waveform-empty-label">No waveform</span>
                  </div>
                )}
                </div>
              </div>
              <span className="waveform-duration-badge">{activeSession.duration}</span>
            </div>
          </div>

          <div className="stitch-transcript-panel">
          <div className="panel-header-row panel-header-row--simple">
            <h3 className="panel-section-title">Transcript</h3>
          </div>
          <div className="transcript-bubbles-scroller">
            {parsedTranscript.length === 0 ? (
              <div
                className="transcript-empty-state"
                role="status"
                aria-live="polite"
                aria-label="Transcript is empty until audio is processed"
              >
                <div className="transcript-empty-visual" aria-hidden>
                  <span className="transcript-empty-line" />
                </div>
                <p className="transcript-empty-kicker">Diarized dialogue</p>
                <p className="transcript-empty-title">No transcript yet</p>
                <p className="transcript-empty-hint">
                  Record a consultation or upload audio. Speaker turns will appear here after
                  transcription.
                </p>
              </div>
            ) : (
              parsedTranscript.map((line, idx) => (
                <div key={idx} className={`transcript-bubble-wrapper ${line.speaker.toLowerCase()}`}>
                  <div className="bubble-meta">
                    <div className="bubble-avatar">
                      {line.speaker === "Clinician" ? "✨" : "👤"}
                    </div>
                    <span className="speaker-name">{line.speaker}</span>
                    <span className="speaker-time">{line.time}</span>
                  </div>
                  <div className="bubble-content-card">
                    <p>{line.text}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          </div>
        </div>

        <div className="stitch-insights-panel">
          <div className="panel-header-row">
            <h3 className="panel-section-title">AI Insights</h3>
            <div className="insights-toggle-pills">
              <span className="insight-pill active">Summarizations</span>
              <span className="insight-pill">Analysis</span>
            </div>
          </div>
          <div className="tiptap-clinical-container">
            <EditorContent editor={editor} />
          </div>
          
          <div className="stitch-disclaimer-banner">
            <span className="disclaimer-icon">⚠️</span>
            <p className="disclaimer-text">
              This demonstration is for illustrative purposes of MedGemma's baseline capabilities only. It does not represent a finished or approved product, is not intended to diagnose or suggest treatment.
            </p>
          </div>
        </div>
      </div>

      {/* Human In The Loop Active Tool Rendering */}
      {renderedTool && (
        <div className="stitch-hitl-container">
          {renderedTool}
        </div>
      )}

      {/* Glassmorphic AI Response Bubble */}
      {hasBubble && !hasHITL && !aiBubbleDismissed && (
        <div className="stitch-ai-response-bubble">
          <button
            type="button"
            className="bubble-close-btn"
            aria-label="Dismiss AI message"
            onClick={() => setAiBubbleDismissed(true)}
          >
            ×
          </button>
          <div className="bubble-header">
            <span className="bubble-sparkle-icon">✨</span>
            <span className="bubble-speaker-title">AI CONSULTANT</span>
            {isLoading && <span className="bubble-typing-indicator">Drafting report...</span>}
          </div>
          <div className="bubble-text-content">
            {isLoading && (!latestAssistantMessage || latestAssistantMessage.role !== "assistant") ? (
              <div className="pulse-text">Updating clinical document in real-time...</div>
            ) : (
              typeof latestAssistantMessage?.content === "string" 
                ? latestAssistantMessage.content 
                : Array.isArray(latestAssistantMessage?.content)
                  ? latestAssistantMessage.content.map((c: any) => c.type === "text" ? c.text : "").join(" ")
                  : ""
            )}
          </div>
        </div>
      )}

      </div>

      {/* 3. Docked AI Command Bar — always visible, no page scroll needed */}
      <div className="stitch-docked-command-bar">
        <span className="command-sparkle">✨</span>
        <input 
          type="text" 
          className="command-input" 
          placeholder={isLoading ? "AI is processing…" : "Ask the AI to refine the clinical report…"}
          value={commandText}
          onChange={(e) => setCommandText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSendCommand();
            }
          }}
          disabled={isLoading}
        />
        <button type="button" className="command-send-btn" onClick={handleSendCommand} disabled={isLoading}>
          {isLoading ? "⚡" : "▶"}
        </button>
      </div>
    </div>
  );
};

interface ConfirmChangesProps {
  args: any;
  respond: any;
  status: any;
  onReject: () => void;
  onConfirm: () => void;
}

function ConfirmChanges({ respond, onReject, onConfirm }: ConfirmChangesProps) {
  const [accepted, setAccepted] = useState<boolean | null>(null);
  return (
    <div data-testid="confirm-changes-modal" className="confirm-changes-modal">
      <h2 className="confirm-changes-title">
        <span aria-hidden="true">⚡</span> Confirm Proposed Changes
      </h2>
      <p className="confirm-changes-body">
        Would you like to accept the new changes proposed by the AI editor?
      </p>
      {accepted === null && (
        <div className="confirm-changes-actions">
          <button
            type="button"
            disabled={!respond}
            onClick={() => {
              if (respond) {
                setAccepted(false);
                onReject();
                respond({ accepted: false });
              }
            }}
          >
            Reject
          </button>
          <button
            type="button"
            disabled={!respond}
            onClick={() => {
              if (respond) {
                setAccepted(true);
                onConfirm();
                respond({ accepted: true });
              }
            }}
          >
            Confirm
          </button>
        </div>
      )}
      {accepted !== null && (
        <div className="confirm-changes-feedback-wrap">
          <div
            className={`confirm-changes-feedback ${
              accepted
                ? "confirm-changes-feedback--accepted"
                : "confirm-changes-feedback--rejected"
            }`}
          >
            {accepted ? "✓ Accepted" : "✗ Rejected"}
          </div>
        </div>
      )}
    </div>
  );
}

function fromMarkdown(text: string) {
  const md = new MarkdownIt({
    typographer: true,
    html: true,
  });

  return md.render(text);
}

function diffPartialText(oldText: string, newText: string, isComplete: boolean = false) {
  let oldTextToCompare = oldText;
  if (oldText.length > newText.length && !isComplete) {
    oldTextToCompare = oldText.slice(0, newText.length);
  }

  const changes = diffWords(oldTextToCompare, newText);

  let result = "";
  changes.forEach((part) => {
    if (part.added) {
      result += `<em>${part.value}</em>`;
    } else if (part.removed) {
      result += `<s>${part.value}</s>`;
    } else {
      result += part.value;
    }
  });

  if (oldText.length > newText.length && !isComplete) {
    result += oldText.slice(newText.length);
  }

  return result;
}
