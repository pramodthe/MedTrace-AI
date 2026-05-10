# Medtrace Agent —

**“clinical decision support” or “cognitive aid”**: not replacing the doctor, but surfacing **patterns, timelines, and test ideas** the clinician still validates.



#  Architecture

Streamlit demo that combines **Zep Cloud** (long-term memory + temporal knowledge graph) with a **LangChain / OpenAI-compatible chat model** (default: Nebius Token Factory). This document describes how the pieces fit together.

## High-level picture

```mermaid
flowchart LR
  subgraph ui [Streamlit UI]
    APP[apps/streamlit_app.py]
  end
  subgraph llm [LLM layer]
    AG[medtrace_agent.agents.rag_chat]
    NEB[Nebius / OpenAI-compatible API]
  end
  subgraph zep [Zep Cloud]
    TH[Thread API]
    GR[Graph API]
  end
  APP --> AG
  AG --> NEB
  APP --> ZM[zep/memory.py]
  APP --> ZG[zep/graph.py]
  APP --> DOC[ingest/documents.py]
  APP --> SCAN[ingest/scan_extract.py]
  APP --> ONTO[ontology/clinical.py]
  APP --> DCA[agents/deep_clinical.py]
  ZM --> TH
  DOC --> GR
  SCAN --> NEB
  ONTO --> GR
  ZG --> GR
  TH --> AG
  DCA --> NEB
  DCA --> GR
```



- **UI** owns session state (patient id, thread id, ingested-document registry, chat history).
- **Agent** — default **`chat_with_memory`** builds the system prompt (Zep context + optional document catalog) and calls the LLM once. Optional **Clinical reasoning (Deep Agent)** uses **`medtrace_agent.agents.deep_clinical`** (`create_deep_agent`) with Zep tools + PubMed (`integrations/pubmed`).
- **Zep** stores conversational turns on **threads** and structured memories / episodes on the **user graph** (PDF chunks, extracted facts, ontology-backed nodes).

## AI agent architecture

How **`apps/streamlit_app.py`** chooses between the **fast RAG chat** and the **Deep Clinical Agent**, and how each connects to Nebius, Zep, and PubMed.

```mermaid
flowchart TB
  subgraph ui [Streamlit apps/streamlit_app.py]
    toggle{Clinical reasoning Deep Agent}
    chatIn[Chat input or sample prompts]
    chatIn --> toggle
    toggle -->|No| fastPath[Fast path]
    toggle -->|Yes| deepPath[Deep path]
  end

  subgraph fastAgent [Fast path rag_chat.py]
    SYS1[System prompt plus catalog]
    CTX1[Zep context via fetch_thread_context]
    HIST1[Thread messages thread.get]
    LLM1[ChatOpenAI Nebius]
    fastPath --> LLM1
    SYS1 --> LLM1
    CTX1 --> LLM1
    HIST1 --> LLM1
  end

  subgraph deepAgent [Deep agent deep_clinical.py]
    DA[create_deep_agent LangGraph]
    HARNESS[Deep Agents middleware]
    TOOLS[Custom Zep and PubMed tools]
    LLM2[ChatOpenAI Nebius]
    CP[MemorySaver thread_id]
    deepPath --> DA
    DA --> HARNESS
    DA --> LLM2
    DA --> TOOLS
    DA --> CP
  end

  subgraph toolList [Custom tools]
    T1[get_zep_thread_context]
    T2[list_graph_episodes]
    T3[list_temporal_edges]
    T4[search_patient_ontology_nodes]
    T5[search_patient_ontology_edges]
    T6[pubmed_search_literature]
    TOOLS --> T1
    TOOLS --> T2
    TOOLS --> T3
    TOOLS --> T4
    TOOLS --> T5
    TOOLS --> T6
  end

  subgraph zep [Zep Cloud]
    TH[Thread API]
    GR[Graph API]
    T1 --> TH
    T2 --> GR
    T3 --> GR
    T4 --> GR
    T5 --> GR
  end

  subgraph ncbi [NCBI API]
    EU[integrations/pubmed esearch esummary]
    T6 --> EU
  end

  subgraph persist [After each reply]
    AT[append_turn add_messages]
    LLM1 --> AT
    LLM2 --> AT
  end
```

