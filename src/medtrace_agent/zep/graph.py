"""Read-only Zep graph helpers for the Streamlit inspector (episodes + temporal edges)."""

from __future__ import annotations

from typing import Any

import pandas as pd

from zep_cloud.types.search_filters import SearchFilters

from medtrace_agent.zep.memory import get_zep_client


def _episode_uuid(ep: Any) -> str:
    return getattr(ep, "uuid_", None) or getattr(ep, "uuid", "") or ""


def _edge_uuid(edge: Any) -> str:
    return getattr(edge, "uuid_", None) or getattr(edge, "uuid", "") or ""


def list_recent_episodes(user_id: str, lastn: int = 25) -> pd.DataFrame:
    client = get_zep_client()
    resp = client.graph.episode.get_by_user_id(user_id, lastn=lastn)
    episodes = resp.episodes or []
    rows: list[dict[str, Any]] = []
    for ep in episodes:
        content = (ep.content or "").replace("\n", " ")
        if len(content) > 200:
            content = content[:197] + "..."
        rows.append(
            {
                "uuid": _episode_uuid(ep),
                "created_at": ep.created_at,
                "processed": ep.processed,
                "source": ep.source,
                "role": ep.role,
                "role_type": ep.role_type,
                "thread_id": ep.thread_id,
                "content": content,
            }
        )
    return pd.DataFrame(rows)


def list_fact_edges(
    user_id: str, limit: int = 50, uuid_cursor: str | None = None
) -> tuple[pd.DataFrame, str | None]:
    """
    Returns a dataframe of temporal facts and an optional cursor for the next page
    (last edge uuid when the page is full).
    """
    client = get_zep_client()
    kwargs: dict[str, Any] = {}
    if limit is not None:
        kwargs["limit"] = limit
    if uuid_cursor:
        kwargs["uuid_cursor"] = uuid_cursor

    edges = client.graph.edge.get_by_user_id(user_id, **kwargs)
    rows: list[dict[str, Any]] = []
    for edge in edges:
        ep_list = edge.episodes or []
        rows.append(
            {
                "uuid": _edge_uuid(edge),
                "name": edge.name,
                "fact": edge.fact,
                "valid_at": edge.valid_at,
                "invalid_at": edge.invalid_at,
                "expired_at": edge.expired_at,
                "created_at": edge.created_at,
                "episode_links": len(ep_list),
                "episode_uuids": ",".join(ep_list[:5]) + ("…" if len(ep_list) > 5 else ""),
            }
        )

    next_cursor: str | None = None
    if edges and len(edges) >= limit:
        next_cursor = _edge_uuid(edges[-1])

    return pd.DataFrame(rows), next_cursor


def search_ontology_nodes(
    user_id: str,
    query: str,
    node_labels: list[str],
    *,
    limit: int = 15,
) -> pd.DataFrame:
    """Filtered graph search scoped to custom entity labels (ontology highlights)."""
    if not node_labels:
        return pd.DataFrame()
    client = get_zep_client()
    filters = SearchFilters(node_labels=node_labels)
    q = (query or "").strip() or "patient clinical record"
    res = client.graph.search(
        user_id=user_id,
        query=q,
        scope="nodes",
        limit=min(max(limit, 1), 50),
        search_filters=filters,
    )
    nodes = res.nodes or []
    rows: list[dict[str, Any]] = []
    for node in nodes:
        labels = ",".join(node.labels or [])
        summ = str(getattr(node, "summary", "") or "")
        rows.append(
            {
                "node_name": getattr(node, "name", ""),
                "labels": labels,
                "summary": summ[:500],
            }
        )
    return pd.DataFrame(rows)


def search_ontology_edges(
    user_id: str,
    query: str,
    edge_types: list[str],
    *,
    limit: int = 15,
) -> pd.DataFrame:
    """Filtered graph search scoped to custom edge types."""
    if not edge_types:
        return pd.DataFrame()
    client = get_zep_client()
    filters = SearchFilters(edge_types=edge_types)
    q = (query or "").strip() or "patient clinical record"
    res = client.graph.search(
        user_id=user_id,
        query=q,
        scope="edges",
        limit=min(max(limit, 1), 50),
        search_filters=filters,
    )
    edges = res.edges or []
    rows: list[dict[str, Any]] = []
    for edge in edges:
        rows.append(
            {
                "edge_type": edge.name,
                "fact": edge.fact,
                "valid_at": edge.valid_at,
                "invalid_at": edge.invalid_at,
            }
        )
    return pd.DataFrame(rows)
