"""V6.M2.B.12: graph 单元测试。

3 case：
  1. _assert_user_namespace 同 user_id 不 raise（正向）
  2. _assert_user_namespace 跨 user_id raise PermissionError（R20 审计断言）
  3. build_agent_graph + InMemorySaver 不抛，能编译可调用图

注：本套测试不连 PG。case3 使用 langgraph.checkpoint.memory.InMemorySaver（也作 MemorySaver 暴露）
替代 AsyncPostgresSaver，仅校验 build_agent_graph 的 StateGraph 装配链路；真实 Checkpointer 触发
留 B.13 端到端冒烟（需迷你主机 PG）。
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.agent.memory.store import PgvectorStore, _assert_user_namespace  # noqa: E402


def test_assert_user_namespace_match():
    """正向：namespace[1] == ctx_user_id 不抛。"""
    _assert_user_namespace(("recall", 1), 1)
    _assert_user_namespace(("semantic", 42), 42)
    # shared namespace 不强校验 user_id
    _assert_user_namespace(("shared", "public", "personal-wiki"), 1)


def test_assert_user_namespace_mismatch_raises():
    """R20 核心：namespace[1] != ctx_user_id 抛 PermissionError（不抛 ValueError 等模糊错误）。"""
    with pytest.raises(PermissionError):
        _assert_user_namespace(("recall", 1), 2)
    with pytest.raises(PermissionError):
        _assert_user_namespace(("semantic", 7), 8)


class _TestStore(PgvectorStore):
    """测试专用 PgvectorStore 子类——覆盖 langgraph 0.2.50+ 新增的 batch/abatch 抽象方法。

    生产 PgvectorStore 骨架（B.3）只覆盖 aget/aput/asearch/alist/adelete；新版本 BaseStore
    把 batch/abatch 也设为抽象，导致裸实例化会触发 TypeError。本子类提供 NotImplementedError
    桩，保持与 B.3 骨架风格一致；生产 store 同样需要补齐这两个方法，记录在 C.1 的待办里。
    """

    def batch(self, ops):
        raise NotImplementedError("PgvectorStore.batch pending C/D/E impl")

    async def abatch(self, ops):
        raise NotImplementedError("PgvectorStore.abatch pending C/D/E impl")


def test_state_graph_compiles_with_mock_checkpointer():
    """用 InMemorySaver 替代 AsyncPostgresSaver 验证 StateGraph 编译链路通顺。

    断言：build_agent_graph 返回带 .ainvoke / .astream_events 的可调用图对象，不抛。
    """
    from langgraph.checkpoint.memory import InMemorySaver

    from app.agent.graph.build import build_agent_graph

    async def _build():
        saver = InMemorySaver()
        store = _TestStore()
        graph = await build_agent_graph(saver, store)
        return graph

    graph = asyncio.run(_build())
    assert graph is not None
    assert hasattr(graph, "ainvoke"), "compiled graph should expose ainvoke"
    assert hasattr(graph, "astream_events"), "compiled graph should expose astream_events"
