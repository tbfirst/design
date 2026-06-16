"""请求去重 / 在飞合并（V5.XVII.K.5）。

设计目标：用户在前端连点 N 次「生图」按钮（或 React StrictMode 双触发等场景），
后端只应触发 1 次上游 Gemini 调用，其余请求共享同一份结果。

与「结果缓存」的根本区别：
    - 完成即释放（DEL key），不持久化结果 → 用户主动重试拿到的是新随机输出
    - 仅在 in-flight 期间合并，TTL 默认 90s（覆盖 Gemini 多模型 fallback 链 + 网关 620s 不冲突）
    - 错图不会被复用（这正是 V5.XVII.K.1 删除全量缓存后的核心补偿）

实现：
    1. Redis SET key <leader_id> NX PX 90000 抢锁
    2. Leader 执行计算 → PUBLISH key:result <json payload> → DEL key
    3. Follower 订阅 key:result → 等待 ≤ 90s → 拿到 payload 直接返回
       超时 fallback：自己跑一次（leader 进程崩了的情况）

注意事项：
    - 跨进程 / 跨 worker 共享通过 Redis，单 Python worker 内并发也走这条路径（统一）
    - PSUBSCRIBE 时序：必须先订阅再抢锁判定，否则 leader 在 follower 订阅前 publish 就丢消息
    - 使用 redis.asyncio 避免阻塞 event loop（cache.py 的同步客户端不能用在这里）
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Any

import redis.asyncio as aioredis

from app.config import get_settings

logger = logging.getLogger(__name__)

SF_PREFIX = "tbfirst:ai:sf"
SF_DEFAULT_TTL_SEC = 90  # 用户决策：90s 窗口

_settings = get_settings()

# K.10: lazy init —— 不在 import 时构造 aioredis.Redis，避免连接池绑定到错的 event loop。
# 触发场景：uvicorn --workers >1 fork 出来的 worker 会拿到一个新 loop；pytest-asyncio
# 每个测试也是新 loop。模块级 instance 会绑死到第一次 import 时的 loop（或没有 loop），
# 后续 await _aredis.X 直接 "got Future attached to a different loop" 报错。
# 同步路径仍使用 app/core/redis_client.py。
_aredis: aioredis.Redis | None = None


def _get_aredis() -> aioredis.Redis:
    global _aredis
    if _aredis is None:
        _aredis = aioredis.Redis(
            host=_settings.redis_host,
            port=_settings.redis_port,
            db=_settings.redis_db,
            decode_responses=True,
        )
    return _aredis


# K.8: Lua compare-and-delete 释放锁，避免慢 leader 过 TTL 后误删新 leader 的锁
_DEL_IF_OWNED = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
"""


async def _publish_noop(payload: dict[str, Any]) -> None:
    """fallback publish 占位：fail-open / 超时 fake-leader 分支共用，
    满足调用方 `await sf.publish(...)` 接口但不真广播。"""
    return None


def compute_key(namespace: str, normalized_payload: dict[str, Any]) -> str:
    """对规范化 payload 取 sha256 得到 singleflight key。

    调用方负责剥离扰动字段（如 force_refresh、客户端 timestamp、nonce 等）。
    """
    raw = json.dumps(normalized_payload, sort_keys=True, ensure_ascii=False)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]
    return f"{SF_PREFIX}:{namespace}:{digest}"


def normalize_image_payload(req_payload: dict[str, Any]) -> dict[str, Any]:
    """从 ImageGenerateRequest.model_dump() 提取参与 singleflight key 计算的稳定子集。

    显式排除：
      - force_refresh（DNA 旁路开关）
      - 客户端时间戳 / nonce（如果有）
      - reference_labels 中的空串（labels 视为可选）
    """
    pc = dict(req_payload.get("phase_config") or {})
    pc.pop("force_refresh", None)
    pc.pop("nonce", None)
    pc.pop("timestamp", None)
    labels = [l for l in (req_payload.get("reference_labels") or []) if l]
    return {
        "phase": req_payload.get("phase"),
        "prompt": (req_payload.get("prompt") or "").strip(),
        "reference_images": req_payload.get("reference_images") or [],
        "reference_labels": labels,
        "aspect_ratio": req_payload.get("aspect_ratio"),
        "image_size": req_payload.get("image_size"),
        "phase_config": pc,
    }


@dataclass
class SfContext:
    key: str
    leader_id: str | None  # 抢到锁时为 own uuid，否则 None
    shared_result: dict[str, Any] | None  # follower 等到的结果
    is_leader: bool


