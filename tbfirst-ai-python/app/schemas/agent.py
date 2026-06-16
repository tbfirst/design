"""Agent/RAG/Skill/MCP 骨架端点的请求 DTO（接口稳定，业务实现待填）。"""
from typing import Any

from pydantic import BaseModel, Field


class RagIngestRequest(BaseModel):
    """RAG 文档写入请求（/rag/ingest，骨架）。"""
    collection: str               # 向量集合名（如 "brand-dna"）
    docs: list[str]               # 待写入的文本列表
    metadata: list[dict[str, Any]] | None = None  # 与 docs 等长的元数据列表


class RagQueryRequest(BaseModel):
    """RAG 向量查询请求（/rag/query，骨架）。"""
    collection: str
    query: str                    # 查询文本（后端自动 embed）
    top_k: int = 5                # 返回最近邻数量


class SkillRunRequest(BaseModel):
    """Skill 动态执行请求（/skill/run，骨架，agent/skills/ 实现后启用）。"""
    skill: str                    # Skill 名称（对应注册的 Skill ID）
    params: dict[str, Any] = Field(default_factory=dict)  # Skill 入参


class McpCallRequest(BaseModel):
    """MCP 工具调用请求（/mcp/call，骨架，agent/mcp/ 实现后启用）。"""
    server: str                   # MCP Server 名称
    tool: str                     # 工具名称
    params: dict[str, Any] = Field(default_factory=dict)  # 工具入参
