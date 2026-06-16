from typing import Annotated, Any

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class CopilotChatRequest(BaseModel):
    """Copilot 多轮对话请求。Java 侧 ImageController.copilotChat() 通过 Feign 转发。"""
    model_config = ConfigDict(populate_by_name=True)
    model: str | None = None             # 首选模型（Java 侧会写死一个值顶到链首）
    user_input: Annotated[
        str,
        Field(alias="userInput", validation_alias=AliasChoices("user_input", "userInput")),
    ]                                    # 用户当前输入
    history: list[dict[str, Any]] = []  # 历史对话 [{role, content}, ...]
    context: dict[str, Any] = {}        # 额外业务上下文（品牌 ID、品类等）
    # vision 参考图列表
    reference_images: Annotated[
        list[str],
        Field(alias="referenceImages", validation_alias=AliasChoices("reference_images", "referenceImages")),
    ] = []              # 在反序列化（解析输入数据）时，无论外部传入的 JSON 键名是下划线风格还是小驼峰风格，后端统统接受
    # 每张参考图的角色标签
    # 与 reference_images 等长，可选值 'product' / 'model' / 'inspiration'
    reference_image_roles: Annotated[
        list[str],
        Field(alias="referenceImageRoles", validation_alias=AliasChoices("reference_image_roles", "referenceImageRoles")),
    ] = []


class CopilotChatResponse(BaseModel):
    """Copilot 多轮对话响应，即生成的回复文本"""
    text: str


class CopilotInspireRequest(BaseModel):
    """灵感文案生成请求。注入 recent_inspirations 让 Gemini 显式规避近期重复内容。"""
    model_config = ConfigDict(populate_by_name=True)
    model: str | None = None
    context: dict[str, Any] = {}
    reference_images: Annotated[
        list[str],
        Field(alias="referenceImages", validation_alias=AliasChoices("reference_images", "referenceImages")),
    ] = []
    reference_image_roles: Annotated[
        list[str],
        Field(alias="referenceImageRoles", validation_alias=AliasChoices("reference_image_roles", "referenceImageRoles")),
    ] = []
    # 前端最近 N 条灵感文本，注入 system prompt 让 Gemini 显式避开重复
    recent_inspirations: Annotated[
        list[str],
        Field(alias="recentInspirations", validation_alias=AliasChoices("recent_inspirations", "recentInspirations")),
    ] = []


class CopilotInspireResponse(BaseModel):
    """灵感文案生成响应，即生成的灵感文案"""
    text: str


class BrandAnalyzeRequest(BaseModel):
    """品牌 URL 分析请求：Gemini vision + Google Search 工具调用，输出结构化品牌调性。"""
    url: str              # 品牌官网 URL
    model: str | None = None    # 可以是 str或 None，默认是 None


class BrandAnalyzeResponse(BaseModel):
    """品牌 URL 分析响应：结构化的品牌调性分析结果，供后续文案生成调用使用。"""
    audience: str = ""   # 目标受众描述
    tone: str = ""       # 品牌调性/风格
    remark: str = ""     # 附加备注（材质、价位等）
