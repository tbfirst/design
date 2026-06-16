"""knowledge_search tool — 越权修复 + hybrid BM25/RRF。"""
from __future__ import annotations

import logging
from typing import Annotated

from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from app.agent.graph.tools.envelope import tool_error, tool_ok
from app.agent.memory.shared import search_shared_hybrid
from app.services.embedding import embed_text

logger = logging.getLogger(__name__)

_DEFAULT_COLLECTIONS = ["brand-dna", "garment-taxonomy", "success-prompts"]


@tool
async def knowledge_search(
    query: str,
    state: Annotated[dict, InjectedState],
) -> dict:
    """Search the shared knowledge base (brand DNA, garment taxonomy, success prompts).

    Args:
        query: natural-language query.

    Returns: {"ok": bool, "hits": [{document_id, collection, title, chunk_text, score}]}.
    Dense KNN + BM25 hybrid with RRF fusion.
    """
    user_id: int = state["user_id"]
    group_id = state.get("group_id")
    group_ids = [group_id] if group_id is not None else []

    try:
        vec = await embed_text(query)
        hits = await search_shared_hybrid(
            user_id=user_id,
            group_ids=group_ids,
            collections=_DEFAULT_COLLECTIONS,
            query_text=query,
            query_embedding=vec,
            k=5,
        )
    except Exception as e:
        logger.warning("knowledge_search failed: %s", e)
        return tool_error("knowledge_search", "search_error", str(e), data={"hits": []})
    return tool_ok({"hits": hits})
