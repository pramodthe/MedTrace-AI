# AGENTS.md

## Cursor Cloud specific instructions

This is a **single converged monorepo** containing two product stacks that share the
Python package in `src/medtrace_agent/`. (Historically these lived on separate branches;
they are now unified into one trunk.)

### Monorepo layout

```
apps/
  radiology-web/     React/Vite UI for the radiology imaging stack (port 5173)
  medtrace-web/      React/Vite UI for the Medtrace clinical stack (port 3000)
  api/               Medtrace FastAPI bridge (apps.api.main:app, port 8001)
  streamlit_app.py   Medtrace Streamlit demo UI (port 8501)
services/
  radiology-api/     Radiology FastAPI (DICOM upload, MedSAM2, reports; port 8000)
  medsamlite/        Standalone Swin-LiteMedSAM segmentation demo (port 7870)
  transcription/     Voice/CopilotKit prototype (backend + copilotkit-server + its own
                     frontend) imported from the old `voice-note` branch. NOT wired into
                     the main apps yet — preserved as a prototype for future integration.
src/medtrace_agent/  Shared Python package (Zep, ingest, agents, InsForge, ontology)
migrations/ mock/ scripts/ tests/
```

See `README.md` (Medtrace stack) and `CLAUDE.md` (radiology stack) for architecture details.

### Two stacks (don't confuse them)

- **Radiology stack** — `services/radiology-api/` + `apps/radiology-web/`. DICOM upload,
  MedSAM2 segmentation, draft reports. **Runs fully in mock mode with no external
  secrets** — easiest to run and test end to end.
- **Medtrace stack** — `apps/streamlit_app.py` + `apps/api/` + `apps/medtrace-web/`.
  Clinical memory dashboard + note-taking. Its runtime **requires secrets** to do
  anything real: `ZEP_API_KEY`, `FIREWORKS_API_KEY`, and `INSFORGE_*` (see `.env.example`).
  There is **no offline mock** for this stack; without keys, `apps/api` returns 503 for
  patient/document routes. Copy `.env.example` -> `.env` and fill these before running it.

### Running everything (one command)

From the repo root: `npm run dev` starts all four primary services concurrently on fixed,
non-conflicting ports (radiology-api 8000, radiology-web 5173, medtrace-api 8001,
medtrace-web 3000). `medtrace-web` is started with `VITE_API_BASE_URL=http://localhost:8001`
by that script so it targets the Medtrace API and not the radiology one.

Scoped subsets and individual services are defined as npm scripts in the root
`package.json` (`npm run dev:radiology`, `npm run dev:medtrace`, `dev:streamlit`, etc.) —
prefer editing/reading those over re-deriving commands.

### Environment layout (created by the startup update script)

- A **single shared virtualenv** at `/workspace/.venv` holds BOTH the root editable
  package (`pip install -e ".[dev]"`, covers Streamlit/apps.api/tests) AND the radiology
  backend deps (`services/radiology-api/requirements.txt`). Use `.venv/bin/python` for all
  Python services and `pytest`.
- npm deps: root (`concurrently`) + `apps/radiology-web` + `apps/medtrace-web`.

### Non-obvious gotchas

- **Two FastAPI apps, fixed ports**: radiology-api is 8000, medtrace-api is 8001. They used
  to both default to 8000; the root `npm run dev` scripts pin them apart. If you run a
  backend manually, keep this split.
- **Vite binds to `localhost` (IPv6)**: health-check with `curl http://localhost:5173`
  (or `:3000`), not `http://127.0.0.1:5173`.
- **Radiology sample endpoint is broken out of the box**: `GET /sample-studies/pre-liver`
  expects a `2.000000-PRE LIVER-76970/` DICOM folder at the repo root that isn't committed.
  Use `POST /studies` upload instead; a ready sample DICOM ships with pydicom at
  `.venv/lib/python3.12/site-packages/pydicom/data/test_files/MR_small.dcm`.
- **"Doctor Accepts Draft"** (radiology UI) only updates a small status dot, not a banner —
  expected app behavior, not a bug.
- **`services/transcription/`** is a preserved prototype (from the old `voice-note` branch).
  Its backend/`copilotkit-server`/frontend are NOT installed or run by the default
  `npm run dev` and are not covered by the update script. The Medtrace UI's "Start Session"
  button links to `VITE_TRANSCRIPTION_URL` and expects such a service to be running.

### Tests / lint / build

- Python tests: `.venv/bin/pytest -m "not integration"` (the `integration` marker hits the
  live NCBI PubMed API and needs network). Or `npm run test:py`.
- `apps/radiology-web`: no lint script; `npm --prefix apps/radiology-web run build`
  (`tsc -b && vite build`) is the type/build check.
- `apps/medtrace-web`: `npm --prefix apps/medtrace-web run lint` (`tsc --noEmit`);
  build via `npm --prefix apps/medtrace-web run build`. `npm run build:web` builds both.
