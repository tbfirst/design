"""V6.M2.B.5 / C.3 / D.3: StateGraph 编译入口。

图拓扑（v3）：
  START ─┬─→ load_basic_rules ───┐
         ├─→ load_preferences ───┼─→ compose_prompt → llm_call
         └─→ retrieve_memories ──┘         ↓（tools_or_max_turns 条件边）
                                     ┌─── tools ←──┐
                                     │   llm_call ──┘（循环，最多 MAX_TURNS 轮）
                                     │
                                     ├─── max_turns_end → save_state
                                     └─── save_state
                                               ↓（route_after_save 条件边）
                                        ┌──────┼──────┐
                                    compress extract  end
                                        ↓       ↓      ↓
                                   compress  extract  END
                                   _state  _prefs
                                        ↓    └──→ END
                                  should_extract?
                                  extract → END
                                  end     → END
"""
from __future__ import annotations

import logging

from langgraph.graph import StateGraph, START, END
from psycopg.rows import dict_row

try:
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg_pool import AsyncConnectionPool
except ImportError:
    AsyncPostgresSaver = None  # type: ignore[assignment,misc]
    AsyncConnectionPool = None  # type: ignore[assignment,misc]

from app.config import get_settings
from app.agent.graph.edges import (
    after_reflect_accept,
    plan_router,
    reflect_router,
    replan_router,
    route_after_save,
    should_extract,
    should_plan,
    tools_or_max_turns,
)

logger = logging.getLogger(__name__)
from app.agent.graph.nodes import (
    compose_prompt_node,
    compress_state_node,
    execute_step,
    extract_preferences_node,
    inject_critique_node,
    llm_call_node,
    load_basic_rules_node,
    load_preferences_node,
    plan_node,
    reflect_gate_node,
    reflexion_write_node,
    replan_node,
    retrieve_memories_node,
    save_state_node,
    update_session_memory_node,
)
from app.agent.graph.state import AppState
from app.agent.graph.tools import ALL_TOOLS
from app.agent.graph.tools.executor import make_tool_executor_node
from app.agent.memory.store import PgvectorStore


async def _max_turns_end_node(state: dict) -> dict:
    """工具调用轮数超过 MAX_TURNS 时的强制结束节点，记录警告后交由 save_state 持久化。"""
    logger.warning("max_turns_end: 工具调用轮数超过最大次数，强制保存状态结束对话。session_uuid=%s", state.get("session_uuid"))
    return {}