| Piece | Role |
|--------|------|
| **Fast path** | Single **`chat_with_memory`** call: system prompt + Zep **`thread.get_user_context`** text (via **`fetch_thread_context`**) + recent **`thread.get`** messages + optional ingested-document catalog. **No tool loop.** |
| **Deep path** | **`create_deep_agent`** with the same Nebius **`ChatOpenAI`**, custom tools for Zep graph + PubMed, **`MemorySaver`** keyed by Streamlit **`thread_id`**, plus built-in Deep Agents middleware (planning, virtual filesystem, subagents — not shown in detail). |
| **PubMed** | **`medtrace_agent.integrations.pubmed`** — NCBI **E-utilities** (`esearch` / `esummary`) over HTTP JSON, **not** HTML scraping. |

## Repository layout

| Path | Purpose |
|------|---------|
| `pyproject.toml` | Package metadata, dependencies, pytest config (`medtrace-agent`, installable from `src/`). |
| `src/medtrace_agent/` | Importable package: `zep`, `ontology`, `integrations`, `agents`, `ingest`. |
| `apps/streamlit_app.py` | Streamlit entrypoint (demo UI). |
| `tests/` | Pytest suite (`pip install -e ".[dev]"` includes pytest). |
| `data/` | Sample note paths (PDFs/notes gitignored; keep `.gitkeep` where needed). |

## Module responsibilities


| Module | Role |
| ------ | ---- |
| `apps/streamlit_app.py` | Streamlit layout: sidebar (patient, **Clinical reasoning (Deep Agent)** checkbox, PDF upload, ontology, graph controls), chat column, graph inspector. Dual chat path: **`chat_with_memory`** vs **`run_clinical_deep_agent_turn`**. |
| `medtrace_agent.agents.rag_chat` | `chat_with_memory(...)`: composes system prompt from base instructions, **Memory context** (`zep_context`), and **Ingested clinical documents** (`document_catalog`). Invokes `ChatOpenAI` against Nebius base URL + API key. |
| `medtrace_agent.agents.deep_clinical` | **`create_deep_agent`** (LangChain Deep Agents): Zep tools (`get_zep_thread_context`, episodes, edges, ontology search) + **`pubmed_search_literature`**, **`MemorySaver`** checkpointing keyed by Streamlit `thread_id`. Non-diagnostic CDS framing. |
| `medtrace_agent.integrations.pubmed` | NCBI **esearch** + **esummary** (JSON) for PubMed titles/PMIDs; uses **`NCBI_EMAIL`** / **`NCBI_API_KEY`** when set. |
| `medtrace_agent.zep.memory` | Zep client singleton; `ensure_user`, `ensure_session` (thread create); `fetch_thread_context` (`thread.get_user_context` + `thread.get` message tail); `append_turn` (`thread.add_messages`). Handles duplicate-user / duplicate-thread `BadRequestError` shapes. |
| `medtrace_agent.zep.graph` | Read-only inspector: episodes by user, temporal edges by user, ontology-scoped `graph.search` for nodes/edges. Returns `pandas` frames for Streamlit. |
| `medtrace_agent.ingest.documents` | `pdf_bytes_to_text(...)` (PDF → **`ingest.scan_extract`** VLM or **`pypdf`**). **`ingest_pdf_text_to_patient_graph`**, **`ingest_plain_text_note_to_patient_graph`**, **`ingest_txt_path_to_patient_graph`** for **`data/radiology_note/`** and **`data/session_note/`** `.txt` files. All paths use **`chunk_for_zep`** then **`graph.add`**. |
| `medtrace_agent.ingest.scan_extract` | **`pdf_to_page_images_png`**, **`vl_extract_single_page`** (LangChain `ChatOpenAI` + vision), Pydantic **`PageVLMExtract`**, **`pdf_bytes_via_vlm`** / **`serialize_pages_for_ingest`**. |
| `medtrace_agent.ontology.clinical` | Clinical demo ontology (entity + edge type definitions). `apply_clinical_ontology` calls `graph.set_ontology` (default: project-wide registration so dashboard visibility matches Zep docs). |


## Zep: thread vs graph

Understanding this split is central to the architecture.

### Thread (short dialog + rolling context)

- Identified by `**thread_id**` (the app calls this the “session” in places; Zep SDK uses `thread`).
- `**thread.get_user_context(thread_id)**` returns synthesized context for the model (facts Zep derives from history + graph).
- `**thread.get(thread_id, lastn=…)**` supplies recent messages for LangChain (short-term conversational continuity).
- `**thread.add_messages**` appends the latest user + assistant turns after each reply so Zep can absorb them into memory.

