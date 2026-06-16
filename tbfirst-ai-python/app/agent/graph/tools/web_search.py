"""web_search tool — GeminiProvider googleSearch grounding。"""
from __future__ import annotations

import asyncio
import logging

from langchain_core.tools import tool

from app.agent.graph.tools.envelope import tool_error, tool_ok
from app.config import get_settings

logger = logging.getLogger(__name__)


def _parse_grounding_chunks(resp) -> list[dict]:
    hits = []
    try:
        candidates = getattr(resp, "candidates", None) or []
        for candidate in candidates:
            meta = getattr(candidate, "grounding_metadata", None)
            if not meta:
                continue
            chunks = getattr(meta, "grounding_chunks", None) or []
            for chunk in chunks:
                web = getattr(chunk, "web", None)
                if not web:
                    continue
                hits.append(
                    {
                        "title": getattr(web, "title", None),
                        "uri": getattr(web, "uri", None),
                        "snippet": getattr(web, "snippet", None),
                    }
                )
    except Exception as e:
        logger.warning("web_search: failed to parse grounding_chunks: %s", e)
    return hits


@tool
async def web_search(query: str) -> dict:
    """Search the public web for fresh, time-sensitive information.

    Args:
        query: natural-language search query.

    Returns: {"ok": bool, "hits": [{title, uri, snippet}], "query": query}.
    """
    s = get_settings()
    if not s.gemini_api_key:
        return tool_error(
            "web_search", "no_api_key", "GEMINI_API_KEY not configured",
            data={"hits": [], "query": query},
        )

    try:
        from google import genai  # type: ignore
        from google.genai import types  # type: ignore

        client = genai.Client(api_key=s.gemini_api_key)
        resp = await asyncio.wait_for(
            asyncio.to_thread(
                client.models.generate_content,
                model="gemini-2.0-flash",
                contents=query,
                config=types.GenerateContentConfig(
                    tools=[types.Tool(google_search=types.GoogleSearch())]
                ),
            ),
            timeout=30.0,
        )
        hits = _parse_grounding_chunks(resp)
        return tool_ok({"hits": hits, "query": query})
    except Exception as e:
        logger.warning("web_search: provider error: %s", e)
        return tool_error(
            "web_search", "provider_error", str(e),
            data={"hits": [], "query": query},
        )
