"""
通过 Nacos Open API（HTTP）完成服务注册/注销 + 心跳，
不依赖 nacos-sdk-python，避免 v1/v2/v3 API 不兼容问题。
"""
import asyncio
import logging
import socket

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

_registered = False
_heartbeat_task: asyncio.Task | None = None


def _local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


def _base_url(settings) -> str:
    return f"http://{settings.nacos_addr}"


async def _send_heartbeat(settings, ip: str):
    """每 5 秒发送一次心跳，保持实例健康。"""
    url = f"{_base_url(settings)}/nacos/v2/ns/health/instance"
    params = {
        "serviceName": settings.app_name,
        "ip": ip,
        "port": settings.app_port,
        "namespaceId": settings.nacos_ns,
        "healthy": "true",
    }
    async with httpx.AsyncClient() as client:
        # Nacos 要求：注册实例后，必须定期发送心跳（默认 5 秒），否则 Nacos 会将实例标记为不健康并剔除
        while True:
            try:
                await asyncio.sleep(5)
                await client.put(url, params=params, timeout=5)
            except asyncio.CancelledError:
                return
            except Exception:
                pass  # 心跳失败静默忽略  todo 日志记录并尝试重试


def register() -> None:
    """将 Python 服务注册到 Nacos（HTTP API）。失败不阻塞启动。"""
    global _registered, _heartbeat_task
    # 避免重复注册：如果已经注册过了，就直接返回，不再发送注册请求
    if _registered:
        return
    # 打包请求参数，包含服务名、本地IP、端口、命名空间、权重、健康状态、元数据（标记使用 FastAPI 框架）以及认证信息
    settings = get_settings()
    ip = _local_ip()
    url = f"{_base_url(settings)}/nacos/v2/ns/instance"
    params = {
        "serviceName": settings.app_name,
        "ip": ip,
        "port": settings.app_port,
        "namespaceId": settings.nacos_ns,
        "weight": 1,
        "enabled": "true",
        "healthy": "true",
        "metadata": '{"framework":"fastapi"}',
        "username": settings.nacos_username,
        "password": settings.nacos_password,
    }
    # 发送注册请求，成功后启动异步心跳任务；失败则记录警告日志但不抛出异常，允许服务继续启动但不在 Nacos 中可见
    try:
        resp = httpx.post(url, params=params, timeout=5)    # 发送一个 POST 请求
        resp.raise_for_status()     # 如果 Nacos 返回 4xx/5xx，抛出异常进入 except
        _registered = True
        logger.info("[Nacos] registered %s @ %s:%d", settings.app_name, ip, settings.app_port)
        # 启动异步心跳
        try:
            loop = asyncio.get_running_loop()       # 获取当前运行的事件循环
            _heartbeat_task = loop.create_task(_send_heartbeat(settings, ip))   # 创建一个异步任务来发送心跳
        except RuntimeError:
            pass  # 不在事件循环中，跳过心跳
    except Exception as e:
        logger.warning("[Nacos] register failed: %s", e)


def deregister() -> None:
    global _registered, _heartbeat_task
    if _heartbeat_task:
        _heartbeat_task.cancel()
        _heartbeat_task = None
    settings = get_settings()
    url = f"{_base_url(settings)}/nacos/v2/ns/instance"
    params = {
        "serviceName": settings.app_name,
        "ip": _local_ip(),
        "port": settings.app_port,
        "namespaceId": settings.nacos_ns,
        "username": settings.nacos_username,
        "password": settings.nacos_password,
    }
    try:
        httpx.delete(url, params=params, timeout=5)     # 直接发送删除请求注销实例  todo 优雅关闭等待
        _registered = False
    except Exception as e:
        logger.warning("[Nacos] deregister failed: %s", e)