Threads are **per conversation session**; changing “New thread” creates a new id while keeping the same **user** (`zep_user_id`), so long-term recall can still attach to the patient user in Zep.

### Graph (episodes, facts, ontology)

- `**graph.add`** ingests PDF-derived **text** episodes tagged with metadata (`doc_id`, filename, etc.). Zep’s pipeline turns content into episodes and, over time, **temporal edges / facts** visible in the inspector.
- `**graph.set_ontology`** registers custom entity and edge types for extraction (clinical demo schema).
- `**graph.episode.get_by_user_id**` / `**graph.edge.get_by_user_id**` back the Streamlit “Knowledge graph inspector”.
- `**graph.search**` powers ontology-filtered lookups in the UI.

The **patient** is modeled as a Zep **user** (`zep_user_id`). All graph reads/writes for that demo patient use this id.

## Chat turn sequence

1. User submits a message in Streamlit.
2. `**fetch_thread_context(thread_id)`** → `zep_context` string + last N `Message` objects from Zep.
3. `**_format_document_catalog(ingested_docs)**` builds a bullet list of PDFs registered **in this Streamlit session** (`doc_id`, filename, upload time, episode count).
4. **Chat path** (sidebar):
   - **Default:** `**chat_with_memory**` builds `SystemMessage` + LangChain history + new `HumanMessage`, single LLM call.
   - **Clinical reasoning (Deep Agent):** `**run_clinical_deep_agent_turn**` runs **`create_deep_agent`** with Zep + PubMed tools and LangGraph **`MemorySaver`** (same `thread_id`). Slower; includes Deep Agents planning/filesystem middleware — demo only.
5. Assistant text is shown; optional captions for ingested-doc registry and Deep Agent turns.
6. `**append_turn**` pushes user + assistant strings to Zep via `**thread.add_messages**`.

### Clinical reasoning mode (constraints)

Educational demo only: outputs are **not** a diagnosis or substitute for clinical judgment. PubMed results depend on NCBI availability; set **`NCBI_EMAIL`** (and optionally **`NCBI_API_KEY`**) in `.env` for reliable E-utilities access.

## PDF ingest sequence

**Default (vision):** every PDF is rendered **page-by-page to PNG** with **PyMuPDF** (`fitz`). Each image is sent to `**NEBIUS_VL_MODEL`** via OpenAI-compatible `**ChatOpenAI**` (multimodal messages). The model returns **JSON** (structured clinical fields + `**page_visible_text`** transcript), validated with **Pydantic**, then concatenated into one plain-text document by `**serialize_pages_for_ingest`**.

**Optional fast path (“Skip VLM” in the UI):** `**pdf_bytes_to_text_pypdf`** reads only the embedded text layer (`pypdf`). Cheaper and faster for born-digital PDFs; **does not** read scanned pages, handwriting, or text that exists only inside embedded bitmaps.

Then, for each file:

1. The app assigns a `**doc_id`** and calls `**ingest_pdf_text_to_patient_graph**`, which `**chunk_for_zep**` splits the document and `**graph.add(type="text", ...)**` uploads each chunk (header includes `doc_id` / filename / chunk index). Metadata records `**extract_mode**` (`vlm_png` vs `pypdf`).
2. Returned episode UUIDs are counted; `**ingested_docs**` is updated so chat can cite `**doc_id` / filename**.

**Cost note:** vision ingest runs **one VLM call per page** (plus an occasional JSON repair call). Use `**PDF_VL_MAX_PAGES`** and sidebar limits to cap spend; lower `**PDF_VL_DPI**` to shrink images.

## Document ingestion architecture

End-to-end flow for **PDF uploads**, `**data/radiology_note/*.txt`**, and `**data/session_note/*.txt**`: all sources normalize to **chunked text** with per-source headers and metadata, then `**graph.add(type="text")`** on the patient `**user_id**`.

