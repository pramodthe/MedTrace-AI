import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent, ReactNode } from "react";
import {
  Brain,
  CheckCircle2,
  CircleDot,
  FileImage,
  Layers,
  Loader2,
  MessageSquareText,
  Moon,
  Redo2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  Upload,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

type ReviewDecision = "unreviewed" | "accepted" | "needs-review";
type StudyStatus = "ready" | "segmenting" | "reporting";

type RoiBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Segmentation = {
  id: string;
  label: string;
  confidence: number;
  volumeMl: number;
  source: "mock" | "medgemma";
  box: RoiBox;
};

type Study = {
  id: string;
  patientName: string;
  patientDetail: string;
  modality: string;
  bodyPart: string;
  timestamp: string;
  series: string;
  slices: number;
  uploadedFileName?: string;
  previewUrl?: string;
  isDicom?: boolean;
  status: StudyStatus;
  reviewDecision: ReviewDecision;
  segmentations: Segmentation[];
  report: {
    summary: string;
    findings: string;
    impression: string;
    recommendation: string;
    confidence: number;
    source: "mock" | "medgemma";
  };
};

type LlmStatus = {
  provider: "mock" | "medgemma";
  medgemma_configured: boolean;
  model: string | null;
};

const initialStudy: Study = {
  id: "NO-DICOM",
  patientName: "No DICOM loaded",
  patientDetail: "Upload a study",
  modality: "DICOM",
  bodyPart: "Study",
  timestamp: "Waiting",
  series: "None",
  slices: 0,
  status: "ready",
  reviewDecision: "unreviewed",
  segmentations: [],
  report: {
    summary: "Awaiting DICOM upload",
    findings: "Upload a DICOM file to render the image and generate a Medgemma draft report.",
    impression: "No imaging study is loaded.",
    recommendation: "Use the Upload DICOM control on the left panel.",
    confidence: 0,
    source: "mock",
  },
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
const MEDGEMMA_API_URL = import.meta.env.VITE_MEDGEMMA_API_URL ?? "http://127.0.0.1:1234/v1";
const MEDGEMMA_MODEL = import.meta.env.VITE_MEDGEMMA_MODEL ?? "medgemma-1.5-4b-it";

async function postStudyFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/studies`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Study upload API is unavailable");
  }

  return (await response.json()) as Partial<Study>;
}

async function requestSegmentation(studyId: string, prompt: RoiBox) {
  const response = await fetch(`${API_BASE_URL}/studies/${studyId}/segmentations/medgemma`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    throw new Error("Medgemma segmentation API is unavailable");
  }

  return (await response.json()) as Segmentation;
}

async function requestReport(study: Study) {
  const segSummary =
    study.segmentations.length > 0
      ? study.segmentations
          .map((s) => `${s.label} (confidence ${(s.confidence * 100).toFixed(0)}%, volume ${s.volumeMl} ml)`)
          .join("; ")
      : "No segmentation masks available.";

  const userContent = `You are a radiology AI assistant. Generate a structured radiology report for the following imaging study.

Modality: ${study.modality}
Body Part: ${study.bodyPart}
Patient: ${study.patientName}
Segmentation Findings: ${segSummary}

Respond in this exact JSON format:
{
  "summary": "one-line clinical summary",
  "findings": "detailed findings paragraph",
  "impression": "clinical impression",
  "recommendation": "follow-up recommendation",
  "confidence": 0.0-1.0
}`;

  const messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }> = [
    { role: "system", content: "You are a medical imaging AI. Respond only with valid JSON matching the requested schema." },
    { role: "user", content: userContent },
  ];

  if (study.previewUrl) {
    let imageUrl = study.previewUrl;
    try {
      const imgResp = await fetch(study.previewUrl);
      const imgBlob = await imgResp.blob();
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(imgBlob);
      });
      imageUrl = base64;
    } catch {
      // If conversion fails, send the original URL as a fallback.
    }
    messages[1].content = [
      { type: "text", text: userContent },
      { type: "image_url", image_url: { url: imageUrl } },
    ];
  }

  const response = await fetch(`${MEDGEMMA_API_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MEDGEMMA_MODEL,
      messages,
      max_tokens: 1024,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    let detail = "Medgemma API is unavailable";
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      if (payload.error?.message) {
        detail = payload.error.message;
      }
    } catch {
      // Keep the generic error when the backend response is not JSON.
    }
    throw new Error(detail);
  }

  const completion = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const raw = completion.choices?.[0]?.message?.content ?? "";
  let parsed: Record<string, unknown>;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    parsed = {};
  }

  return {
    summary: (parsed.summary as string) ?? "Medgemma draft generated",
    findings: (parsed.findings as string) ?? raw,
    impression: (parsed.impression as string) ?? "See findings above.",
    recommendation: (parsed.recommendation as string) ?? "Clinical correlation recommended.",
    confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
    source: "medgemma" as const,
  };
}

