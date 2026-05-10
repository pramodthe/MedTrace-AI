#!/usr/bin/env bash
# Seed rich synthetic clinical content for Reese Dalton (chart_subject_id below)
# so that the React dashboard's AI summary, snapshot cards, lab trends, timeline,
# and alerts render with meaningful demo data.
#
# Usage:
#   bash scripts/seed_reese_dalton.sh [API_BASE]
#
set -euo pipefail

API_BASE="${1:-http://127.0.0.1:8001}"
PATIENT_ID="08287c98-ebb1-44a7-abf3-670715b63f5d"  # Reese Dalton (synthetic-mock-pt-010)

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

############################
# 1. Comprehensive history
############################
cat > "$TMPDIR/reese_dalton_history.txt" <<'EOF'
Patient: Reese Dalton (synthetic-mock-pt-010)
Sex: Female  -  Age: 23
Primary care: Dr. Mock (Primary care)
Allergies: Penicillin -- caused widespread rash documented at 2024 intake; flagged HIGH risk.

----------------------------------------
Encounter: Initial intake -- Jan 2025
----------------------------------------
History of present illness: 23 year old presenting for new-patient wellness establishment. Reports occasional fatigue, polyuria, mild blurry vision over the past 3 months. Family history of type 2 diabetes (mother) and hypertension (father).

Vitals
- Blood pressure: 142/90 mmHg
- Heart rate: 84 bpm
- BMI 31.4

Labs (Jan 2025)
- HbA1c: 7.4 %
- LDL: 138 mg/dL
- HDL: 44 mg/dL
- Cholesterol: 226 mg/dL
- Creatinine: 0.9 mg/dL
- Glucose: 158 mg/dL

Assessment
- New diagnosis: Type 2 diabetes mellitus.
- New diagnosis: Hypertension, stage 2.
- Hyperlipidemia.

Plan
- Started Metformin 500 mg twice daily.
- Started Lisinopril 10 mg once daily.
- Started Atorvastatin 20 mg once daily.
- Lifestyle counseling.
- Follow up labs in 3 months.

----------------------------------------
Encounter: 3-month follow up -- Apr 2025
----------------------------------------
Vitals
- Blood pressure: 134/86 mmHg
- BMI 30.8

Labs (Apr 2025)
- HbA1c: 6.9 %
- LDL: 118 mg/dL
- Creatinine: 0.9 mg/dL
- Glucose: 132 mg/dL

Assessment
- Type 2 diabetes -- improving on Metformin.
- Hypertension -- improved but still elevated.
- Hyperlipidemia -- improving.

Plan
- Continue Metformin 500 mg twice daily.
- Continue Lisinopril 10 mg once daily.
- Continue Atorvastatin 20 mg once daily.
- Recheck labs in 6 months.

----------------------------------------
Encounter: Phone consult -- Sep 2025
----------------------------------------
Patient called complaining of myalgia. Concern for statin myopathy.

Plan
- Stopped Atorvastatin (Sep 2025) pending further evaluation.
- Continue Metformin and Lisinopril.

----------------------------------------
Encounter: Routine visit -- Jan 2026
----------------------------------------
Vitals
- Blood pressure: 145/92 mmHg
- BMI 31.0

Labs (Jan 2026)
- HbA1c: 7.8 %
- LDL: 152 mg/dL
- HDL: 41 mg/dL
- Creatinine: 1.0 mg/dL
- Glucose: 168 mg/dL

Assessment
- Type 2 diabetes -- worsening glucose control after period of fair control.
- Hypertension -- stage 2 again, BP elevated across last 3 measurements.
- Hyperlipidemia -- LDL trending up after stopping statin.

Plan
- Continue Metformin 500 mg twice daily; consider step-up if A1c >= 8 next visit.
- Continue Lisinopril 10 mg once daily.
- Statin discussion -- patient declined re-trial today.
- Recheck labs in 4 months.

----------------------------------------
Encounter: Most recent visit -- May 2026
----------------------------------------
Vitals
- Blood pressure: 148/93 mmHg
- BMI 31.6

Labs (May 2026)
- HbA1c: 8.4 %
- LDL: 158 mg/dL
- HDL: 42 mg/dL
- Cholesterol: 242 mg/dL
- Creatinine: 1.0 mg/dL
- Glucose: 184 mg/dL

