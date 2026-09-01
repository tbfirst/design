""" LangGraph State 定义。"""
from __future__ import annotations
from typing import TypedDict, Annotated, Optional
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class AppState(TypedDict):
    # L2 工作记忆 —— LangGraph 内置 reducer（调用 add_messages 追加而不是覆盖）
    messages: Annotated[list[BaseMessage], add_messages]

    # 检索结果（每轮重建，不持久化）
    retrieved_recall: list[dict]      # L3
    retrieved_workflow: list[dict]    # L5
    retrieved_shared: list[dict]      # L6

    # always-inject 部分（每轮重新加载，不持久化）
    basic_rules: str                  # L1 拼好的 Markdown
    preferences: dict                 # L4 用户偏好 key→value

    # 元数据（持久化）
    user_id: int
    group_id: Optional[int]
    brand_id: Optional[int]
    session_uuid: str                 # == LangGraph 的 thread_id
    phase: Optional[str]

    # system prompt 缓存（每轮由 compose_prompt_node 写入，不持久化）
    _system_prompt_cached: str

    # Session Memory（持久化，compact 后仍存续）
    session_memory: Optional[str]
    last_session_memory_at_msg_id: Optional[int]

    # 压缩状态（持久化，用于幂等触发）
    last_compress_at_msg_id: Optional[int]
    last_extract_at_msg_id: Optional[int]

    # 范式控制字段（持久化；全部 Optional，flag 全关时不使用）
    plan: Optional[list]              # planner 产出的步骤列表
    plan_cursor: Optional[int]        # 当前执行到第几步
    replan_count: Optional[int]       # 已 replan 次数
    reflect_count: Optional[int]      # 当前步骤已反思次数
    last_eval_score: Optional[float]  # 最近一次评估分数
    _pending_critique: Optional[str]  # 待注入的评估反馈
    _current_subgoal: Optional[str]   # 当前步骤子目标
    plan_mode: Optional[str]          # "plan" | "react" | None

    # 设计域上下文（仅设计项目设置；普通对话保持为空）
    project_id: Optional[int]
    project_uuid: Optional[str]
    run_id: Optional[int]
    brief: Optional[dict]
    brief_version: Optional[int]
    design_plan: Optional[dict]
    artifact_ids: list[int]
    selected_artifact_id: Optional[int]
    pending_action_id: Optional[str]
    evaluation_report: Optional[dict]
    generation_calls: int