```mermaid
flowchart TB
  subgraph inputs [Ingestion inputs]
    PDF[PDF upload in UI]
    RAD[data/radiology_note/*.txt]
    SESS[data/session_note/*.txt]
  end

  subgraph pdfPath [PDF text extraction]
    PDF --> mode{Skip VLM?}
    mode -->|no| raster[PyMuPDF page to PNG]
    raster --> vlm[ingest.scan_extract VLM per page]
    vlm --> unifiedStr[Single plain text document]
    mode -->|yes| pypdf[pypdf extract_text]
    pypdf --> unifiedStr
  end

  subgraph notePath [Plain text notes]
    RAD --> readR[Read UTF-8 text]
    SESS --> readS[Read UTF-8 text]
    readR --> noteFnR[ingest_plain_text_note_to_patient_graph]
    readS --> noteFnS[ingest_plain_text_note_to_patient_graph]
    noteFnR --> hdrR[Header RadiologyNote plus chunk body]
    noteFnS --> hdrS[Header SessionNote plus chunk body]
  end

  unifiedStr --> pdfIngest[ingest_pdf_text_to_patient_graph]
  pdfIngest --> hdrP[Header ClinicalDocument plus chunk body]

  subgraph chunking [Shared chunking]
    hdrP --> chunkZep[chunk_for_zep]
    hdrR --> chunkZep
    hdrS --> chunkZep
  end

  subgraph zepGraph [Zep Cloud graph]
    chunkZep --> gadd["graph.add(type=text)"]
    gadd --> episodes[Episodes on patient user_id]
  end

  subgraph meta [Metadata]
    gadd -.-> kindHint[kind pdf_medical_history radiology_note session_note]
    gadd -.-> idHint[doc_id filename chunk_index extract_mode optional]
  end
```




| Route                         | Typical Zep metadata `**kind**` | Chunk header prefix    |
| ----------------------------- | ------------------------------- | ---------------------- |
| PDF (default VLM or Skip VLM) | `pdf_medical_history`           | `[ClinicalDocument …]` |
| `data/radiology_note/*.txt`   | `radiology_note`                | `[RadiologyNote …]`    |
| `data/session_note/*.txt`     | `session_note`                  | `[SessionNote …]`      |


## Vision ingest risks

Vision models can **misread numbers** or **hallucinate** structured fields. Treat output as **demo-grade** unless validated. Not a certified medical device or OCR pipeline.

## Session state (important caveats)

- `**ingested_docs`** lives only in the browser session. Reloading Streamlit clears it; Zep may still retain graph episodes from earlier runs.
- **Document catalog** injected into the LLM is derived from `**ingested_docs`**, not from a live Zep query. After a reload, citations may rely on memory alone until PDFs are re-ingested or registry persistence is added.

## Configuration

See `.env.example`. Required:

- `**NEBIUS_API_KEY**` — Token Factory / OpenAI-compatible endpoint for `ChatOpenAI`.
- `**ZEP_API_KEY**` — Zep Cloud project.

Optional env vars (defaults in code): `NEBIUS_BASE_URL`, `NEBIUS_MODEL`.

Vision PDF ingest (required for default ingest unless the user enables **Skip VLM** in the UI):

- `**NEBIUS_VL_MODEL`** — multimodal model slug on the same OpenAI-compatible base URL as chat.
- `**PDF_VL_MAX_PAGES**` (default `25`), `**PDF_VL_DPI**` (default `150`) — caps and render quality for PyMuPDF rasterization.

Clinical reasoning / PubMed (optional):

- `**NCBI_EMAIL**` — recommended for NCBI E-utilities etiquette.
- `**NCBI_API_KEY**` — optional; higher rate limits.

## Running (minimal)

```bash
python -m venv .venv
source .venv/bin/activate   # or Windows equivalent
pip install -e ".[dev]"   # editable package + pytest; or: pip install -r requirements.txt
cp .env.example .env      # fill keys
streamlit run apps/streamlit_app.py
# or (same UI): streamlit run app.py   # thin shim at repo root
```

Run tests:

```bash
pytest
```

## Dependency stack

- **streamlit** — UI and session state  
- **zep-cloud** (v3) — `Zep` client, thread + graph APIs  
- **langchain-openai** / **langchain-core** — `ChatOpenAI` pointed at Nebius  
- **pandas** — tables for the graph inspector  
- **pypdf** — optional fast text-layer extraction (Skip VLM)  
- **pymupdf** — PDF page rasterization for vision ingest  
- **pydantic** — validate VLM JSON before Zep ingest  
- **deepagents** — optional Deep Agent chat path (`medtrace_agent.agents.deep_clinical`)