Assessment
- Type 2 diabetes -- WORSENING. HbA1c climbed from 6.9 to 8.4 over the past year.
- Hypertension -- persistently elevated across multiple visits.
- Hyperlipidemia -- worsening LDL after Atorvastatin stopped Sep 2025.

Plan
- Increase Metformin to 1000 mg twice daily.
- Continue Lisinopril 10 mg once daily; add second agent at next visit if BP > 140/90.
- Re-trial Atorvastatin 10 mg once daily (lower dose); educate on adherence and myalgia symptoms.
- Recheck labs in 12 weeks.
- Reinforce penicillin allergy -- avoid amoxicillin / ampicillin.

Active medications (current, May 2026)
- Metformin 1000 mg twice daily (started Jan 2025 at 500 mg, increased May 2026)
- Lisinopril 10 mg once daily (started Jan 2025)
- Atorvastatin 10 mg once daily (re-started May 2026 after pause Sep 2025 - May 2026)

Documented allergies
- Penicillin -- rash, intake form 2024.

Active conditions
- Type 2 diabetes mellitus -- diagnosed Jan 2025.
- Hypertension -- diagnosed Jan 2025.
- Hyperlipidemia -- diagnosed Jan 2025.
EOF

############################
# 2. Radiology note
############################
cat > "$TMPDIR/reese_dalton_radiology.txt" <<'EOF'
Reese Dalton -- Carotid duplex ultrasound -- Mar 2026

Indication: Vascular screening given multiple cardiovascular risk factors (Type 2 diabetes, Hypertension, Hyperlipidemia).

Findings
- Right carotid: mild plaque, < 30 % stenosis.
- Left carotid: mild plaque, < 30 % stenosis.
- Vertebral arteries patent bilaterally.

Impression
- Mild bilateral carotid atherosclerotic disease.
- Recommend aggressive risk factor modification (LDL control, BP control, A1c control).
EOF

############################
# Upload + chat seed
############################
echo "--- upload Reese Dalton clinical history ---"
curl -sS -X POST "${API_BASE}/api/patients/${PATIENT_ID}/documents" \
  -F "file=@${TMPDIR}/reese_dalton_history.txt;filename=reese_dalton_history.txt;type=text/plain" \
  -F "document_kind=conversation_note" \
  -F "extract_mode=text" | sed -e 's/.\{220\}/&\n/g' | head -20

echo ""
echo "--- upload radiology note ---"
curl -sS -X POST "${API_BASE}/api/patients/${PATIENT_ID}/documents" \
  -F "file=@${TMPDIR}/reese_dalton_radiology.txt;filename=reese_dalton_carotid_us.txt;type=text/plain" \
  -F "document_kind=radiology_note" \
  -F "extract_mode=text" | sed -e 's/.\{220\}/&\n/g' | head -20

echo ""
echo "--- ensure thread + send seeding chat message ---"
THREAD_JSON=$(curl -sS -X POST "${API_BASE}/api/patients/${PATIENT_ID}/threads" \
  -H "Content-Type: application/json" \
  -d '{"title":"Primary chart"}')
ZEP_THREAD_ID=$(.venv/bin/python -c "import sys, json; print(json.loads(sys.argv[1])['zep_thread_id'])" "$THREAD_JSON" 2>/dev/null || true)
if [ -z "${ZEP_THREAD_ID:-}" ]; then
  # fall back to existing
  ZEP_THREAD_ID=$(curl -sS "${API_BASE}/api/patients/${PATIENT_ID}/threads" | .venv/bin/python -c "import sys,json; rows=json.load(sys.stdin); print(rows[0]['zep_thread_id'] if rows else '')")
fi
echo "thread: ${ZEP_THREAD_ID}"

curl -sS -X POST "${API_BASE}/api/threads/${ZEP_THREAD_ID}/messages" \
  -H "Content-Type: application/json" \
  -d '{"user_input":"Summarise the patient including conditions, current medications, allergies, and the most important recent change. Keep it under 5 sentences.","deep":false}' \
  | .venv/bin/python -c "import sys, json; r=json.load(sys.stdin); print('\nassistant:', r['assistant']['content'])"

echo ""
echo "--- regenerate AI summary on chart_subjects.metadata ---"
curl -sS -X POST "${API_BASE}/api/patients/${PATIENT_ID}/summary" \
  | .venv/bin/python -c "import sys, json; p=json.load(sys.stdin); print('summary:', p.get('summary'))"

echo ""
echo "Done."
