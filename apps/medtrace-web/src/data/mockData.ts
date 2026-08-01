export interface Patient {
  id: string;
  name: string;
  age: number;
  sex: 'Male' | 'Female' | 'Other';
  dob: string;
  primaryDoctor: string;
  lastUpdated: string;
  documentCount: number;
  lastVisit: string;
  summary: string;
}

export type RiskLevel = 'High' | 'Medium' | 'Low';
export type AlertPriority = 'High' | 'Medium' | 'Low';
export type LabStatus = 'High' | 'Normal';
export type TrendDirection = 'Worsening' | 'Improving' | 'Stable';
export type DocumentStatus = 'Processed' | 'Processing';

export interface PatientDirectoryItem {
  id: string;
  name: string;
  age: number;
  sex: 'M' | 'F' | 'O';
  lastVisit: string;
  conditions: number;
  risk: RiskLevel;
}

export const patientList: PatientDirectoryItem[] = [
  { id: 'P-1024', name: 'John Doe', age: 56, sex: 'M', lastVisit: 'May 9 2026', conditions: 3, risk: 'High' },
  { id: 'P-1025', name: 'Maria Garcia', age: 42, sex: 'F', lastVisit: 'May 8 2026', conditions: 1, risk: 'Low' },
  { id: 'P-1026', name: 'James Smith', age: 68, sex: 'M', lastVisit: 'May 7 2026', conditions: 4, risk: 'High' },
  { id: 'P-1027', name: 'Sarah Johnson', age: 31, sex: 'F', lastVisit: 'May 5 2026', conditions: 0, risk: 'Low' },
  { id: 'P-1028', name: 'Robert Chen', age: 45, sex: 'M', lastVisit: 'Apr 28 2026', conditions: 2, risk: 'Medium' }
];

export const mockPatient: Patient = {
  id: 'P-1024',
  name: 'John Doe',
  age: 56,
  sex: 'Male',
  dob: '1970-03-15',
  primaryDoctor: 'Dr. Smith',
  lastUpdated: '2026-05-09',
  documentCount: 8,
  lastVisit: 'May 9, 2026',
  summary: 'This patient has a history of type 2 diabetes, hypertension, and high cholesterol. Recent records show worsening blood sugar control and continued elevated blood pressure. The latest medication list includes Metformin and Lisinopril. A penicillin allergy is documented in a previous intake form.'
};

export const activeConditions = [
  { name: 'Type 2 diabetes', status: 'Active', firstSeen: 'Jan 2025', lastMentioned: 'May 2026' },
  { name: 'Hypertension', status: 'Active', firstSeen: 'Mar 2025', lastMentioned: 'May 2026' },
  { name: 'Hyperlipidemia', status: 'Active', firstSeen: 'Jan 2025', lastMentioned: 'Dec 2025' }
];

export const currentMedications = [
  { name: 'Metformin', dose: '500 mg', frequency: 'twice daily', status: 'Active', start: 'Jan 2025', end: '-' },
  { name: 'Lisinopril', dose: '10 mg', frequency: 'once daily', status: 'Active', start: 'Mar 2025', end: '-' },
  { name: 'Atorvastatin', dose: '20 mg', frequency: 'once daily', status: 'Previous', start: 'Jan 2025', end: 'Dec 2025' }
];

export const allergies = [
  {
    allergen: 'Penicillin',
    reaction: 'Rash',
    source: 'Intake Form'
  }
];

export const recentAbnormalFindings = [
  { test: 'HbA1c', value: '8.4%', status: 'high', source: 'Lab Report May 2026' },
  { test: 'Blood pressure', value: '148/92', status: 'elevated', source: 'Visit Summary May 2026' }
];

export const riskAlerts: { message: string; priority: AlertPriority; type: string; evidence: string }[] = [
  { message: 'Documented penicillin allergy', priority: 'High', type: 'allergy', evidence: 'Intake Form 2025' },
  { message: 'HbA1c increased over the last six months', priority: 'High', type: 'value_trend', evidence: 'Jan and May lab reports' },
  { message: 'Blood pressure remains elevated across multiple records', priority: 'Medium', type: 'value_trend', evidence: 'Three recent visit notes' },
  { message: 'Medication list changed between two documents', priority: 'Low', type: 'medication', evidence: 'Prescription Jan 2026' }
];

