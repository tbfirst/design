from fastapi import APIRouter

from app.schemas import RagIngestRequest, RagQueryRequest

router = APIRouter(prefix="/rag", tags=["rag"])


@router.post("/ingest")
async def ingest(req: RagIngestRequest) -> dict:
    # todo 预留接口，当前暂未实现 —— LangChain + pgvector 入库
    return {"collection": req.collection, "ingested": len(req.docs), "todo": "not implemented"}


@router.post("/query")
async def query(req: RagQueryRequest) -> dict:
    # todo 预留接口，当前暂未实现 —— 向量检索 + rerank
    return {"collection": req.collection, "hits": [], "todo": "not implemented"}
