/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_INSFORGE_URL?: string;
  readonly VITE_INSFORGE_ANON_KEY?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_TRANSCRIPTION_URL?: string;
  readonly VITE_RADIOLOGY_URL?: string;
  readonly GEMINI_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