export const timelineEvents = [
  { date: 'Jan 2025', events: ['Diagnosed with type 2 diabetes', 'Started Metformin', 'Started Atorvastatin'] },
  { date: 'Mar 2025', events: ['Diagnosed with Hypertension', 'Started Lisinopril'] },
  { date: 'Jun 2025', events: ['HbA1c improved to 7.1%'] },
  { date: 'Dec 2025', events: ['Stopped Atorvastatin'] },
  { date: 'Jan 2026', events: ['Blood pressure elevated at 145/90'] },
  { date: 'May 2026', events: ['HbA1c increased to 8.4%', 'Latest lab report uploaded'] }
];

export const labTrends: { test: string; latest: string; status: LabStatus; previous: string; trend: TrendDirection; date: string; range: string; source: string }[] = [
  { test: 'HbA1c', latest: '8.4%', status: 'High', previous: '7.1%', trend: 'Worsening', date: 'May 2026', range: '< 7.0%', source: 'Lab Report May 2026' },
  { test: 'LDL', latest: '150 mg/dL', status: 'High', previous: '135 mg/dL', trend: 'Worsening', date: 'May 2026', range: '< 100 mg/dL', source: 'Lab Report May 2026' },
  { test: 'Creatinine', latest: '1.0 mg/dL', status: 'Normal', previous: '0.9 mg/dL', trend: 'Stable', date: 'May 2026', range: '0.7-1.3 mg/dL', source: 'Lab Report May 2026' }
];

export const uploadedDocuments: { name: string; type: string; uploadDate: string; documentDate: string; status: DocumentStatus; facts: number; reviewStatus: string }[] = [
  { name: 'Lab Report May 2026', type: 'Lab Report', uploadDate: 'May 9, 2026', documentDate: 'May 2026', status: 'Processed', facts: 12, reviewStatus: 'Needs review' },
  { name: 'Prescription Jan 2026', type: 'Prescription', uploadDate: 'Feb 1, 2026', documentDate: 'Jan 2026', status: 'Processed', facts: 7, reviewStatus: 'Approved' },
  { name: 'Discharge Summary 2025', type: 'Hospital Summary', uploadDate: 'Dec 20, 2025', documentDate: 'Dec 2025', status: 'Processed', facts: 18, reviewStatus: 'Approved' }
];

export const pendingFacts = [
  { fact: 'Patient has type 2 diabetes.', source: 'Discharge Summary 2025', confidence: '94%', objectId: 'fact-1', status: 'Pending Review' },
  { fact: 'HbA1c increased from 7.1% to 8.4%.', source: 'Lab Report May 2026', confidence: '98%', objectId: 'fact-2', status: 'Pending Review' },
  { fact: 'Penicillin allergy caused rash.', source: 'Intake Form 2025', confidence: '91%', objectId: 'fact-3', status: 'Pending Review' }
];

export const doctorChecklist = [
  'Review elevated HbA1c trend',
  'Confirm current diabetes medication adherence',
  'Check if patient is still taking Lisinopril',
  'Review documented penicillin allergy before prescribing antibiotics'
];

export const evidenceInsights = [
  {
    title: 'Worsening glucose control',
    detail: 'HbA1c rose from 7.1% to 8.4% across uploaded lab reports.',
    evidence: ['Lab Report Jan 2026: HbA1c 7.1%', 'Lab Report May 2026: HbA1c 8.4%'],
    priority: 'High'
  },
  {
    title: 'Persistent elevated blood pressure',
    detail: 'Blood pressure remains elevated across the last three clinical records.',
    evidence: ['Visit note Jan 2026: 145/90', 'Visit Summary May 2026: 148/92'],
    priority: 'Medium'
  },
  {
    title: 'Medication continuity check',
    detail: 'Latest document still lists Metformin and Lisinopril; Atorvastatin appears stopped.',
    evidence: ['Prescription Jan 2026', 'Discharge Summary Dec 2025'],
    priority: 'Low'
  }
];
