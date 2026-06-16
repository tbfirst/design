"""Redis 客户端单例。

模块级单例模式（等价 Spring 的 @Bean("redisTemplate") 单例）：
模块首次 import 时初始化连接，之后所有调用方共用同一个 client 实例。
"""
import redis

from app.config import get_settings

_settings = get_settings()

# decode_responses=True：所有返回值自动解码为 str，避免各处手动 .decode()
# todo 连接池配置、集群配置、连接测试、异常处理等等功能
_client = redis.Redis(
    host=_settings.redis_host,
    port=_settings.redis_port,
    db=_settings.redis_db,
    decode_responses=True,
)


def get_redis() -> redis.Redis:
    """返回全局共享的 Redis 客户端实例。"""
    return _client
