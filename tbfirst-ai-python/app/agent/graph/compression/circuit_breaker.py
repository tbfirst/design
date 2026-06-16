"""
熔断与降级机制

部署说明：
- 单 uvicorn worker（默认）：asyncio.Lock 保证同进程内多协程并发安全。
- 多 worker 部署（--workers N）：每个 worker 进程有独立的 _registry 副本，
  熔断状态不跨进程共享。多 worker 场景须使用 Redis 后端替换 _registry，
  否则已熔断的 session 在另一 worker 仍可继续触发规划器/评估器。
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from enum import Enum


class _State(Enum):
    CLOSED = "closed"       # 正常状态，允许操作
    OPEN = "open"           # 熔断状态，拒绝操作以保护系统稳定性

# @dataclass 可自动重写 __init__、__repr__、__eq__ 等方法
@dataclass
class CircuitBreaker:
    threshold: int = 3
    # default：默认值，init=False：不包含在 __init__ 方法的参数中，repr=False：不包含在 __repr__ 方法的输出中
    _failures: int = field(default=0, init=False, repr=False)
    _state: _State = field(default=_State.CLOSED, init=False, repr=False)

    def fail(self) -> None:
        self._failures += 1
        # 当计数器达到 threshold（默认 3），状态从 CLOSED 翻转为 OPEN
        if self._failures >= self.threshold:
            self._state = _State.OPEN

    def check(self) -> None:
        if self._state is _State.OPEN:
            raise RuntimeError(
                f"熔断器开启，当前已失败 {self._failures} 次，拒绝执行以保护系统稳定性"
            )

    def reset(self) -> None:
        self._failures = 0
        self._state = _State.CLOSED


# 单个 session 的独立熔断器：
#   - compress：压缩主流程（cascade_compress_node 整体）
#   - tool：工具读回（read_cached_tool_result 从磁盘取回 L1 缓存）
#   - dependency：外部依赖（L4 的 Gemini 摘要 + DB session 查询）
#   - evaluator：Phase D Reflection 评估器（evaluate_image/evaluate_text_rubric）
#   - planner：Phase D Plan-Solve 规划器（plan_node/replan_node）
# 各类相互隔离：某一类连续失败熔断，不影响另外几类继续工作。
@dataclass
class BreakerSet:
    compress: CircuitBreaker = field(default_factory=CircuitBreaker)
    tool: CircuitBreaker = field(default_factory=CircuitBreaker)
    dependency: CircuitBreaker = field(default_factory=CircuitBreaker)
    evaluator: CircuitBreaker = field(default_factory=CircuitBreaker)
    planner: CircuitBreaker = field(default_factory=CircuitBreaker)


# 熔断器按 session 维度隔离：避免某个会话的连续失败把全局压缩/工具/依赖一并熔断，
# 拖垮所有并发用户（旧实现是模块级单例，一个坏会话会污染全服务）。
_registry: dict[str, BreakerSet] = {}
# 注册表软上限：超出后按插入顺序淘汰最旧的会话熔断器，防止长期运行内存泄漏（dict 保持插入序）。
_MAX_SESSIONS = 1024
# asyncio.Lock 保护 _registry 的 len-check → evict → assign 三步原子性，
# 防止同进程多协程并发创建同一 session 的重复 BreakerSet（单 worker 场景）。
_registry_lock: asyncio.Lock | None = None


def _get_lock() -> asyncio.Lock:
    global _registry_lock
    if _registry_lock is None:
        _registry_lock = asyncio.Lock()
    return _registry_lock


def get_breakers(session_key: str | None) -> BreakerSet:
    """按 session_key（通常是 session_uuid）取该会话独立的三类熔断器集合，不存在则惰性创建。

    线程安全：同步函数，使用无竞争的 dict.get + 二次检查模式；Lock 仅在需要写入时通过
    get_breakers_async 异步获取。同步路径适用于绝大多数节点的直接调用场景。
    """
    key = session_key or "_default_"
    bs = _registry.get(key)
    if bs is not None:
        return bs
    # 快速路径未命中，直接写入（asyncio 单线程保证此处无真正并发，GIL 保护 dict 操作）
    if len(_registry) >= _MAX_SESSIONS:
        oldest = next(iter(_registry))
        _registry.pop(oldest, None)
    bs = BreakerSet()
    _registry[key] = bs
    return bs


async def get_breakers_async(session_key: str | None) -> BreakerSet:
    """异步版本：通过 asyncio.Lock 保证 len-check → evict → assign 原子性。

    在高并发场景（多协程同时首次访问同一 session_key）下替代 get_breakers 使用。
    """
    key = session_key or "_default_"
    bs = _registry.get(key)
    if bs is not None:
        return bs
    async with _get_lock():
        # 二次检查：持锁后再查一次，防止等锁期间已被其他协程创建
        bs = _registry.get(key)
        if bs is not None:
            return bs
        if len(_registry) >= _MAX_SESSIONS:
            oldest = next(iter(_registry))
            _registry.pop(oldest, None)
        bs = BreakerSet()
        _registry[key] = bs
    return bs
