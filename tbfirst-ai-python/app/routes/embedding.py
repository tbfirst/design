"""V6.M2.A.6: embedding 路由。POST /embedding 输入 texts 列表，输出 vectors。"""
from fastapi import APIRouter

from app.schemas.embedding import EmbeddingBatchRequest, EmbeddingBatchResponse
from app.services.embedding import embed_texts

router = APIRouter(prefix="/embedding", tags=["embedding"])


@router.post("", response_model=EmbeddingBatchResponse)
async def embed_batch(req: EmbeddingBatchRequest) -> EmbeddingBatchResponse:
    vecs = await embed_texts(req.texts)
    return EmbeddingBatchResponse(
        model="BAAI/bge-m3",
        dim=len(vecs[0]) if vecs else 0,
        vectors=vecs,
    )
