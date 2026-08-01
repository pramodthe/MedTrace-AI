/**
 * Tiny typed wrapper around the FastAPI service at VITE_API_BASE_URL.
 * Centralises error shaping so hooks can render friendly messages.
 */

const RAW_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';
const API_BASE_URL = RAW_BASE.replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let detail: string | undefined;
  let payload: unknown;
  try {
    payload = await res.json();
    if (payload && typeof payload === 'object' && 'detail' in payload) {
      const d = (payload as { detail?: unknown }).detail;
      detail = typeof d === 'string' ? d : JSON.stringify(d);
    }
  } catch {
    try {
      detail = await res.text();
    } catch {
      detail = undefined;
    }
  }
  return new ApiError(detail || `Request failed (${res.status})`, res.status, payload);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const res = await fetch(url, init);
  if (!res.ok) {
    throw await parseError(res);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: 'GET', signal });
}

export function apiPost<TResp, TBody = unknown>(
  path: string,
  body?: TBody,
  signal?: AbortSignal,
): Promise<TResp> {
  return request<TResp>(path, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
}

export async function apiUpload<TResp>(
  path: string,
  file: File,
  fields: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<TResp> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  for (const [k, v] of Object.entries(fields)) {
    fd.append(k, v);
  }
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    body: fd,
    signal,
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  return (await res.json()) as TResp;
}

export const API_BASE = API_BASE_URL;
