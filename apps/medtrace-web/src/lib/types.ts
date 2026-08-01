// Types mirror apps/api/schemas.py.

export type DocumentKind = 'clinical_pdf' | 'radiology_note' | 'conversation_note';
export type RiskLevel = 'High' | 'Medium' | 'Low';
export type LabStatus = 'High' | 'Normal' | 'Low' | 'Borderline';
export type TrendDirection = 'Worsening' | 'Improving' | 'Stable';
export type DocumentStatus = 'Processed' | 'Processing';

export interface Patient {
  id: string;
  zep_user_id: string;
  name: string;
  age: number;
  sex: 'M' | 'F' | 'O';
  dob: string | null;
  primary_doctor: string | null;
  last_visit: string | null;
  last_updated: string | null;
  document_count: number;
  conditions: number;
  risk: RiskLevel;
  summary: string | null;
  metadata: Record<string, unknown>;
}

export interface CreatePatientPayload {
  zep_user_id: string;
  display_name: string;
  age?: number;
  sex?: 'M' | 'F' | 'O';
  dob?: string;
  primary_doctor?: string;
  notes?: string;
  tags?: string[];
}

export interface DocumentRecord {
  doc_id: string;
  filename: string;
  document_kind: DocumentKind;
  extract_mode: string | null;
  episode_count: number;
  storage_url: string | null;
  storage_key: string | null;
  storage_bucket: string | null;
  uploaded_at: string;
  status: DocumentStatus;
  review_status: string;
}

export interface IngestResult {
  document: DocumentRecord;
  episode_ids: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string | null;
  name: string | null;
}

export interface ChatThread {
  id: string;
  zep_thread_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface SendMessageResult {
  user: ChatMessage;
  assistant: ChatMessage;
}

export interface TimelinePeriod {
  date: string;
  events: string[];
}

export interface LabTrend {
  test: string;
  latest: string;
  previous: string | null;
  status: LabStatus;
  trend: TrendDirection;
  date: string | null;
  range: string | null;
  source: string | null;
}

export interface ConditionRecord {
  name: string;
  status: string;
  first_seen: string | null;
  last_mentioned: string | null;
}

export interface MedicationRecord {
  name: string;
  dose: string | null;
  frequency: string | null;
  status: 'Active' | 'Previous';
  start: string | null;
  end: string | null;
}

export interface AllergyRecord {
  allergen: string;
  reaction: string | null;
  source: string | null;
}

export interface AbnormalFinding {
  test: string;
  value: string;
  status: string;
  source: string | null;
}

export interface RiskAlert {
  message: string;
  priority: RiskLevel;
  type: string;
  evidence: string | null;
}

export interface EvidenceInsight {
  title: string;
  detail: string;
  evidence: string[];
  priority: RiskLevel;
}

export interface ClinicalSnapshot {
  patient: Patient;
  insights: EvidenceInsight[];
  active_conditions: ConditionRecord[];
  current_medications: MedicationRecord[];
  allergies: AllergyRecord[];
  recent_abnormal: AbnormalFinding[];
  risk_alerts: RiskAlert[];
  lab_trends: LabTrend[];
  timeline: TimelinePeriod[];
  documents: DocumentRecord[];
  doctor_checklist: string[];
}
