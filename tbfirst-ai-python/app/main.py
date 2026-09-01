import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.common.nacos import client as nacos_client
from app.common.log.logger import setup_logging
from app.common.security.security import warn_default_token
from app.routes import api_router

# ── 配置日志────────────────────────────────────────────────────────────────

setup_logging()         # 调用 common.log.logger 模块中的 setup_logging 函数，配置全局日志系统
logger = logging.getLogger(__name__)
settings = get_settings()


# ── 生命周期 ────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("[tbfirst-ai-python] starting ...")
    warn_default_token()
    nacos_client.register()

    if settings.design_agent_enabled:
        try:
            from app.db.migrations import run_migrations
            from app.db.pool import open_agent_db_pool

            await run_migrations()
            await open_agent_db_pool()
            logger.info("[tbfirst-ai-python] design agent migrations ready")
        except Exception as e:
            logger.exception("design agent migration failed (routes may be unavailable): %s", e)

    # LangGraph Checkpointer + Store + Agent Graph（优雅降级）：
    # 正常模式有完整的 AI 能力：Agent 对话、RAG 检索、记忆持久化、MCP 调用等，降级模式无 Graph（不执行 Agent 相关功能，但其他功能正常）

    # 自定义整个应用生命周期内共享对象（如数据库连接池、模型实例等），通过 app.state 进行存储和访问
    app.state.agent_graph = None                # Agent 的执行图
    app.state.agent_checkpointer = None         # 检查点器，用于持久化对话状态
    app.state.agent_store = None                # 向量存储，用于 RAG 检索
    try:
        from app.agent.graph.build import build_agent_graph, get_or_init_checkpointer
        from app.agent.memory.store import PgvectorStore

        checkpointer = await get_or_init_checkpointer()         # 异步初始化检查点器（通常连接 PostgreSQL）
        store = PgvectorStore()                                 # 初始化向量存储（通常连接 PostgreSQL + pgvector）
        app.state.agent_checkpointer = checkpointer
        app.state.agent_store = store
        app.state.agent_graph = await build_agent_graph(checkpointer, store)
        logger.info("[tbfirst-ai-python] agent graph 初始化")
    except Exception as e:
        logger.exception("agent graph 初始化失败 (continuing degraded): %s", e)

    yield  # 在此之前的代码为启动逻辑，之后的代码为关闭逻辑

    logger.info("[tbfirst-ai-python] shutting down ...")
    cp = getattr(app.state, "agent_checkpointer", None)     # 从 app.state 获取 agent_checkpointer，无则 None
    pool = getattr(cp, "conn", None) if cp is not None else None # 先检查 cp ！= None，之后从检查点器获取数据库连接池，无则 None
    if pool is not None and hasattr(pool, "close"):
        try:
            await pool.close()      # 关闭数据库连接池
        except Exception as e:
            logger.warning("agent checkpointer pool 关闭失败: %s", e)
    try:
        from app.agent.design.evaluator import close_evaluator_client
        from app.mcp_server.clients.gateway import close_gateway_client
        from app.common.redis.async_client import close_async_redis
        from app.db.pool import close_agent_db_pool

        results = await asyncio.gather(
            close_evaluator_client(),
            close_gateway_client(),
            close_async_redis(),
            close_agent_db_pool(),
            return_exceptions=True,
        )
        for result in results:
            if isinstance(result, Exception):
                logger.warning("shared async resource 关闭失败: %s", result)
    except Exception as e:
        logger.warning("shared async resource cleanup 初始化失败: %s", e)
    nacos_client.deregister()


# ── 应用实例 ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="tbfirst-ai-python",
    description="tbfirst 公共 AI 服务：生图/文本/嵌入/RAG/Skill/MCP",
    version="1.0.0",
    lifespan=lifespan,          # 将上面定义的生命周期函数绑定到应用
)


# ── 中间件 ──────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],             # todo 生产不要使用通配符，改为具体域名列表
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 全局异常处理器 ──────────────────────────────────────────────────────────

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """422：请求参数校验失败，返回 Pydantic 错误详情。"""
    logger.warning("[请求参数校验失败] %s %s %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=422,
        content={"code": 422, "msg": "请求参数错误", "detail": exc.errors()},
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """500：未捕获的服务端异常兜底，记录完整堆栈。"""
    logger.exception("[全局异常] %s %s → %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={"code": 500, "msg": "服务器内部错误"},
    )


# ── 路由挂载 ────────────────────────────────────────────────────────────────

app.include_router(api_router)      # 统一封装在 app.routes.__init__.py 中的 api_router，包含所有子路由

# ── 健康检查端点 ────────────────────────────────────────────────────────────────

@app.get("/health", tags=["基础"])
async def health() -> dict:
    return {"status": "ok", "service": settings.app_name}


# ── 运行入口 ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=True,
    )
