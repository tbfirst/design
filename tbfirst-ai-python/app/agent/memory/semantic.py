"""V6.M2.C.1: L4 语义记忆（用户偏好 ai.user_preference）。"""
from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from psycopg.types.json import Json

from app.config import get_settings
from app.db.pool import agent_db_connection

logger = logging.getLogger(__name__)

_EXTRACTION_DIR = Path(__file__).parent.parent / "prompts" / "extraction"


@lru_cache(maxsize=1)
def _load_extract_prompt() -> str:
    """从 prompts/extraction/preference_extract.md 加载，重启后生效。"""
    path = _EXTRACTION_DIR / "preference_extract.md"
    return path.read_text(encoding="utf-8")


@lru_cache(maxsize=1)
def _load_allowed_keys() -> frozenset:
    """从 prompts/extraction/preference_keys.json 加载白名单，重启后生效。"""
    path = _EXTRACTION_DIR / "preference_keys.json"
    return frozenset(json.loads(path.read_text(encoding="utf-8"))["keys"])


CONFIDENCE_FLOOR = 0.6


async def list_preferences(user_id: int) -> list[dict]:
    async with agent_db_connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT id, user_id, key, value, confidence, source_session_id,
                       evidence, user_locked, last_injected_at, create_time, update_time
                FROM ai.user_preference
                WHERE user_id = %s
                ORDER BY confidence DESC NULLS LAST, id ASC
                """,
                (user_id,),
            )
            return list(await cur.fetchall())


async def upsert_preference(
    user_id: int,
    key: str,
    value: str,
    confidence: float,
    source_session_id: Optional[int] = None,
    evidence: Optional[dict] = None,
    force_lock: bool = False,
) -> Optional[dict]:
    if key not in _load_allowed_keys():
        logger.warning("upsert_preference: rejected key=%r (not in whitelist)", key)
        return None

    new_ev_entry = evidence if evidence is not None else None

    async with agent_db_connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT id, user_id, key, value, confidence, source_session_id,
                       evidence, user_locked, last_injected_at, create_time, update_time
                FROM ai.user_preference
                WHERE user_id = %s AND key = %s
                FOR UPDATE
                """,
                (user_id, key),
            )
            existing = await cur.fetchone()

            if existing and existing["user_locked"] and not force_lock:
                await conn.commit()
                return existing

            if confidence < CONFIDENCE_FLOOR:
                await conn.commit()
                return None

            if existing:
                merged_ev: list[Any] = []
                old_ev = existing.get("evidence") or []
                if isinstance(old_ev, list):
                    merged_ev.extend(old_ev)
                if new_ev_entry is not None:
                    merged_ev.append(new_ev_entry)

                new_conf = max(float(confidence), float(existing["confidence"] or 0))
                if float(confidence) > float(existing["confidence"] or 0):
                    new_value = value
                    new_source = source_session_id
                else:
                    new_value = existing["value"]
                    new_source = existing.get("source_session_id")

                await cur.execute(
                    """
                    UPDATE ai.user_preference
                    SET value = %s,
                        confidence = %s,
                        source_session_id = %s,
                        evidence = %s,
                        update_time = NOW()
                    WHERE id = %s
                    RETURNING id, user_id, key, value, confidence, source_session_id,
                              evidence, user_locked, last_injected_at, create_time, update_time
                    """,
                    (new_value, new_conf, new_source, Json(merged_ev), existing["id"]),
                )
                row = await cur.fetchone()
                await conn.commit()
                return row

            ev_init: list[Any] = [new_ev_entry] if new_ev_entry is not None else []
            await cur.execute(
                """
                INSERT INTO ai.user_preference
                    (user_id, key, value, confidence, source_session_id, evidence)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, user_id, key, value, confidence, source_session_id,
                          evidence, user_locked, last_injected_at, create_time, update_time
                """,
                (user_id, key, value, float(confidence), source_session_id, Json(ev_init)),
            )
            row = await cur.fetchone()
            await conn.commit()
            return row


async def lock_preference(user_id: int, preference_id: int, lock: bool) -> Optional[dict]:
    async with agent_db_connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE ai.user_preference
                SET user_locked = %s, update_time = NOW()
                WHERE id = %s AND user_id = %s
                RETURNING id, user_id, key, value, confidence, source_session_id,
                          evidence, user_locked, last_injected_at, create_time, update_time
                """,
                (bool(lock), preference_id, user_id),
            )
            row = await cur.fetchone()
            await conn.commit()
            return row


async def delete_preference(user_id: int, preference_id: int) -> bool:
    async with agent_db_connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM ai.user_preference WHERE id = %s AND user_id = %s",
                (preference_id, user_id),
            )
            deleted = cur.rowcount > 0
            await conn.commit()
            return deleted


def _serialize_messages(messages: list[Any]) -> str:
    parts = []
    for m in messages or []:
        role = getattr(m, "type", None) or getattr(m, "role", None) or "msg"
        content = getattr(m, "content", None)
        if content is None and isinstance(m, dict):
            role = m.get("role") or m.get("type") or "msg"
            content = m.get("content", "")
        if isinstance(content, list):
            parts.append(f"[{role}] " + " ".join(str(p) for p in content))
        else:
            parts.append(f"[{role}] {content}")
    return "\n".join(parts)


def _parse_json_array(text: str) -> list[dict]:
    if not text:
        return []
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.MULTILINE)
    m = re.search(r"\[.*\]", cleaned, flags=re.DOTALL)
    candidate = m.group(0) if m else cleaned
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        logger.warning("extract: JSON parse failed, raw=%r", text[:200])
        return []
    if not isinstance(data, list):
        return []
    allowed = _load_allowed_keys()
    out: list[dict] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        key = item.get("key")
        value = item.get("value")
        conf = item.get("confidence")
        if key not in allowed or not isinstance(value, str) or value == "":
            continue
        try:
            conf_f = float(conf)
        except (TypeError, ValueError):
            continue
        if conf_f < 0 or conf_f > 1:
            continue
        out.append(
            {
                "key": key,
                "value": value.strip(),
                "confidence": conf_f,
                "evidence": str(item.get("evidence") or "")[:80],
            }
        )
    return out


async def extract_preferences_from_messages(messages: list[Any]) -> list[dict]:
    if not messages:
        return []
    settings = get_settings()
    api_key = settings.gemini_api_key
    if not api_key:
        logger.info("extract_preferences: gemini_api_key empty, skip")
        return []

    try:
        from langchain_google_genai import ChatGoogleGenerativeAI
    except Exception as e:
        logger.warning("extract_preferences: langchain_google_genai unavailable: %s", e)
        return []

    serialized = _serialize_messages(messages)
    prompt = _load_extract_prompt().format(messages_serialized=serialized)

    try:
        llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=api_key,
            temperature=0.0,
        )
        resp = await llm.ainvoke(prompt)
        text = getattr(resp, "content", "") or ""
        if isinstance(text, list):
            text = " ".join(str(p) for p in text)
    except Exception as e:
        logger.warning("extract_preferences: gemini call failed: %s", e)
        return []

    return _parse_json_array(text)