async function requestLlmStatus() {
  try {
    const response = await fetch(`${MEDGEMMA_API_URL}/models`);
    if (!response.ok) {
      throw new Error();
    }

    const data = (await response.json()) as {
      data: Array<{ id: string }>;
    };

    const modelIds = data.data?.map((m) => m.id) ?? [];
    const medgemmaAvailable = modelIds.some((id) => id.toLowerCase().includes("medgemma"));

    return {
      provider: medgemmaAvailable ? "medgemma" as const : "mock" as const,
      medgemma_configured: medgemmaAvailable,
      model: medgemmaAvailable ? modelIds.find((id) => id.toLowerCase().includes("medgemma")) ?? MEDGEMMA_MODEL : null,
    } satisfies LlmStatus;
  } catch {
    throw new Error("Medgemma API is not reachable at " + MEDGEMMA_API_URL);
  }
}

function App() {
  const [studies, setStudies] = useState<Study[]>([]);
  const [activeStudyId, setActiveStudyId] = useState<string | null>(null);
  const [segmentVisible, setSegmentVisible] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [brightness, setBrightness] = useState(100);
  const [llmStatus, setLlmStatus] = useState<LlmStatus>({ provider: "mock", medgemma_configured: false, model: null });
  const [isDragging, setIsDragging] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const study = studies.find((candidate) => candidate.id === activeStudyId) ?? studies[0] ?? initialStudy;

  // Undo / Redo history keyed by study id
  const [undoStacks, setUndoStacks] = useState<Record<string, Segmentation[][]>>({});
  const [redoStacks, setRedoStacks] = useState<Record<string, Segmentation[][]>>({});

  const pushUndo = useCallback(
    (studyId: string, segmentations: Segmentation[]) => {
      setUndoStacks((prev) => ({ ...prev, [studyId]: [...(prev[studyId] ?? []), segmentations] }));
      setRedoStacks((prev) => ({ ...prev, [studyId]: [] }));
    },
    [],
  );

  useBrowserStatus(setLlmStatus);
  const updateStudy = (updater: (study: Study) => Study) => {
    setStudies((current) => current.map((candidate) => (candidate.id === study.id ? updater(candidate) : candidate)));
  };

  const buildFallbackStudy = (file: File): Study => {
    const isDicom = file.name.toLowerCase().endsWith(".dcm") || file.type === "application/dicom";
    const canPreview = file.type.startsWith("image/");
    const previewUrl = canPreview ? URL.createObjectURL(file) : undefined;

    return {
      id: `LOCAL-${Date.now()}`,
      patientName: "Uploaded Study",
      patientDetail: "Local file",
      modality: isDicom ? "DICOM" : "IMG",
      bodyPart: "Unspecified",
      timestamp: "Just now",
      series: isDicom ? "DICOM series" : "Image preview",
      slices: isDicom ? 1 : 1,
      uploadedFileName: file.name,
      previewUrl,
      isDicom,
      status: "ready",
      reviewDecision: "unreviewed",
      segmentations: [],
      report: {
        summary: "Awaiting AI review",
        findings: "The study is loaded locally. Run Medgemma segmentation or report generation.",
        impression: "Pending AI draft and clinician review.",
        recommendation: "Select an ROI for segmentation if a suspicious region is present.",
        confidence: 0,
        source: "mock",
      },
    };
  };

  const addStudy = (nextStudy: Study) => {
    setStudies((current) => [nextStudy, ...current.filter((candidate) => candidate.id !== nextStudy.id)]);
    setActiveStudyId(nextStudy.id);
    setSegmentVisible(true);
  };

  const handleStudyFile = async (file: File) => {
    const fallbackStudy = buildFallbackStudy(file);

    try {
      const uploaded = await postStudyFile(file);
      const apiPreviewUrl = uploaded.previewUrl?.startsWith("/") ? `${API_BASE_URL}${uploaded.previewUrl}` : uploaded.previewUrl;
      const nextStudy = { ...fallbackStudy, ...uploaded, previewUrl: apiPreviewUrl ?? fallbackStudy.previewUrl };
      addStudy(nextStudy);
    } catch {
      addStudy(fallbackStudy);
    }
  };

  const handleStudyFiles = async (files: File[]) => {
    for (const file of files) {
      await handleStudyFile(file);
    }
  };

  const runSegmentation = async (prompt: RoiBox = { x: 0.47, y: 0.34, width: 0.16, height: 0.22 }) => {
    pushUndo(study.id, study.segmentations);
    updateStudy((currentStudy) => ({ ...currentStudy, status: "segmenting" }));
    setSegmentVisible(true);

    try {
      const segmentation = await requestSegmentation(study.id, prompt);
      updateStudy((currentStudy) => ({
        ...currentStudy,
        status: "ready",
        segmentations: [{ ...segmentation, box: segmentation.box ?? prompt }, ...currentStudy.segmentations],
      }));
    } catch {
      const segmentation: Segmentation = {
        id: `seg-${Date.now()}`,
        label: study.modality === "DICOM" ? "Prompted DICOM ROI" : "Prompted image ROI",
        confidence: 0.79,
        volumeMl: Math.round(prompt.width * prompt.height * 1200) / 10,
        source: "mock",
        box: prompt,
      };
      updateStudy((currentStudy) => ({
        ...currentStudy,
        status: "ready",
        segmentations: [segmentation, ...currentStudy.segmentations],
      }));
    }
  };

  const runReport = async () => {
    updateStudy((currentStudy) => ({ ...currentStudy, status: "reporting" }));

    try {
      const report = await requestReport(study);
      updateStudy((currentStudy) => ({ ...currentStudy, status: "ready", report }));
    } catch (error) {
      updateStudy((currentStudy) => ({
        ...currentStudy,
        status: "ready",
        report: {
          summary: "Medgemma draft unavailable",
          findings:
            currentStudy.segmentations.length > 0
              ? `AI draft based on ${currentStudy.segmentations.length} segmentation ROI(s). ${error instanceof Error ? error.message : "Backend Medgemma service is unavailable."}`
              : error instanceof Error
                ? error.message
                : "No segmentation mask has been generated yet. Report quality improves when the model receives image context and ROI metadata.",
          impression: "Preliminary decision support only. No autonomous diagnosis should be made from this draft.",
          recommendation: llmStatus.medgemma_configured
            ? "Medgemma appears configured. Restart the backend if the endpoint changed, then try Generate again."
            : "Ensure Medgemma is running on http://127.0.0.1:1234, restart the backend, then generate the report again.",
          confidence: currentStudy.segmentations.length > 0 ? 0.72 : 0.38,
          source: "medgemma",
        },
      }));
    }
  };

  const handleUndo = () => {
    const stack = undoStacks[study.id];
    if (!stack || stack.length === 0) {
      return;
    }
    const previous = stack[stack.length - 1];
    setUndoStacks((prev) => ({ ...prev, [study.id]: stack.slice(0, -1) }));
    setRedoStacks((prev) => ({ ...prev, [study.id]: [...(prev[study.id] ?? []), study.segmentations] }));
    updateStudy((currentStudy) => ({ ...currentStudy, segmentations: previous }));
  };

  const handleRedo = () => {
    const stack = redoStacks[study.id];
    if (!stack || stack.length === 0) {
      return;
    }
    const next = stack[stack.length - 1];
    setRedoStacks((prev) => ({ ...prev, [study.id]: stack.slice(0, -1) }));
    setUndoStacks((prev) => ({ ...prev, [study.id]: [...(prev[study.id] ?? []), study.segmentations] }));
    updateStudy((currentStudy) => ({ ...currentStudy, segmentations: next }));
  };

  const handleClear = () => {
    if (study.segmentations.length === 0) {
      return;
    }
    pushUndo(study.id, study.segmentations);
    updateStudy((currentStudy) => ({ ...currentStudy, segmentations: [] }));
  };

  const canUndo = (undoStacks[study.id]?.length ?? 0) > 0;
  const canRedo = (redoStacks[study.id]?.length ?? 0) > 0;

  return (
    <main className="h-screen overflow-hidden bg-[#05070b] text-slate-100">
      <div className="grid h-full grid-cols-[280px_minmax(0,1fr)_390px] overflow-hidden max-xl:grid-cols-[240px_minmax(0,1fr)_360px] max-lg:grid-cols-1 max-lg:overflow-y-auto">
        <StudyPanel activeStudyId={study.id} studies={studies} onFiles={handleStudyFiles} onSelectStudy={setActiveStudyId} />

        <ViewerWorkspace
          brightness={brightness}
          canRedo={canRedo}
          canUndo={canUndo}
          isDragging={isDragging}
          segmentVisible={segmentVisible}
          study={study}
          zoom={zoom}
          onClear={handleClear}
          onDragStateChange={setIsDragging}
          onBrightnessChange={setBrightness}
          onRedo={handleRedo}
          onRunSegmentation={runSegmentation}
          onSegmentVisibleChange={setSegmentVisible}
          onUndo={handleUndo}
          onZoomChange={setZoom}
        />

        <DecisionPanel
          llmStatus={llmStatus}
          study={study}
          onAccept={() => updateStudy((currentStudy) => ({ ...currentStudy, reviewDecision: "accepted" }))}
          onNeedsReview={() => {
            updateStudy((currentStudy) => ({ ...currentStudy, reviewDecision: "needs-review" }));
            setFeedbackOpen(true);
          }}
          onRunReport={runReport}
        />
      </div>
      {feedbackOpen && (
        <FeedbackModal
          feedbackText={feedbackText}
          study={study}
          onClose={() => {
            setFeedbackOpen(false);
            setFeedbackText("");
          }}
          onFeedbackTextChange={setFeedbackText}
          onSave={() => {
            setFeedbackOpen(false);
            setFeedbackText("");
          }}
        />
      )}
    </main>
  );
}

