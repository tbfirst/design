"""路由聚合中心：所有子路由在此统一注册，main.py 只需 include 一个 api_router。"""
from fastapi import APIRouter

from app.routes.image import router as image_router
from app.routes.inpaint import router as inpaint_router
from app.routes.embedding import router as embedding_router
from app.routes.copilot import router as copilot_router
from app.routes.rag import router as rag_router
from app.routes.skill import router as skill_router
from app.routes.mcp import router as mcp_router
from app.routes.cinestitch import router as cinestitch_router
from app.routes.agent import router as agent_router
from app.routes.admin.basic_rules import router as basic_rules_router
from app.routes.admin.wiki import router as wiki_router

api_router = APIRouter()

api_router.include_router(image_router)
api_router.include_router(inpaint_router)
api_router.include_router(embedding_router)
api_router.include_router(copilot_router)
api_router.include_router(rag_router)
api_router.include_router(skill_router)
api_router.include_router(mcp_router)
api_router.include_router(cinestitch_router)
api_router.include_router(agent_router)
api_router.include_router(basic_rules_router)
api_router.include_router(wiki_router)
