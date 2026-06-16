from fastapi import APIRouter

from app.schemas import McpCallRequest

router = APIRouter(prefix="/mcp", tags=["mcp"])


@router.get("/servers")
async def list_servers() -> dict:
    # todo 预留接口，当前暂未实现 —— 从 app/mcp/servers.json 读取配置
    return {"servers": []}


@router.post("/call")
async def call(req: McpCallRequest) -> dict:
    # todo 预留接口，当前暂未实现 —— 通过 MCP 官方 SDK 连接对应 server 并调用 tool
    return {"server": req.server, "tool": req.tool, "result": None, "todo": "not implemented"}
