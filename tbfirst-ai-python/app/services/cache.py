import hashlib
import json
import logging
import re
import unicodedata
from typing import Any

from app.common.redis.client import get_redis

logger = logging.getLogger(__name__)

CACHE_PREFIX = "tbfirst:ai:cache"
DEFAULT_TTL_SEC = 3600

# V5.XVII.K.2：DNA 提取专用 namespace。
# DNA 输出是「对参考图的结构化描述（12-15 tag + 四维笔记 JSON）」，
# 同一参考图 + 同一指令产出基本一致，且作为 Phase 后续步骤的输入被反复消费，
# 缓存命中率显著高于生图最终结果。
DNA_PREFIX = "tbfirst:ai:dna"
DNA_TTL_SEC = 24 * 3600  # DNA 比生图结果更稳定，TTL 拉长到 24h
# L.1: 缓存负载形态版本号。改 ImageGenerateResponse / DNA 返回 shape 时 bump，
# 旧 24h 缓存自动失效（get_dna 校验不过 → 删 + 返回 None → 上层重新跑 Gemini）。
_DNA_SCHEMA = "k2.v1"


def _key(namespace: str, payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"{CACHE_PREFIX}:{namespace}:{digest}"


def get(namespace: str, payload: dict[str, Any]) -> Any | None:
    try:
        raw = get_redis().get(_key(namespace, payload))
        return json.loads(raw) if raw else None
    except Exception as e:
        logger.warning("[Cache] get failed: %s", e)
        return None


def put(namespace: str, payload: dict[str, Any], value: Any, ttl: int = DEFAULT_TTL_SEC) -> None:
    try:
        get_redis().setex(
            _key(namespace, payload),
            ttl,
            json.dumps(value, ensure_ascii=False),
        )
    except Exception as e:
        logger.warning("[Cache] put failed: %s", e)


# ---------- DNA-only API (V5.XVII.K.2) ----------

def _normalize_prompt(p: str | None) -> str:
    """规范化 prompt：NFKC 归一 + 折叠空白。

    K.11: 删除原本的 r"\\b(seed|nonce|ts|timestamp)\\s*[:=]\\s*\\S+" 替换 —— 该正则
    会扫描整段自然语言把"seed=growth""timestamp=审视"这种正常用户输入剥掉，
    导致语义不同的 prompt 撞同一 DNA 缓存 key。
    扰动字段（force_refresh / nonce / timestamp）的隔离改由调用方 payload
    normalization 负责（参考 singleflight.normalize_image_payload）。
    """
    if not p:
        return ""
    p = unicodedata.normalize("NFKC", p)
    p = re.sub(r"\s+", " ", p).strip()
    return p


def _dna_key(phase: str, ref_signatures: list[str], prompt_norm: str) -> str:
    sigs = "|".join(ref_signatures or [])
    raw = f"{sigs}||{prompt_norm}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]
    return f"{DNA_PREFIX}:{phase}:{digest}"


def get_dna(phase: str, ref_signatures: list[str], prompt: str | None) -> dict[str, Any] | None:
    """查询 DNA 提取缓存。命中返回 dict（含 urls/text/used_model/attempts 等），未命中返回 None。

    L.1: 校验缓存条目 __schema__；不匹配则 evict 并返回 None，避免老 shape 的缓存被
    pydantic ImageGenerateResponse(**cached) 当成新 schema 抛 ValidationError。
    """
    try:
        key = _dna_key(phase, ref_signatures, _normalize_prompt(prompt))
        raw = get_redis().get(key)
        if not raw:
            logger.info("[Cache] DNA miss phase=%s key=%s", phase, key[-16:])
            return None
        parsed = json.loads(raw)
        # 兼容兼容旧条目（没有 __schema__ 包装）：当作 stale 直接 evict
        if not isinstance(parsed, dict) or parsed.get("__schema__") != _DNA_SCHEMA:
            logger.info(
                "[Cache] DNA stale schema phase=%s key=%s (got=%s want=%s), evict",
                phase, key[-16:],
                parsed.get("__schema__") if isinstance(parsed, dict) else "<non-dict>",
                _DNA_SCHEMA,
            )
            try:
                get_redis().delete(key)
            except Exception:
                pass
            return None
        logger.info("[Cache] DNA hit phase=%s key=%s", phase, key[-16:])
        return parsed["value"]
    except Exception as e:
        logger.warning("[Cache] DNA get failed: %s", e)
        return None


def put_dna(
    phase: str,
    ref_signatures: list[str],
    prompt: str | None,
    value: dict[str, Any],
    ttl: int = DNA_TTL_SEC,
) -> None:
    try:
        key = _dna_key(phase, ref_signatures, _normalize_prompt(prompt))
        # L.1: 包一层 schema 版本号，让 get_dna 能识别老条目并主动 evict
        payload = {"__schema__": _DNA_SCHEMA, "value": value}
        get_redis().setex(key, ttl, json.dumps(payload, ensure_ascii=False))
        logger.info("[Cache] DNA put phase=%s key=%s ttl=%ds schema=%s", phase, key[-16:], ttl, _DNA_SCHEMA)
    except Exception as e:
        logger.warning("[Cache] DNA put failed: %s", e)


def ref_signature(ref: str) -> str:
    """对单张参考图字符串（URL / data URI / 短链）取 sha256[:16] 做指纹。"""
    if not ref:
        return ""
    return hashlib.sha256(ref.encode("utf-8")).hexdigest()[:16]
