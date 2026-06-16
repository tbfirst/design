"""日志初始化模块。在 main.py lifespan 启动时调用一次，全局生效。"""
import logging
from app.config import get_settings

# 日志初始化完成后即可在其他模块通过 logging.getLogger(__name__) 获取 logger 实例，logger.info(<打印的日志信息>)输出日志。
def setup_logging() -> None:
    """配置标准库 logging：从 config.LOG_LEVEL 读取日志级别，统一输出格式。"""
    settings = get_settings()   # 从环境变量或 .env 文件中读取配置信息，并赋值给 settings 变量
    logging.basicConfig(
        # 日志的打印级别
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        # 日志的输出格式，包含时间戳、日志级别、logger 名称和日志消息
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
