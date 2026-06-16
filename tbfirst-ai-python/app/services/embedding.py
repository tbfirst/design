"""V6.M2.A.5: bge-m3 embedding 服务（替换 routes/embedding.py 的 stub）。

- 进程内单例 lazy load，避免重复加载 ~600MB 模型
- 默认 CPU 模式（无 CUDA）；通过 settings.embedding_device 切 'cuda'
- 归一化输出，可直接喂 pgvector cosine_ops
- 同步 + 异步两套 API；批量调用统一走 asyncio.to_thread 不阻塞 event loop
"""
from __future__ import annotations
import asyncio
from functools import lru_cache  # noqa: F401  reserved for future per-call memoization
from typing import Sequence
from sentence_transformers import SentenceTransformer
from app.config import get_settings

_MODEL: SentenceTransformer | None = None


def _get_model() -> SentenceTransformer:
    global _MODEL
    if _MODEL is None:
        s = get_settings()
        model_name = getattr(s, "embedding_model", "BAAI/bge-m3")
        device = getattr(s, "embedding_device", "cpu")
        _MODEL = SentenceTransformer(model_name, device=device)
    return _MODEL


def embed_texts_sync(texts: Sequence[str], batch_size: int = 32) -> list[list[float]]:
    if not texts:
        return []
    m = _get_model()
    out = m.encode(list(texts), normalize_embeddings=True, batch_size=batch_size)
    return out.tolist()


async def embed_texts(texts: Sequence[str], batch_size: int = 32) -> list[list[float]]:
    return await asyncio.to_thread(embed_texts_sync, texts, batch_size)


async def embed_text(text: str) -> list[float]:
    vecs = await embed_texts([text])
    return vecs[0] if vecs else []