@contextlib.asynccontextmanager
async def coalesce(key: str, ttl: int = SF_DEFAULT_TTL_SEC):
    """singleflight 上下文管理器。

    用法：
        async with singleflight.coalesce(key) as ctx:
            if ctx.shared_result is not None:
                return ctx.shared_result          # follower 拿到 leader 广播
            result = ... # leader 自己跑
            await ctx.publish(result)
            return result
    """
    own = uuid.uuid4().hex
    channel = f"{key}:result"
    ctx = SfContext(key=key, leader_id=None, shared_result=None, is_leader=False)

    # 先订阅再抢锁，避免 leader 在 follower 订阅前 publish 导致丢消息
    aredis = _get_aredis()
    pubsub = aredis.pubsub()
    try:
        await pubsub.subscribe(channel)

        # SET NX PX
        try:
            got = await aredis.set(key, own, nx=True, px=ttl * 1000)
        except Exception as e:
            logger.warning("[SF] SET NX failed, fail-open: %s", e)
            ctx.is_leader = True
            ctx.leader_id = own
            # K.8: fail-open 路径也要挂 publish 占位，否则调用方 `await sf.publish(...)` 抛 AttributeError
            ctx.publish = _publish_noop  # type: ignore[attr-defined]
            yield ctx
            return

        if got:
            # 抢到锁：本进程是 leader
            ctx.is_leader = True
            ctx.leader_id = own
            logger.info("[SF] leader key=%s ttl=%ds", key[-16:], ttl)

            async def _publish(payload: dict[str, Any]) -> None:
                try:
                    await aredis.publish(channel, json.dumps(payload, ensure_ascii=False))
                except Exception as e:
                    logger.warning("[SF] publish failed: %s", e)

            ctx.publish = _publish  # type: ignore[attr-defined]
            try:
                yield ctx
            except Exception as exc:
                # K.8: leader 计算阶段抛错时主动广播错误，避免 follower 干等满 TTL
                # 再各自 fallback，把单次失败放大成 N 倍重试。
                try:
                    await aredis.publish(
                        channel,
                        json.dumps({"__sf_error__": str(exc)[:200]}, ensure_ascii=False),
                    )
                except Exception as pub_err:
                    logger.warning("[SF] leader-error publish failed: %s", pub_err)
                raise
            finally:
                # K.8: Lua compare-and-delete，仅当 lock 仍是本 leader 时才删，
                # 避免慢 leader（>TTL）误删后来 leader 的锁。
                try:
                    await aredis.eval(_DEL_IF_OWNED, 1, key, own)
                except Exception as e:
                    logger.warning("[SF] delete (CAS) failed: %s", e)
        else:
            # 没抢到：follower 等 leader 广播
            logger.info("[SF] follower key=%s, awaiting leader broadcast", key[-16:])
            deadline = time.monotonic() + ttl
            result: dict[str, Any] | None = None
            while time.monotonic() < deadline:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                # redis.asyncio.PubSub.get_message(timeout=...) 内部已 await，
                # 不需要再套 asyncio.wait_for。轮询粒度 5s 兼顾响应性与 CPU。
                msg = await pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=min(remaining, 5.0),
                )
                if msg and msg.get("type") == "message":
                    data = msg.get("data")
                    if isinstance(data, (bytes, bytearray)):
                        data = data.decode("utf-8", errors="replace")
                    try:
                        parsed = json.loads(data) if data else None
                    except Exception as e:
                        logger.warning("[SF] follower decode failed: %s", e)
                        parsed = None
                    # K.8: leader 广播错误信号 → 跳出等待，自己 fallback 重跑而非干等满 TTL
                    if isinstance(parsed, dict) and "__sf_error__" in parsed:
                        logger.info(
                            "[SF] follower got leader-error '%s', fallback to own run",
                            parsed.get("__sf_error__"),
                        )
                        result = None
                    else:
                        result = parsed
                    break

            if result is not None:
                logger.info("[SF] follower hit broadcast key=%s", key[-16:])
                ctx.shared_result = result
                yield ctx
            else:
                # 超时（leader 崩了或 90s 没跑完）：fallback 自己作为 leader 重跑一次
                logger.warning("[SF] follower timeout, fallback to own run key=%s", key[-16:])
                ctx.is_leader = True  # 让调用方走 leader 分支
                ctx.leader_id = own

                async def _publish_noop(payload: dict[str, Any]) -> None:
                    # fallback 路径不广播（leader 锁已被原 leader 释放或自然失效），
                    # 也不重复 publish 避免误唤醒其他批次
                    return None

                ctx.publish = _publish_noop  # type: ignore[attr-defined]
                yield ctx
    finally:
        try:
            await pubsub.unsubscribe(channel)
        except Exception as e:
            logger.debug("[SF] pubsub unsubscribe suppressed: %s", e)
        # redis-py 4.x → aclose() / 5.x → aclose(); close() 在新版 deprecated
        close = getattr(pubsub, "aclose", None) or getattr(pubsub, "close", None)
        if close is not None:
            try:
                res = close()
                if asyncio.iscoroutine(res):
                    await res
            except Exception as e:
                logger.debug("[SF] pubsub close suppressed: %s", e)
