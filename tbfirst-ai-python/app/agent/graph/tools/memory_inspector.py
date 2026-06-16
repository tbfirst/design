"""memory_inspector tool — 全层真实化。"""
from __future__ import annotations

import logging
from typing import Annotated

from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from app.agent.graph.tools.envelope import tool_ok
from app.agent.memory.recall import list_session_summaries
from app.agent.memory.semantic import list_preferences
from app.agent.memory.procedural import list_workflows

logger = logging.getLogger(__name__)


@tool
async def memory_inspector(state: Annotated[dict, InjectedState]) -> dict:
    """Inspect what the assistant has stored about a user across memory layers.

    Returns: {"ok": bool, "L3_recall": [...], "L4_preferences": [...], "L5_workflow": [...]}.
    """
    user_id: int = state["user_id"]

    try:
        recalls = await list_session_summaries(user_id)
    except Exception as e:
        logger.warning("memory_inspector list_session_summaries failed: %s", e)
        recalls = []

    try:
        prefs = await list_preferences(user_id)
    except Exception as e:
        logger.warning("memory_inspector list_preferences failed: %s", e)
        prefs = []

    try:
        workflows = await list_workflows(user_id)
    except Exception as e:
        logger.warning("memory_inspector list_workflows failed: %s", e)
        workflows = []

    return tool_ok({
        "L3_recall": [
            {
                "id": r.get("id"),
                "summary": r.get("summary"),
                "quality_score": r.get("quality_score"),
                "recall_count": r.get("recall_count"),
                "archived": r.get("archived"),
            }
            for r in recalls
        ],
        "L4_preferences": [
            {"key": p.get("key"), "value": p.get("value"), "confidence": p.get("confidence")}
            for p in prefs
        ],
        "L5_workflow": [
            {
                "id": w.get("id"),
                "name": w.get("name"),
                "quality_score": w.get("quality_score"),
            }
            for w in workflows
        ],
    })
