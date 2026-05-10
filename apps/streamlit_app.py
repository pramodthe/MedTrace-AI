"""
Streamlit demo: LangChain + Nebius Token Factory chat with Zep long-term memory,
clinical ontology, PDF medical-history ingest, and graph inspector.

Run from repo root. Prefer ``pip install -e .`` so all tools see the package; the
app also prepends ``src/`` to ``sys.path`` so ``streamlit run`` works from a clean clone.

::

    streamlit run apps/streamlit_app.py

Environment: copy ``.env.example`` to ``.env`` and set NEBIUS_API_KEY and ZEP_API_KEY.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Repo layout: .../<repo>/apps/streamlit_app.py → add .../<repo>/src for imports when
# ``pip install -e .`` was not run (Streamlit does not use pytest's pythonpath).
_SRC = Path(__file__).resolve().parents[1] / "src"
if _SRC.is_dir():
    _src_s = str(_SRC)
    if _src_s not in sys.path:
        sys.path.insert(0, _src_s)

import os
import uuid
from datetime import datetime, timezone
from typing import Literal

from dotenv import load_dotenv

load_dotenv()

import streamlit as st

from langgraph.checkpoint.memory import MemorySaver

from medtrace_agent.agents.deep_clinical import run_clinical_deep_agent_turn
from medtrace_agent.agents.rag_chat import chat_with_memory
from medtrace_agent.ingest.documents import (
    ingest_pdf_text_to_patient_graph,
    ingest_txt_path_to_patient_graph,
    list_txt_files_in_note_folder,
    pdf_bytes_to_text,
)
from medtrace_agent.integrations.pubmed import pubmed_search_summaries
from medtrace_agent.ontology.clinical import (
    ONTOLOGY_EDGE_TYPES,
    ONTOLOGY_NODE_LABELS,
    apply_clinical_ontology,
)
from medtrace_agent.zep.graph import (
    list_fact_edges,
    list_recent_episodes,
    search_ontology_edges,
    search_ontology_nodes,
)
from medtrace_agent.zep.memory import append_turn, ensure_session, ensure_user, fetch_thread_context

# Label, prompt text, requires_deep_agent bool
SAMPLE_CHAT_PROMPTS: list[tuple[str, str, bool]] = [
    (
        "RAG — Zep memory check",
        "What do you know about this patient from Zep memory and recent messages? Summarize briefly and note uncertainty.",
        False,
    ),
    (
        "RAG — Session documents",
        "Which documents appear in the ingested-document registry for this session? How should you cite doc_id and filename when answering?",
        False,
    ),
    (
        "Deep — graph tools",
        "Use your Zep tools: fetch synthesized thread context, list recent graph episodes and temporal edges for this patient. Describe any timeline pattern as hypotheses only — not a diagnosis.",
        True,
    ),
    (
        "Deep — ontology search",
        "Use ontology search tools on this patient's graph for conditions or medications relevant to a typical chronic-care timeline (hypothetical query text). Summarize what the graph returns.",
        True,
    ),
    (
        "Deep — PubMed literature",
        "Search PubMed for type 2 diabetes first-line therapy overview and briefly summarize themes from the retrieved titles (educational only; not prescribing advice). Include PMIDs.",
        True,
    ),
]


def _new_thread_id() -> str:
    return uuid.uuid4().hex


def _init_state() -> None:
    if "zep_user_id" not in st.session_state:
        st.session_state.zep_user_id = "demo-user-1"
    if "zep_display_name" not in st.session_state:
        st.session_state.zep_display_name = "Jamie Demo"
    if "thread_id" not in st.session_state:
        st.session_state.thread_id = _new_thread_id()
    if "messages" not in st.session_state:
        st.session_state.messages = []
    if "last_zep_context" not in st.session_state:
        st.session_state.last_zep_context = ""
    if "edge_cursor" not in st.session_state:
        st.session_state.edge_cursor = None
    if "ingested_docs" not in st.session_state:
        st.session_state.ingested_docs = []


def _format_document_catalog(docs: list) -> str:
    """Markdown-ish bullet list for the LLM system prompt."""
    if not docs:
        return ""
    lines: list[str] = []
    for d in docs:
        kind = d.get("ingest_kind", "pdf")
        lines.append(
            f"- doc_id `{d['doc_id']}` — **{d['filename']}** (`{kind}`) — uploaded {d['uploaded_at_utc']} "
            f"— Zep episodes this ingest: {d['episode_count']}"
        )
    return "\n".join(lines)


def _ingest_all_txt_from_data_folder(
    note_source: Literal["radiology_note", "session_note"],
) -> tuple[list[str], list[str]]:
    """Ingest every ``*.txt`` from ``data/<note_source>/``. Returns (ok_parts, err_parts)."""
    ok_parts: list[str] = []
    err_parts: list[str] = []
    for path in list_txt_files_in_note_folder(note_source):
        doc_id = uuid.uuid4().hex
        try:
            ids = ingest_txt_path_to_patient_graph(
                st.session_state.zep_user_id,
                path,
                note_source=note_source,
                doc_id=doc_id,
            )
            uploaded_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
            st.session_state.ingested_docs.append(
                {
                    "doc_id": doc_id,
                    "filename": path.name,
                    "uploaded_at_utc": uploaded_at,
                    "episode_count": len(ids),
                    "ingest_kind": note_source,
                }
            )
            ok_parts.append(f"{path.name} ({len(ids)} episodes, doc_id={doc_id[:8]}…)")
        except Exception as exc:
            err_parts.append(f"{path.name}: {exc}")
    return ok_parts, err_parts


def _bootstrap_zep() -> None:
    ensure_user(st.session_state.zep_user_id, st.session_state.zep_display_name)
    ensure_session(st.session_state.thread_id, st.session_state.zep_user_id)


def main() -> None:
    st.set_page_config(page_title="Zep clinical memory demo", layout="wide")
    _init_state()

    ingest_err = st.session_state.pop("_zep_ingest_err", None)
    if ingest_err:
        st.warning(ingest_err)
    onto_ok = st.session_state.pop("_ontology_ok", None)
    if onto_ok:
        st.success(onto_ok)
    onto_err = st.session_state.pop("_ontology_err", None)
    if onto_err:
        st.error(f"Ontology: {onto_err}")
    pdf_ok = st.session_state.pop("_pdf_ok", None)
    if pdf_ok:
        st.success(pdf_ok)
    pdf_err = st.session_state.pop("_pdf_err", None)
    if pdf_err:
        st.error(pdf_err)
    notes_ok = st.session_state.pop("_notes_ok", None)
    if notes_ok:
        st.success(notes_ok)
    notes_err = st.session_state.pop("_notes_err", None)
    if notes_err:
        st.error(notes_err)

    missing = [
        name
        for name, ok in (
            ("NEBIUS_API_KEY", bool(os.environ.get("NEBIUS_API_KEY"))),
            ("ZEP_API_KEY", bool(os.environ.get("ZEP_API_KEY"))),
        )
        if not ok
    ]
    if missing:
        st.error(f"Missing environment variables: {', '.join(missing)}. Copy `.env.example` to `.env`.")
        st.stop()

    st.warning(
        "**Educational demo only.** Not for real PHI or HIPAA-regulated production use. "
        "Do not upload sensitive patient data."
    )

    st.title("Zep clinical memory + Nebius (LangChain)")
    st.markdown(
        """
        **Patient** is the Zep **`user_id`** (knowledge graph owner). Doctors can **upload one or more PDFs**
        into that patient's graph (`graph.add` text chunks with a stable **doc_id** per file). **Default ingest** renders each PDF page to an image and runs a **vision model** (`NEBIUS_VL_MODEL`) to extract structured fields plus a full-page transcript (scans, handwriting, embedded figures). Optional **Skip VLM** uses fast **pypdf** text only. **Apply the clinical ontology**
        for typed extraction, then **chat**—the assistant is instructed to **cite filename and/or doc_id** when answering from uploads.
        Context still comes from `thread.get_user_context`. Use **Ontology search** after ingestion catches up; refresh episodes/edges to watch processing.
        """
    )

    with st.sidebar:
        st.header("Settings")
        default_model = os.environ.get(
            "NEBIUS_MODEL", "nvidia/Nemotron-3-Nano-Omni"
        )
        model_name = st.text_input("LLM model (Nebius)", value=default_model)

        clinical_deep_agent = st.checkbox(
            "Clinical reasoning (Deep Agent)",
            value=False,
            help=(
                "LangChain Deep Agent with Zep tools (episodes, edges, ontology) + PubMed search tool. "
                "PubMed uses the official NCBI API (not web scraping). Results appear in chat only when "
                "the model calls that tool — try asking explicitly: “Search PubMed for …”. "
                "Slower; demo only, not diagnostic."
            ),
        )
        st.caption(
            "Without this checkbox, chat uses the fast path (no PubMed). "
            "Use **PubMed (NCBI API)** below to verify literature fetch works."
        )

        with st.expander("PubMed (NCBI API) — sample fetch", expanded=False):
            st.markdown(
                "Data comes from **NCBI E-utilities** (`esearch` + `esummary`), not scraped HTML. "
                "Optional: set `NCBI_EMAIL` / `NCBI_API_KEY` in `.env`."
            )
            pm_q = st.text_input("PubMed query", value="diabetes mellitus", key="pubmed_test_query")
            if st.button("Run sample PubMed fetch", key="pubmed_test_btn"):
                with st.spinner("Calling NCBI…"):
                    try:
                        sample_out = pubmed_search_summaries(pm_q.strip() or "diabetes", max_results=4)
                        st.markdown(sample_out)
                        if sample_out.startswith("PubMed esearch failed") or sample_out.startswith(
                            "PubMed esummary failed"
                        ):
                            st.error("NCBI request failed — check network or `.env` API key.")
                    except Exception as exc:
                        st.exception(exc)

        st.session_state.zep_user_id = st.text_input(
            "Patient Zep user id",
            value=st.session_state.zep_user_id,
            help="Zep User id = patient chart subject for graph + PDF ingest.",
        )
        st.session_state.zep_display_name = st.text_input(
            "Display name (chat / graph hints)",
            value=st.session_state.zep_display_name,
        )

        st.divider()
        st.header("Clinical ontology")
        st.caption(
            "Registers ≤10 custom entities + edges **project-wide** (matches Zep dashboard). "
            "This is **not** scoped to the patient id below—it affects your whole Zep project. "
            "See Zep docs."
        )
        if st.button("Apply clinical ontology (project-wide)"):
            try:
                apply_clinical_ontology()
                st.session_state["_ontology_ok"] = (
                    "Clinical ontology applied (project-wide). Check Zep dashboard → User ontology."
                )
            except Exception as exc:
                st.session_state["_ontology_err"] = str(exc)
            st.rerun()

        st.divider()
        st.header("Patient documents (PDF)")
        default_max_pages = int(os.environ.get("PDF_VL_MAX_PAGES", "25"))
        default_dpi = int(os.environ.get("PDF_VL_DPI", "150"))
        with st.expander("PDF ingest options", expanded=False):
            skip_vlm = st.checkbox(
                "Skip VLM — text layer only (pypdf)",
                value=False,
                help="Faster and cheaper for born-digital PDFs. Misses scanned pages, handwriting, and text inside embedded images.",
            )
            max_pdf_pages = st.number_input(
                "Max pages per PDF (vision path)",
                min_value=1,
                max_value=200,
                value=min(default_max_pages, 200),
                help="Caps cost/latency; raise PDF_VL_MAX_PAGES in .env for a different default.",
            )
            render_dpi = st.slider(
                "Render DPI (vision path)",
                min_value=96,
                max_value=220,
                value=min(max(default_dpi, 96), 220),
                help="Higher DPI improves small text; increases image size and API cost.",
            )

        pdf_files = st.file_uploader(
            "Medical history PDF(s)",
            type=["pdf"],
            accept_multiple_files=True,
            help="Default: each page is rendered to PNG and sent to NEBIUS_VL_MODEL. Use Skip VLM for text-layer-only extraction.",
        )
        if st.button(
            "Ingest PDF(s) into patient graph",
            disabled=not pdf_files,
        ):
            if not skip_vlm and not (os.environ.get("NEBIUS_VL_MODEL") or "").strip():
                st.session_state["_pdf_err"] = (
                    "Vision ingest requires NEBIUS_VL_MODEL in .env (any OpenAI-compatible vision model on your Nebius base URL), "
                    "or enable “Skip VLM” for pypdf-only."
                )
                st.rerun()
            else:
                file_list = pdf_files if isinstance(pdf_files, list) else [pdf_files]
                ok_parts: list[str] = []
                err_parts: list[str] = []
                for pf in file_list:
                    doc_id = uuid.uuid4().hex
                    try:
                        raw = pf.getvalue()
                        extract_mode = "pypdf" if skip_vlm else "vlm_png"

                        if skip_vlm:
                            text = pdf_bytes_to_text(raw, use_vlm=False)
                        else:
                            status_lbl = f"Vision extract: {pf.name}"
                            with st.status(status_lbl) as status:

                                def _progress(cur: int, total: int) -> None:
                                    status.update(label=f"{pf.name}: VLM page {cur}/{total}")

                                text = pdf_bytes_to_text(
                                    raw,
                                    use_vlm=True,
                                    dpi=render_dpi,
                                    max_pages=int(max_pdf_pages),
                                    progress_cb=_progress,
                                )
                                status.update(label=f"{pf.name}: done → Zep ingest")

                        ids = ingest_pdf_text_to_patient_graph(
                            st.session_state.zep_user_id,
                            text,
                            filename=pf.name,
                            doc_id=doc_id,
                            extra_metadata={"extract_mode": extract_mode},
                        )
                        uploaded_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
                        st.session_state.ingested_docs.append(
                            {
                                "doc_id": doc_id,
                                "filename": pf.name,
                                "uploaded_at_utc": uploaded_at,
                                "episode_count": len(ids),
                                "ingest_kind": "pdf",
                            }
                        )
                        ok_parts.append(f"{pf.name} ({len(ids)} episodes, doc_id={doc_id[:8]}…)")
                    except Exception as exc:
                        err_parts.append(f"{pf.name}: {exc}")
                if ok_parts:
                    st.session_state["_pdf_ok"] = (
                        "Ingested: "
                        + "; ".join(ok_parts)
                        + " — refresh graph after Zep processes."
                    )
                if err_parts:
                    st.session_state["_pdf_err"] = "Failed: " + "; ".join(err_parts)
            st.rerun()

        st.divider()
        st.header("Plain text notes (`data/`)")
        st.caption(
            "Drop ``.txt`` files into ``data/radiology_note/`` or ``data/session_note/`` "
            "(repo-relative). Each file is chunked then sent to Zep via ``graph.add``."
        )
        rad_note_paths = list_txt_files_in_note_folder("radiology_note")
        sess_note_paths = list_txt_files_in_note_folder("session_note")
        st.text(
            f"radiology_note: {len(rad_note_paths)} .txt   |   session_note: {len(sess_note_paths)} .txt"
        )
        if rad_note_paths:
            with st.expander("radiology_note files", expanded=False):
                for p in rad_note_paths:
                    st.markdown(f"- `{p.name}`")
        if sess_note_paths:
            with st.expander("session_note files", expanded=False):
                for p in sess_note_paths:
                    st.markdown(f"- `{p.name}`")

        cnote_a, cnote_b = st.columns(2)
        with cnote_a:
            if st.button(
                "Ingest radiology_note/*.txt",
                disabled=len(rad_note_paths) == 0,
                help="Reads every .txt in data/radiology_note/, runs chunk_for_zep, graph.add.",
            ):
                ok_n, err_n = _ingest_all_txt_from_data_folder("radiology_note")
                if ok_n:
                    st.session_state["_notes_ok"] = (
                        "Radiology notes ingested: "
                        + "; ".join(ok_n)
                        + " — refresh graph after Zep processes."
                    )
                if err_n:
                    st.session_state["_notes_err"] = "Radiology notes failed: " + "; ".join(err_n)
                st.rerun()
        with cnote_b:
            if st.button(
                "Ingest session_note/*.txt",
                disabled=len(sess_note_paths) == 0,
                help="Reads every .txt in data/session_note/, runs chunk_for_zep, graph.add.",
            ):
                ok_n, err_n = _ingest_all_txt_from_data_folder("session_note")
                if ok_n:
                    st.session_state["_notes_ok"] = (
                        "Session notes ingested: "
                        + "; ".join(ok_n)
                        + " — refresh graph after Zep processes."
                    )
                if err_n:
                    st.session_state["_notes_err"] = "Session notes failed: " + "; ".join(err_n)
                st.rerun()

        if st.session_state.ingested_docs:
            st.caption(f"{len(st.session_state.ingested_docs)} document(s) in session registry.")
            with st.expander("Ingested documents (doc_id / filename)", expanded=False):
                for d in reversed(st.session_state.ingested_docs):
                    kind = d.get("ingest_kind", "pdf")
                    st.markdown(
                        f"- `{d['doc_id']}` — **{d['filename']}** (`{kind}`) — {d['uploaded_at_utc']} "
                        f"— {d['episode_count']} episode(s)"
                    )

        st.divider()
        if st.button("New thread", help="New session id; same patient user (cross-thread recall)"):
            st.session_state.thread_id = _new_thread_id()
            st.session_state.messages = []
            st.session_state.edge_cursor = None
            _bootstrap_zep()
            st.rerun()

        if st.button("Clear local chat only"):
            st.session_state.messages = []
            st.rerun()

        st.caption(f"Current thread id: `{st.session_state.thread_id[:12]}…`")

    _bootstrap_zep()

    col_chat, col_graph = st.columns((3, 2), gap="large")

    with col_chat:
        for msg in st.session_state.messages:
            with st.chat_message(msg["role"]):
                st.markdown(msg["content"])
                if msg["role"] == "assistant" and msg.get("zep_synced") is False:
                    st.caption(
                        "This turn was not saved to Zep memory (`thread.add_messages` failed). "
                        "The reply is shown locally only."
                    )
                # Deterministic UI: model-only citations often get dropped by smaller LLMs.
                if msg["role"] == "assistant" and msg.get("session_docs"):
                    refs = " · ".join(
                        f"`{d['doc_id']}` — {d['filename']}" for d in msg["session_docs"]
                    )
                    st.caption(f"Reference documents (session registry): {refs}")
                if msg["role"] == "assistant" and msg.get("deep_agent"):
                    st.caption("Clinical reasoning: Deep Agent (Zep tools + optional PubMed)")

        with st.expander("Sample prompts — click to send a test message", expanded=False):
            st.caption(
                "Prompts marked **Deep** need **Clinical reasoning (Deep Agent)** enabled in the sidebar. "
                "Others work with the fast RAG chat path."
            )
            for idx, (label, prompt_text, needs_deep) in enumerate(SAMPLE_CHAT_PROMPTS):
                c1, c2 = st.columns((4, 1))
                with c1:
                    badge = "(Deep Agent)" if needs_deep else "(Fast chat)"
                    st.markdown(f"**{label}** `{badge}`")
                    st.caption(prompt_text[:220] + ("…" if len(prompt_text) > 220 else ""))
                with c2:
                    disabled = needs_deep and not clinical_deep_agent
                    if st.button(
                        "Send",
                        key=f"sample_prompt_btn_{idx}",
                        disabled=disabled,
                        help=(
                            "Turn on Clinical reasoning (Deep Agent) in the sidebar first."
                            if disabled
                            else "Submit this text as the next user message."
                        ),
                    ):
                        st.session_state["pending_chat_message"] = prompt_text
                        st.rerun()

        pending_chat = st.session_state.pop("pending_chat_message", None)
        user_input = st.chat_input("Message…")
        if pending_chat:
            user_input = pending_chat
        if user_input:
            used_deep = False
            try:
                zep_context, thread_msgs = fetch_thread_context(st.session_state.thread_id)
                st.session_state.last_zep_context = zep_context
                catalog = _format_document_catalog(st.session_state.ingested_docs)
                if clinical_deep_agent:
                    used_deep = True
                    if "deep_agent_checkpointer" not in st.session_state:
                        st.session_state.deep_agent_checkpointer = MemorySaver()
                    reply = run_clinical_deep_agent_turn(
                        user_id=st.session_state.zep_user_id,
                        thread_id=st.session_state.thread_id,
                        model_name=model_name,
                        user_input=user_input,
                        document_catalog=catalog or None,
                        checkpointer=st.session_state.deep_agent_checkpointer,
                    )
                else:
                    reply = chat_with_memory(
                        user_input=user_input,
                        user_display_name=st.session_state.zep_display_name,
                        zep_context=zep_context,
                        thread_messages=thread_msgs,
                        model_name=model_name,
                        document_catalog=catalog or None,
                    )
            except Exception as exc:
                reply = f"Error calling the model or Zep: {exc}"
                st.session_state.last_zep_context = ""

            docs_snapshot = [dict(d) for d in st.session_state.ingested_docs]
            zep_synced = True
            try:
                append_turn(
                    st.session_state.thread_id,
                    st.session_state.zep_display_name,
                    user_input,
                    reply,
                )
            except Exception as exc:
                zep_synced = False
                st.session_state["_zep_ingest_err"] = (
                    f"Zep ingest failed (reply still shown locally): {exc}"
                )

            st.session_state.messages.append({"role": "user", "content": user_input})
            st.session_state.messages.append(
                {
                    "role": "assistant",
                    "content": reply,
                    "session_docs": docs_snapshot,
                    "deep_agent": used_deep,
                    "zep_synced": zep_synced,
                }
            )

            st.rerun()

        with st.expander("Ingested documents (chat citation registry)", expanded=False):
            if not st.session_state.ingested_docs:
                st.caption("No PDFs recorded in this session yet — ingest above.")
            else:
                st.markdown(_format_document_catalog(st.session_state.ingested_docs))

        with st.expander("Zep context injected on last turn (thread.get_user_context)", expanded=False):
            ctx = st.session_state.last_zep_context or "(empty — send a message first)"
            st.markdown(ctx)

    with col_graph:
        st.subheader("Knowledge graph inspector")
        refresh = st.button("Refresh graph")
        page_size = st.slider("Edges page size", min_value=10, max_value=100, value=40, step=10)

        if refresh:
            st.session_state.edge_cursor = None

        cursor = st.session_state.edge_cursor
        ep_df = list_recent_episodes(st.session_state.zep_user_id, lastn=30)
        edge_df, next_cursor = list_fact_edges(
            st.session_state.zep_user_id,
            limit=page_size,
            uuid_cursor=cursor,
        )

        tab_ep, tab_edge, tab_onto = st.tabs(
            ["Episodes", "Temporal facts (edges)", "Ontology search"]
        )
        with tab_ep:
            st.caption("Recent episodes (`processed` tracks pipeline status). PDF chunks appear as `text`.")
            if ep_df.empty:
                st.info("No episodes yet — chat or ingest a PDF, then refresh.")
            else:
                st.dataframe(ep_df, use_container_width=True, hide_index=True)

        with tab_edge:
            st.caption("Temporal facts (`valid_at` / `invalid_at` / `expired_at`).")
            if edge_df.empty:
                st.info("No edges yet — Zep may still be extracting.")
            else:
                st.dataframe(edge_df, use_container_width=True, hide_index=True)

            if next_cursor:
                if st.button("Next edge page"):
                    st.session_state.edge_cursor = next_cursor
                    st.rerun()

        with tab_onto:
            st.caption(
                "Filtered `graph.search` by custom node labels or edge types from the clinical ontology."
            )
            search_query = st.text_input(
                "Search query",
                value="medications and conditions",
                key="onto_q",
            )
            scope = st.radio("Scope", ["nodes", "edges"], horizontal=True, key="onto_scope")
            search_limit = st.slider("Result limit", 5, 50, 15, key="onto_lim")

            if scope == "nodes":
                pick_labels = st.multiselect(
                    "Node labels",
                    ONTOLOGY_NODE_LABELS,
                    default=["ClinicalFact", "Medication", "Condition"],
                    key="onto_nl",
                )
                if st.button("Run node search", key="onto_bn"):
                    try:
                        ndf = search_ontology_nodes(
                            st.session_state.zep_user_id,
                            search_query,
                            pick_labels,
                            limit=search_limit,
                        )
                        st.session_state["_onto_node_df"] = ndf
                    except Exception as exc:
                        st.session_state["_onto_search_err"] = str(exc)
            else:
                pick_edges = st.multiselect(
                    "Edge types",
                    ONTOLOGY_EDGE_TYPES,
                    default=["HAS_MEDICATION", "HAS_CONDITION", "CONTAINS_FACT"],
                    key="onto_el",
                )
                if st.button("Run edge search", key="onto_be"):
                    try:
                        edf = search_ontology_edges(
                            st.session_state.zep_user_id,
                            search_query,
                            pick_edges,
                            limit=search_limit,
                        )
                        st.session_state["_onto_edge_df"] = edf
                    except Exception as exc:
                        st.session_state["_onto_search_err"] = str(exc)

            se_err = st.session_state.pop("_onto_search_err", None)
            if se_err:
                st.warning(se_err)

            nodf = st.session_state.get("_onto_node_df")
            if nodf is not None and scope == "nodes" and not nodf.empty:
                st.dataframe(nodf, use_container_width=True, hide_index=True)
            elif nodf is not None and scope == "nodes":
                st.info("No matching nodes.")

            eddf = st.session_state.get("_onto_edge_df")
            if eddf is not None and scope == "edges" and not eddf.empty:
                st.dataframe(eddf, use_container_width=True, hide_index=True)
            elif eddf is not None and scope == "edges":
                st.info("No matching edges.")


if __name__ == "__main__":
    main()
