"""LangChain Deep Agent path: Zep tools + PubMed — demo clinical reasoning (non-diagnostic)."""

from __future__ import annotations

import os
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langgraph.checkpoint.memory import MemorySaver

from clinical_ontology import ONTOLOGY_EDGE_TYPES, ONTOLOGY_NODE_LABELS
from deepagents import create_deep_agent
from pubmed_eutils import pubmed_search_summaries
from zep_graph import (
    list_fact_edges,
    list_recent_episodes,
    search_ontology_edges,
    search_ontology_nodes,
)
from zep_memory import fetch_thread_context

DEFAULT_NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1/"

# Demo-only: bound synchronously before each invoke (single-user Streamlit sessions).
_TOOL_BIND: dict[str, str] = {}

GRAPH_CACHE: dict[tuple[str, int], Any] = {}


DEEP_CLINICAL_SYSTEM = """You are a clinical reasoning assistant in an educational demo (NOT a licensed medical device).

You MUST:
- Use tools to ground patient-specific claims: call `get_zep_thread_context`, `list_graph_episodes`, `list_temporal_edges`, and ontology search tools before stating what happened on the patient's timeline.
- When the user asks for literature, mechanisms, or evidence, call `pubmed_search_literature`.
- Present **differential considerations** and **questions to clarify** — never a definitive diagnosis or treatment plan.
- Label inference clearly: 'possible consideration', 'would warrant evaluation if ...', and separate **Zep graph facts** from **PubMed literature**.
- Be concise. Avoid filesystem/task tools unless truly needed for the user's request; prefer Zep + PubMed tools for clinical questions.

You MUST NOT:
- Claim certainty about diagnosis or replace a clinician.
- Invent symptoms, dates, or lab values not supported by tool output."""


def set_clinical_tool_bind(user_id: str, thread_id: str) -> None:
    """Set patient + thread for tools that close over session context."""
    _TOOL_BIND["user_id"] = user_id
    _TOOL_BIND["thread_id"] = thread_id


@tool
def get_zep_thread_context() -> str:
    """Synthesized long-term + relevant memory string from Zep for the current chat thread."""
    tid = _TOOL_BIND.get("thread_id", "")
    if not tid:
        return "No thread_id bound."
    ctx, _ = fetch_thread_context(tid)
    return (ctx or "").strip() or "(empty context)"


@tool
def list_graph_episodes(lastn: int = 25) -> str:
    """Recent Zep graph episodes for the current patient (text snippets ingested from chat/PDFs)."""
    uid = _TOOL_BIND.get("user_id", "")
    if not uid:
        return "No user_id bound."
    lastn = max(1, min(int(lastn), 80))
    df = list_recent_episodes(uid, lastn=lastn)
    if df.empty:
        return "No episodes found."
    return df.head(60).to_csv(index=False)[:14000]


@tool
def list_temporal_edges(limit: int = 40) -> str:
    """Temporal fact edges from the patient's Zep graph (facts, validity times)."""
    uid = _TOOL_BIND.get("user_id", "")
    if not uid:
        return "No user_id bound."
    limit = max(1, min(int(limit), 100))
    df, _ = list_fact_edges(uid, limit=limit)
    if df.empty:
        return "No edges found."
    return df.to_csv(index=False)[:14000]


@tool
def search_patient_ontology_nodes(query: str) -> str:
    """Semantic search over ontology node types (conditions, meds, etc.) for this patient."""
    uid = _TOOL_BIND.get("user_id", "")
    if not uid:
        return "No user_id bound."
    q = (query or "").strip() or "patient clinical"
    df = search_ontology_nodes(
        uid,
        q,
        node_labels=list(ONTOLOGY_NODE_LABELS),
        limit=15,
    )
    if df.empty:
        return "No matching ontology nodes (ontology may be unset or still processing)."
    return df.to_csv(index=False)[:12000]


@tool
def search_patient_ontology_edges(query: str) -> str:
    """Semantic search over ontology edge types (HAS_CONDITION, etc.) for this patient."""
    uid = _TOOL_BIND.get("user_id", "")
    if not uid:
        return "No user_id bound."
    q = (query or "").strip() or "patient clinical"
    df = search_ontology_edges(
        uid,
        q,
        edge_types=list(ONTOLOGY_EDGE_TYPES),
        limit=15,
    )
    if df.empty:
        return "No matching ontology edges."
    return df.to_csv(index=False)[:12000]


@tool
def pubmed_search_literature(query: str, max_results: int = 8) -> str:
    """Search PubMed for peer-reviewed literature summaries (titles + PMID). Demo only."""
    return pubmed_search_summaries(query, max_results=max_results)


ALL_CLINICAL_TOOLS = [
    get_zep_thread_context,
    list_graph_episodes,
    list_temporal_edges,
    search_patient_ontology_nodes,
    search_patient_ontology_edges,
    pubmed_search_literature,
]


def _make_llm(model_name: str) -> ChatOpenAI:
    key = os.environ.get("NEBIUS_API_KEY")
    if not key:
        raise RuntimeError("NEBIUS_API_KEY is not set.")
    return ChatOpenAI(
        model=model_name,
        temperature=0.2,
        api_key=key,
        base_url=os.environ.get("NEBIUS_BASE_URL") or DEFAULT_NEBIUS_BASE_URL,
    )


def get_compiled_clinical_agent(model_name: str, checkpointer: MemorySaver):
    """One compiled graph per (model_name, checkpointer id) for stable checkpoint state."""
    key = (model_name, id(checkpointer))
    if key in GRAPH_CACHE:
        return GRAPH_CACHE[key]
    llm = _make_llm(model_name)
    graph = create_deep_agent(
        model=llm,
        tools=list(ALL_CLINICAL_TOOLS),
        system_prompt=DEEP_CLINICAL_SYSTEM,
        checkpointer=checkpointer,
    )
    GRAPH_CACHE[key] = graph
    return graph


def _extract_assistant_text(messages: list[Any]) -> str:
    for m in reversed(messages):
        if not isinstance(m, AIMessage):
            continue
        tc = getattr(m, "tool_calls", None) or []
        if tc:
            continue
        c = m.content
        if isinstance(c, str) and c.strip():
            return c.strip()
        if isinstance(c, list):
            parts: list[str] = []
            for block in c:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(str(block.get("text", "")))
                elif isinstance(block, str):
                    parts.append(block)
            if parts:
                return "".join(parts).strip()
    if messages:
        return str(getattr(messages[-1], "content", messages[-1]))
    return "(no response)"


def run_clinical_deep_agent_turn(
    *,
    user_id: str,
    thread_id: str,
    model_name: str,
    user_input: str,
    document_catalog: str | None,
    checkpointer: MemorySaver,
) -> str:
    """
    Run one Deep Agent turn with Zep/PubMed tools. Thread-scoped checkpoint via ``thread_id``.
    """
    set_clinical_tool_bind(user_id, thread_id)
    graph = get_compiled_clinical_agent(model_name, checkpointer)

    body = user_input.strip()
    cat = (document_catalog or "").strip()
    if cat:
        body = (
            "[Ingested clinical documents — cite doc_id / filename when using these facts]\n"
            + cat
            + "\n\n---\n\nUser message:\n"
            + body
        )

    result = graph.invoke(
        {"messages": [HumanMessage(content=body)]},
        config={
            "configurable": {"thread_id": thread_id},
            "recursion_limit": 50,
        },
    )
    msgs = result.get("messages") or []
    return _extract_assistant_text(msgs)
