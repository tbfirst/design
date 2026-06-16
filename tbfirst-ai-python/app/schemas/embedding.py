"""向量嵌入端点 DTO。本服务使用本地 bge-m3 模型（1024 维），不调外部 API。"""
from pydantic import BaseModel, Field


class EmbeddingRequest(BaseModel):
    """单文本或小批量嵌入请求（/embedding）。"""
    text: str | list[str]                 # 单条字符串或字符串列表
    model: str = "text-embedding-3-small" # 保留字段（当前固定使用 bge-m3，此字段暂不生效）


class EmbeddingBatchRequest(BaseModel):
    """批量嵌入请求（/embedding/batch），最多 128 条。"""
    texts: list[str] = Field(..., max_length=128)
    model: str | None = None


class EmbeddingBatchResponse(BaseModel):
    model: str               # 实际使用的模型名
    dim: int                 # 向量维度（bge-m3 为 1024）
    vectors: list[list[float]]  # 与 texts 等长的嵌入向量列表
