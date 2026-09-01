import json as _json
from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _parse_chain(v: str) -> list[str]:
    """逗号分隔字符串或 JSON 数组字符串 → list[str]。"""
    if not v:
        return []
    v = v.strip()
    if v.startswith("["):
        try:
            return _json.loads(v)
        except _json.JSONDecodeError:
            pass
    return [x.strip() for x in v.split(",") if x.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",          # 指定配置文件，将会自动从项目根目录的 .env 文件加载环境变量
        case_sensitive=False,     # 环境变量不区分大小写
        extra="ignore"            # 忽略 .env 中有多余但在代码中未定义的字段
    )

    app_host: str = "0.0.0.0"
    app_port: int = 8200
    app_name: str = "tbfirst-ai-python"
    log_level: str = "INFO"

    nacos_addr: str = "localhost:8848"
    nacos_ns: str = "dev"
    nacos_username: str = "nacos"
    nacos_password: str = "nacos"

    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0

    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "tbfirst"
    db_user: str = "tbfirst"
    db_password: str = "tbfirst"

    gemini_api_key: str = ""
    openai_api_key: str = ""
    anthropic_api_key: str = ""

    # 大模型降级链：存为原始字符串（pydantic_settings v2 对 List[str] 会在 validator 前强制
    # json.loads，导致逗号分隔写法启动报错）。通过下方 @property 暴露为 list[str]，对外接口不变。
    # .env 支持两种格式：
    #   逗号分隔  GEMINI_IMAGE_CHAIN=flash,pro
    #   JSON 数组  GEMINI_IMAGE_CHAIN=["flash","pro"]
    gemini_image_chain_raw: str = Field(
        default="",
        validation_alias=AliasChoices("gemini_image_chain", "GEMINI_IMAGE_CHAIN"),
    )
    gemini_text_chain_raw: str = Field(
        default="",
        validation_alias=AliasChoices("gemini_text_chain", "GEMINI_TEXT_CHAIN"),
    )
    gemini_dna_chain_raw: str = Field(
        default="",
        validation_alias=AliasChoices("gemini_dna_chain", "GEMINI_DNA_CHAIN"),
    )

    @property
    def gemini_image_chain(self) -> list[str]:
        return _parse_chain(self.gemini_image_chain_raw)

    @property
    def gemini_text_chain(self) -> list[str]:
        return _parse_chain(self.gemini_text_chain_raw)

    @property
    def gemini_dna_chain(self) -> list[str]:
        return _parse_chain(self.gemini_dna_chain_raw)

    # 各微服务调用本服务的内部认证令牌  todo 生产环境请设置为复杂随机字符串
    internal_token: str = "tbfirst-internal"

    # todo 在 .env 中添加以下配置项以启用向量记忆功能，否则默认关闭
    # 向量记忆总开关：关闭时 L3/L5/L6 全部跳过，不加载 bge-m3 模型
    agent_vector_memory_enabled: bool = False

    # Phase D 组合形态 feature flag（默认 OFF，分阶段灰度开启）
    agent_plan_enabled: bool = False      # M3 Plan-Solve 层
    agent_reflect_enabled: bool = False   # M2 Reflection/Verify 层
    agent_reflexion_enabled: bool = False # M4 Reflexion 长期记忆写入
    design_agent_enabled: bool = True
    agent_db_pool_min_size: int = Field(default=1, ge=0)
    agent_db_pool_max_size: int = Field(default=10, ge=1)
    agent_db_pool_timeout_seconds: float = Field(default=10.0, gt=0)
    agent_execution_lease_seconds: int = Field(default=120, ge=15)
    agent_request_dedupe_seconds: int = Field(default=86400, ge=30)

    # Design Agent tool gateway. It reuses the authenticated platform gateway.
    tbfirst_mcp_gateway_url: str = "http://localhost:8000"
    tbfirst_mcp_auth_mode: str = "header"
    tbfirst_mcp_token_secret: str = ""
    tbfirst_mcp_token_map: str = ""
    tbfirst_mcp_require_employee_mapping: bool = True
    tbfirst_mcp_http_timeout_seconds: float = 120.0
    tbfirst_mcp_retry_attempts: int = 3
    tbfirst_mcp_circuit_initial_open_seconds: float = Field(default=10.0, gt=0)
    tbfirst_mcp_circuit_max_open_seconds: float = Field(default=60.0, gt=0)
    tbfirst_mcp_tool_timeout_seconds: int = 240
    tbfirst_mcp_max_images_per_call: int = 5
    tbfirst_mcp_max_image_bytes: int = 10485760
    tbfirst_mcp_allowed_image_hosts: str = ""
    tbfirst_mcp_max_prompt_chars: int = 4000
    tbfirst_mcp_audit_enabled: bool = True
    tbfirst_mcp_audit_path: str = "logs/design_tool_audit.jsonl"
    tbfirst_mcp_user_daily_default: int = 100
    tbfirst_mcp_group_daily_default: int = 1000
    tbfirst_mcp_quota_period_seconds: int = 86400
    tbfirst_mcp_enabled_tools: str = (
        "tbfirst_check_workspace,"
        "tbfirst_create_adimage_set,"
        "tbfirst_image_phase2_refine,"
        "tbfirst_image_phase2_color,"
        "tbfirst_image_phase3_banner"
    )
    # LangGraph + embedding model 配置
    checkpoint_dsn: str = ""
    embedding_model: str = "BAAI/bge-m3"
    embedding_device: str = "cpu"       # "cpu" 或 "cuda"，如果使用 GPU 进行向量计算，设置为 "cuda" 并确保环境中正确安装了 GPU 版本的相关库

    # 获取向量数据库连接字符串，优先使用 checkpoint_dsn 配置项，如果未设置则根据数据库连接参数构建 DSN 字符串
    @property
    def computed_checkpoint_dsn(self) -> str:
        if self.checkpoint_dsn:
            return self.checkpoint_dsn
        return f"postgresql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"


# 使用 lru_cache 缓存 get_settings 函数的结果，确保整个应用生命周期内只创建一个 Settings 实例（单例模式）
@lru_cache
def get_settings() -> Settings:
    return Settings()