async def build_agent_graph(checkpointer: AsyncPostgresSaver, store: PgvectorStore):
    """编译 LangGraph StateGraph，绑定 Checkpointer（PG 持久化）和 Store（pgvector）。"""
    g = StateGraph(AppState)

    # ── 注册所有节点 ────────────────────────────────────────────────────────
    g.add_node("load_basic_rules", load_basic_rules_node)   # L1：加载基础规则
    g.add_node("load_preferences", load_preferences_node)     # L4：加载用户偏好
    g.add_node("retrieve_memories", retrieve_memories_node)   # L3/L5/L6：KNN 检索
    g.add_node("compose_prompt", compose_prompt_node)         # 拼接 system prompt
    g.add_node("llm_call", llm_call_node)                     # LLM 调用（流式）
    g.add_node("save_state", save_state_node)                 # 持久化 Checkpoint
    g.add_node("update_session_memory", update_session_memory_node)  # Session Memory 更新
    g.add_node("compress_state", compress_state_node)         # L2→L3 消息压缩
    g.add_node("extract_preferences", extract_preferences_node) # 萃取 L4 偏好
    g.add_node("tools", make_tool_executor_node(ALL_TOOLS))   # ReAct 工具执行节点（并发分区 + 出口预算）
    g.add_node("max_turns_end", _max_turns_end_node)          # 工具轮数超限强制结束
    g.add_node("reflect_gate", reflect_gate_node)             # M2 Reflection 评估门
    g.add_node("inject_critique", inject_critique_node)       # M2 注入自检反馈
    g.add_node("plan_node", plan_node)                        # M3 Plan-Solve 规划
    g.add_node("execute_step", execute_step)                  # M3 注入子目标
    g.add_node("replan_node", replan_node)                    # M3 重规划
    g.add_node("reflexion_write", reflexion_write_node)       # M4 Reflexion 长期记忆写入

    # ── 定义边（执行顺序）──────────────────────────────────────────────────
    # START 三路并发（fan-out）：L1/L4/L3-5-6 并行加载
    g.add_edge(START, "load_basic_rules")
    g.add_edge(START, "load_preferences")
    g.add_edge(START, "retrieve_memories")

    # 三路 fan-in 到 compose_prompt（LangGraph 自动等齐所有入边）
    g.add_edge("load_basic_rules", "compose_prompt")
    g.add_edge("load_preferences", "compose_prompt")
    g.add_edge("retrieve_memories", "compose_prompt")

    # M3: compose_prompt → should_plan → {react: llm_call, plan: plan_node}
    # plan flag 关时 should_plan→react，等价 M2（不变量 2）
    g.add_conditional_edges(
        "compose_prompt",
        should_plan,
        {"react": "llm_call", "plan": "plan_node"},
    )

    # M3: plan_node → plan_router → {execute: execute_step, done: save_state}
    g.add_conditional_edges(
        "plan_node",
        plan_router,
        {"execute": "execute_step", "done": "save_state"},
    )
    g.add_edge("execute_step", "llm_call")  # 注入子目标后进 ReAct 循环

    # llm_call 后的条件路由：工具调用 / 超限强制结束 / 正常结束
    # M2: __end__ 和 max_turns_end 两条收尾均经过 reflect_gate（flag 关时直接 accept）
    g.add_conditional_edges(
        "llm_call",
        tools_or_max_turns,
        {"tools": "tools", "__end__": "reflect_gate", "max_turns_end": "max_turns_end"},
    )
    g.add_edge("tools", "llm_call")          # ReAct 循环：工具执行完再回 llm_call
    g.add_edge("max_turns_end", "reflect_gate")   # max_turns_end 也经 reflect_gate

    # M3: reflect_gate accept 后经 after_reflect_accept 分叉
    # plan 模式 → replan_node → replan_router → {continue: execute_step, done: save_state}
    # react 模式 → save_state（等价 M2）
    g.add_conditional_edges(
        "reflect_gate",
        reflect_router,
        {"accept": "after_reflect_accept", "revise": "inject_critique"},
    )
    g.add_node("after_reflect_accept", lambda s: {})  # passthrough 节点
    g.add_conditional_edges(
        "after_reflect_accept",
        after_reflect_accept,
        {"replan": "replan_node", "save": "save_state"},
    )
    g.add_conditional_edges(
        "replan_node",
        replan_router,
        {"continue": "execute_step", "done": "save_state"},
    )
    g.add_edge("inject_critique", "llm_call")  # 注入反馈后再次 llm_call

    # save_state → update_session_memory（每轮检查，条件不满足时 no-op）→ 后续路由
    g.add_edge("save_state", "update_session_memory")

    # update_session_memory 后的条件路由：Reflexion / 压缩 / 萃取 / 结束
    g.add_conditional_edges(
        "update_session_memory",
        route_after_save,
        {
            "reflexion_write": "reflexion_write",
            "compress": "compress_state",
            "extract": "extract_preferences",
            "end": END,
        },
    )
    g.add_edge("reflexion_write", END)  # Reflexion 写入后直接结束

    # 压缩完成后再判断一次是否需要萃取（串行保证，避免并发写 user_preference）
    g.add_conditional_edges(
        "compress_state",
        should_extract,
        {"extract": "extract_preferences", "end": END},
    )

    g.add_edge("extract_preferences", END)

    return g.compile(checkpointer=checkpointer, store=store)


async def get_or_init_checkpointer() -> AsyncPostgresSaver:
    """初始化 LangGraph PG Checkpointer：建连接池 → setup 幂等建表 → 返回 saver。"""
    s = get_settings()
    dsn = s.computed_checkpoint_dsn
    pool = AsyncConnectionPool(
        conninfo=dsn,
        max_size=10,
        open=False,                                    # 延迟打开，await pool.open() 再连接
        check=AsyncConnectionPool.check_connection,    # 连接健康探测
        kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
    )
    await pool.open()
    saver = AsyncPostgresSaver(pool)
    await saver.setup()   # 幂等建表（langgraph_checkpoint / checkpoint_blobs / checkpoint_writes）
    return saver
