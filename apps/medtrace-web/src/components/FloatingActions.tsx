import { Mic, ScanLine } from 'lucide-react';

const TRANSCRIPTION_URL =
  import.meta.env.VITE_TRANSCRIPTION_URL ?? 'http://localhost:5173/transcription';
const RADIOLOGY_URL = import.meta.env.VITE_RADIOLOGY_URL ?? 'http://localhost:5175';

export function FloatingActions() {
  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col items-start gap-3">
      <a
        href={TRANSCRIPTION_URL}
        target="_blank"
        rel="noreferrer"
        className="group inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition-all hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        title="Open live transcription session"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 group-hover:bg-white/25">
          <Mic size={14} className="group-hover:animate-pulse" />
        </span>
        Start Session
      </a>

      <a
        href={RADIOLOGY_URL}
        target="_blank"
        rel="noreferrer"
        className="group inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/30 transition-all hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-slate-500/40"
        title="Open radiology workstation"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 group-hover:bg-white/25">
          <ScanLine size={14} />
        </span>
        Radiology
      </a>
    </div>
  );
}