function useBrowserStatus(setLlmStatus: (status: LlmStatus) => void) {
  useEffect(() => {
    let cancelled = false;

    requestLlmStatus()
      .then((status) => {
        if (!cancelled) {
          setLlmStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLlmStatus({ provider: "mock", medgemma_configured: false, model: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setLlmStatus]);
}

type StudyPanelProps = {
  studies: Study[];
  activeStudyId: string;
  onFiles: (files: File[]) => void;
  onSelectStudy: (studyId: string) => void;
};

function StudyPanel({ studies, activeStudyId, onFiles, onSelectStudy }: StudyPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      void onFiles(files);
      event.target.value = "";
    }
  };

  return (
    <aside className="flex min-h-0 flex-col border-r border-slate-800 bg-[#080d15] max-lg:min-h-[360px]">
      <header className="border-b border-slate-800 px-4 py-4">
        <input ref={fileInputRef} className="hidden" type="file" multiple accept=".dcm,image/png,image/jpeg,image/webp" onChange={handleFileInput} />
        <button
          className="flex w-full items-center justify-center gap-2 rounded-md border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          <FileImage className="h-4 w-4" />
          Upload DICOM
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {studies.length === 0 ? (
          <article className="rounded-md border border-slate-800 bg-[#0c1420] p-3 text-sm leading-6 text-slate-400">
            No DICOM uploaded.
          </article>
        ) : (
          <div className="space-y-2">
            {studies.map((study) => (
              <button
                key={study.id}
                className={`w-full rounded-md border p-3 text-left transition ${
                  activeStudyId === study.id
                    ? "border-cyan-300/45 bg-cyan-400/10 shadow-active-glow"
                    : "border-slate-800 bg-[#0c1420] hover:border-slate-600"
                }`}
                type="button"
                onClick={() => onSelectStudy(study.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{study.patientName}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">{study.patientDetail}</p>
                  </div>
                  <StatusDot decision={study.reviewDecision} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                  <span className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-300">
                    {study.modality} {study.bodyPart}
                  </span>
                  <span className="text-slate-500">{study.timestamp}</span>
                </div>
                <div className="mt-3 border-t border-slate-800 pt-3 text-xs leading-5 text-slate-400">
                  <p className="truncate">{study.series}</p>
                  <p className="truncate">{study.slices} slice{study.slices === 1 ? "" : "s"}</p>
                  <p className="truncate">{study.uploadedFileName ?? study.id}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

type ViewerWorkspaceProps = {
  study: Study;
  brightness: number;
  segmentVisible: boolean;
  isDragging: boolean;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  onSegmentVisibleChange: (visible: boolean) => void;
  onDragStateChange: (dragging: boolean) => void;
  onBrightnessChange: (brightness: number) => void;
  onZoomChange: (zoom: number) => void;
  onRunSegmentation: (prompt?: RoiBox) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
};

function ViewerWorkspace({
  study,
  brightness,
  segmentVisible,
  isDragging,
  zoom,
  canUndo,
  canRedo,
  onSegmentVisibleChange,
  onDragStateChange,
  onBrightnessChange,
  onZoomChange,
  onRunSegmentation,
  onUndo,
  onRedo,
  onClear,
}: ViewerWorkspaceProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [draftRoi, setDraftRoi] = useState<RoiBox | null>(null);
  const [roiStart, setRoiStart] = useState<{ x: number; y: number } | null>(null);
  const windowLevel = useMemo(() => (study.modality === "CT" || study.modality === "DICOM" ? "W: 420 L: 38" : "Auto WL"), [study.modality]);

  const getPoint = (event: MouseEvent<HTMLDivElement>) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    };
  };

  const handleRoiStart = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const point = getPoint(event);
    setRoiStart(point);
    setDraftRoi({ x: point.x, y: point.y, width: 0.01, height: 0.01 });
  };

  const handleRoiMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!roiStart) {
      return;
    }

    event.preventDefault();
    const point = getPoint(event);
    setDraftRoi(normalizeRoi(roiStart, point));
  };

  const handleRoiEnd = () => {
    if (!draftRoi || !roiStart) {
      return;
    }

    setRoiStart(null);
    const roi = draftRoi.width < 0.025 || draftRoi.height < 0.025 ? null : draftRoi;
    setDraftRoi(null);
    if (roi) {
      onRunSegmentation(roi);
    }
  };

  // Capture mouseup even outside the viewport so the ROI isn't lost on drag-out.
  useEffect(() => {
    if (!roiStart) {
      return;
    }

    const handleGlobalMouseUp = () => {
      handleRoiEnd();
    };

    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roiStart, draftRoi]);

  // Keyboard shortcuts: Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "z" && !event.shiftKey) {
        event.preventDefault();
        if (canUndo) onUndo();
      } else if ((event.ctrlKey || event.metaKey) && (event.key === "y" || (event.key === "z" && event.shiftKey))) {
        event.preventDefault();
        if (canRedo) onRedo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canUndo, canRedo, onUndo, onRedo]);

  return (
    <section className="flex min-h-0 flex-col bg-[#05070b]">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-[#090f18] px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">
            {study.patientName} / {study.modality} {study.bodyPart}
          </p>
          <p className="mt-1 truncate text-xs text-slate-500">
            {study.series} • {study.slices} slice{study.slices === 1 ? "" : "s"} • {study.uploadedFileName ?? study.id}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ToolbarButton icon={study.status === "segmenting" ? Loader2 : Brain} label="Medgemma" loading={study.status === "segmenting"} onClick={onRunSegmentation} />
          <button
            className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition ${
              segmentVisible ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100" : "border-slate-700 bg-slate-950 text-slate-400"
            }`}
            type="button"
            onClick={() => onSegmentVisibleChange(!segmentVisible)}
          >
            <Layers className="h-4 w-4" />
            Seg
          </button>
          <div className="mx-1 h-6 w-px bg-slate-700" />
          <button
            className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition ${
              canUndo ? "border-slate-700 bg-slate-950 text-slate-200 hover:border-cyan-300/40 hover:text-cyan-100" : "border-slate-800 bg-slate-950/50 text-slate-600 cursor-not-allowed"
            }`}
            type="button"
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            onClick={onUndo}
          >
            <Undo2 className="h-3.5 w-3.5" />
            Undo
          </button>
          <button
            className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition ${
              canRedo ? "border-slate-700 bg-slate-950 text-slate-200 hover:border-cyan-300/40 hover:text-cyan-100" : "border-slate-800 bg-slate-950/50 text-slate-600 cursor-not-allowed"
            }`}
            type="button"
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            onClick={onRedo}
          >
            <Redo2 className="h-3.5 w-3.5" />
            Redo
          </button>
          <button
            className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition ${
              study.segmentations.length > 0 ? "border-red-400/30 bg-red-400/10 text-red-200 hover:border-red-300/50 hover:text-red-100" : "border-slate-800 bg-slate-950/50 text-slate-600 cursor-not-allowed"
            }`}
            type="button"
            disabled={study.segmentations.length === 0}
            title="Clear all markings"
            onClick={onClear}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-[#070b12] px-4 py-2">
        <div className="flex min-w-[220px] items-center gap-3 text-xs text-slate-300">
          <button
            className="grid h-7 w-7 place-items-center rounded-md border border-slate-800 bg-slate-950 text-slate-400 transition hover:border-amber-300/40 hover:text-amber-100"
            title="Decrease brightness"
            type="button"
            onClick={() => onBrightnessChange(Math.max(45, brightness - 10))}
          >
            <Moon className="h-4 w-4" />
          </button>
          <input
            className="h-1.5 w-full cursor-pointer accent-amber-300"
            type="range"
            min="45"
            max="180"
            step="5"
            value={brightness}
            aria-label="Image brightness"
            onChange={(event) => onBrightnessChange(Number(event.target.value))}
          />
          <button
            className="grid h-7 w-7 place-items-center rounded-md border border-slate-800 bg-slate-950 text-slate-400 transition hover:border-amber-300/40 hover:text-amber-100"
            title="Increase brightness"
            type="button"
            onClick={() => onBrightnessChange(Math.min(180, brightness + 10))}
          >
            <Sun className="h-4 w-4" />
          </button>
          <span className="w-11 text-right font-medium">{brightness}%</span>
        </div>

        <div className="flex min-w-[220px] items-center gap-3 text-xs text-slate-300">
          <ZoomOut className="h-4 w-4 text-slate-500" />
          <input
            className="h-1.5 w-full cursor-pointer accent-cyan-400"
            type="range"
            min="70"
            max="180"
            step="5"
            value={zoom}
            aria-label="Image zoom"
            onChange={(event) => onZoomChange(Number(event.target.value))}
          />
          <ZoomIn className="h-4 w-4 text-slate-500" />
          <span className="w-10 text-right font-medium">{zoom}%</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 p-4">
        <div
          ref={viewportRef}
          className={`relative h-full min-h-[520px] select-none overflow-hidden rounded-md border bg-black transition ${
            isDragging ? "border-cyan-300 ring-4 ring-cyan-400/20" : "border-slate-800"
          } cursor-crosshair`}
          onMouseDown={handleRoiStart}
          onMouseMove={handleRoiMove}
          onMouseUp={handleRoiEnd}
          onDragEnter={(event) => {
            event.preventDefault();
            onDragStateChange(true);
          }}
          onDragLeave={() => onDragStateChange(false)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            onDragStateChange(false);
          }}
        >
          {study.previewUrl ? (
            <img
              className="pointer-events-none absolute inset-0 h-full w-full object-contain transition-transform duration-200"
              src={study.previewUrl}
              alt={`${study.modality} ${study.bodyPart} preview`}
              style={{ filter: `brightness(${brightness}%)`, transform: `scale(${zoom / 100})` }}
            />
          ) : (
            <div
              className="medical-scan pointer-events-none absolute inset-0 transition-transform duration-200"
              style={{ filter: `grayscale(1) contrast(1.08) brightness(${brightness * 0.9}%)`, transform: `scale(${zoom / 100})` }}
            />
          )}

          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_43%,rgba(0,0,0,0.62)_100%)]" />
          <ViewportOverlay study={study} windowLevel={windowLevel} />

          {segmentVisible && study.segmentations.length > 0 && (
            <SegmentationOverlay segmentations={study.segmentations} />
          )}

          {draftRoi && (
            <RoiBoxOverlay box={draftRoi} label="ROI prompt" className="border-amber-200 bg-amber-300/10 shadow-[0_0_28px_rgba(252,211,77,0.25)]" />
          )}

          {isDragging && (
            <div className="absolute inset-0 grid place-items-center bg-cyan-950/45 backdrop-blur-sm">
              <div className="rounded-md border border-cyan-300/50 bg-slate-950/85 px-6 py-5 text-center shadow-active-glow">
                <Upload className="mx-auto h-7 w-7 text-cyan-200" />
                <p className="mt-2 text-sm font-semibold text-white">Drop DICOM or image study</p>
                <p className="mt-1 text-xs text-cyan-100/80">DICOM backend rendering plugs in here</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

type DecisionPanelProps = {
  study: Study;
  llmStatus: LlmStatus;
  onRunReport: () => void;
  onAccept: () => void;
  onNeedsReview: () => void;
};

function DecisionPanel({
  study,
  llmStatus,
  onRunReport,
  onAccept,
  onNeedsReview,
}: DecisionPanelProps) {
  return (
    <aside className="flex min-h-0 flex-col border-l border-slate-800 bg-[#080d15] max-lg:min-h-[640px]">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <ActionCard
          icon={study.status === "reporting" ? Loader2 : Sparkles}
          title="Medgemma Report"
          actionLabel={study.status === "reporting" ? "Generating" : "Generate"}
          loading={study.status === "reporting"}
          onAction={onRunReport}
        >
          <p className={`mb-3 text-xs font-medium ${llmStatus.medgemma_configured ? "text-emerald-300" : "text-amber-300"}`}>
            {llmStatus.medgemma_configured ? `Backend model ready: ${llmStatus.model}` : "Backend is in mock mode. Ensure Medgemma is running on http://127.0.0.1:1234 and restart the backend."}
          </p>
          <p className="text-sm leading-6 text-slate-300">{study.report.summary}</p>
          <div className="mt-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-slate-500">Draft confidence</span>
              <span className="font-semibold text-cyan-100">{Math.round(study.report.confidence * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400" style={{ width: `${study.report.confidence * 100}%` }} />
            </div>
          </div>
        </ActionCard>

        <ReportSection icon={FileImage} title="Findings">
          {study.report.findings}
        </ReportSection>
        <ReportSection icon={Brain} title="Impression">
          {study.report.impression}
        </ReportSection>
        <ReportSection icon={ShieldCheck} title="Recommendation">
          {study.report.recommendation}
        </ReportSection>

        <article className="rounded-md border border-slate-800 bg-[#0c1420] p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Segmentation Masks</h3>
            <span className="text-xs text-slate-500">{study.segmentations.length}</span>
          </div>
          <div className="mt-3 space-y-2">
            {study.segmentations.length === 0 ? (
              <p className="text-sm leading-6 text-slate-400">No Medgemma mask yet. Drag on the image to choose an ROI, or run Medgemma Seg from the top control.</p>
            ) : (
              study.segmentations.map((segmentation) => (
                <div key={segmentation.id} className="rounded-md border border-slate-800 bg-slate-950/45 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-slate-100">{segmentation.label}</span>
                    <span className="text-xs text-cyan-200">{Math.round(segmentation.confidence * 100)}%</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {segmentation.volumeMl} ml • {segmentation.source}
                  </p>
                </div>
              ))
            )}
          </div>
        </article>
      </div>

      <div className="grid shrink-0 gap-3 border-t border-slate-800 bg-[#090f18] p-4">
        <button className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500" type="button" onClick={onAccept}>
          <CheckCircle2 className="h-4 w-4" />
          Doctor Accepts Draft
        </button>
        <button className="flex w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-500" type="button" onClick={onNeedsReview}>
          <XCircle className="h-4 w-4" />
          Needs Correction
        </button>
      </div>
    </aside>
  );
}

type FeedbackModalProps = {
  study: Study;
  feedbackText: string;
  onClose: () => void;
  onFeedbackTextChange: (value: string) => void;
  onSave: () => void;
};

function FeedbackModal({ study, feedbackText, onClose, onFeedbackTextChange, onSave }: FeedbackModalProps) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/62 p-4 backdrop-blur-sm">
      <section className="w-full max-w-lg rounded-md border border-amber-300/35 bg-[#0c1420] shadow-panel-soft">
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-5 w-5 text-amber-200" />
              <h2 className="text-base font-semibold text-white">Doctor Feedback</h2>
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">
              {study.patientName} • {study.modality} {study.bodyPart}
            </p>
          </div>
          <button
            className="grid h-8 w-8 place-items-center rounded-md border border-slate-700 bg-slate-950 text-slate-400 transition hover:border-slate-500 hover:text-white"
            title="Close feedback"
            type="button"
            onClick={onClose}
          >
            <XCircle className="h-4 w-4" />
          </button>
        </header>
        <div className="p-5">
          <textarea
            className="h-36 w-full resize-none rounded-md border border-slate-700 bg-slate-950 p-3 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-amber-300 focus:ring-2 focus:ring-amber-300/10"
            placeholder="Record what needs correction before this can be accepted..."
            value={feedbackText}
            autoFocus
            onChange={(event) => onFeedbackTextChange(event.target.value)}
          />
          <div className="mt-4 flex justify-end gap-3">
            <button
              className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="rounded-md border border-amber-300/35 bg-amber-400/15 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-400/20"
              type="button"
              onClick={onSave}
            >
              Save Note
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ViewportOverlay({ study, windowLevel }: { study: Study; windowLevel: string }) {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-4 text-xs text-slate-400">
        <span>{study.uploadedFileName ?? study.id}</span>
        <span>{windowLevel}</span>
      </div>
      <div className="pointer-events-none absolute bottom-4 left-4 rounded border border-slate-700/80 bg-black/45 px-3 py-2 text-xs text-slate-300">
        {study.series} • Slice {Math.ceil(study.slices * 0.33)} / {study.slices}
      </div>
      <div className="pointer-events-none absolute bottom-4 right-4 rounded border border-slate-700/80 bg-black/45 px-3 py-2 text-xs text-slate-300">
        {study.isDicom ? "DICOM loaded" : "Preview mode"}
      </div>
    </>
  );
}

function SegmentationOverlay({ segmentations }: { segmentations: Segmentation[] }) {
  return (
    <>
      {segmentations.map((segmentation, index) => (
        <RoiBoxOverlay
          key={segmentation.id}
          box={segmentation.box}
          label={`${segmentation.source === "medgemma" ? "Medgemma" : "Local"} mask ${index + 1}`}
          className="border-cyan-300/90 bg-cyan-300/10 shadow-[0_0_30px_rgba(103,232,249,0.35)]"
        />
      ))}
    </>
  );
}

function RoiBoxOverlay({ box, label, className }: { box: RoiBox; label: string; className: string }) {
  return (
    <div
      className={`pointer-events-none absolute rounded-[42%] border-2 ${className}`}
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.width * 100}%`,
        height: `${box.height * 100}%`,
      }}
    >
      <div className="absolute inset-[12%] rounded-[48%] border border-white/35 bg-white/5" />
      <span className="absolute -right-3 top-2 translate-x-full whitespace-nowrap rounded border border-cyan-300/40 bg-cyan-950/85 px-2 py-1 text-[11px] font-medium text-cyan-50">
        {label}
      </span>
    </div>
  );
}

function StatusDot({ decision }: { decision: ReviewDecision }) {
  const className = {
    accepted: "text-emerald-300",
    "needs-review": "text-red-300",
    unreviewed: "text-amber-300",
  }[decision];

  return <CircleDot className={`mt-0.5 h-4 w-4 ${className}`} />;
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalizeRoi(start: { x: number; y: number }, end: { x: number; y: number }): RoiBox {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  return {
    x: clamp(x),
    y: clamp(y),
    width: clamp(width),
    height: clamp(height),
  };
}

function ToolbarButton({
  icon: Icon,
  label,
  loading,
  onClick,
}: {
  icon: typeof Upload;
  label: string;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm font-medium text-slate-200 transition hover:border-cyan-300/50 hover:text-cyan-100 disabled:cursor-wait disabled:opacity-70"
      type="button"
      disabled={loading}
      onClick={onClick}
    >
      <Icon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      {label}
    </button>
  );
}

function ActionCard({
  icon: Icon,
  title,
  actionLabel,
  loading,
  children,
  onAction,
}: {
  icon: typeof Sparkles;
  title: string;
  actionLabel: string;
  loading?: boolean;
  children: ReactNode;
  onAction: () => void;
}) {
  return (
    <article className="rounded-md border border-slate-800 bg-[#0c1420] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md border border-cyan-400/25 bg-cyan-400/10 text-cyan-200">
            <Icon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </span>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <button
          className="rounded-md border border-cyan-400/25 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/15 disabled:cursor-wait disabled:opacity-70"
          type="button"
          disabled={loading}
          onClick={onAction}
        >
          {actionLabel}
        </button>
      </div>
      {children}
    </article>
  );
}

function ReportSection({ icon: Icon, title, children }: { icon: typeof Brain; title: string; children: ReactNode }) {
  return (
    <article className="rounded-md border border-slate-800 bg-[#0c1420] p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-md border border-slate-700 bg-slate-950 text-slate-300">
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <p className="text-sm leading-6 text-slate-300">{children}</p>
    </article>
  );
}

export default App;
