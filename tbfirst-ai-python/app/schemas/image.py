from typing import Annotated, Any

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class ImageGenerateRequest(BaseModel):
    """生图请求 DTO，同时接受驼峰（前端直调）和蛇形（Java 转发）两种字段名。
    Java 侧 tbfirst-image 通过 Feign 转发此请求，phaseConfig 字段从 JSONB 透传。
    """
    model_config = ConfigDict(populate_by_name=True)
    model: str | None = None             # 首选模型，空时使用降级链默认首位
    prompt: str                          # 生图文本描述
    phase: str = "phase0"                # 生图阶段：phase0/phase1/phase2/phase3
    reference_images: Annotated[
        list[str],
        Field(alias="referenceImages", validation_alias=AliasChoices("reference_images", "referenceImages")),
    ] = []                               # 参考图列表（data URI 或 http(s) URL）
    # 与 reference_images 等长的用户标签，空/缺省 → 后端按位置生成默认 label_map
    reference_labels: Annotated[
        list[str] | None,
        Field(alias="referenceLabels", validation_alias=AliasChoices("reference_labels", "referenceLabels")),
    ] = None
    size: str = "1024x1024"              # 保留字段（当前由 image_size 控制）
    n: int = 1                           # 生成张数（当前 Gemini 只支持 1）
    aspect_ratio: Annotated[
        str,
        Field(alias="aspectRatio", validation_alias=AliasChoices("aspect_ratio", "aspectRatio")),
    ] = "3:4"                            # 宽高比
    image_size: Annotated[
        str,
        Field(alias="imageSize", validation_alias=AliasChoices("image_size", "imageSize")),
    ] = "1K"                             # 图片分辨率挡位（1K/2K/4K）
    phase_config: Annotated[
        dict[str, Any] | None,
        Field(alias="phaseConfig", validation_alias=AliasChoices("phase_config", "phaseConfig")),
    ] = None                             # Java 侧 JSONB 字段透传（phaseConfig），含色彩参数等


class ImageGenerateResponse(BaseModel):
    """生图响应 DTO，包含降级链执行结果供 Java 侧回填 generation_job 表。"""
    urls: list[str] = []                     # 生成的图片 URL 列表（base64 data URI）
    text: str | None = None                  # 文本模型附带的文本输出（Phase0 DNA）
    raw: dict[str, Any] | None = None        # 原始响应（调试用）
    used_fallback: bool = False              # 是否使用了降级模型
    used_model: str | None = None           # 实际使用的模型名（Java 侧据此回填 model 字段）
    attempts: list[dict[str, str]] = []      # 降级链失败记录 [{model, error}, ...]


class InpaintRequest(BaseModel):
    """局部重绘请求。mask_image 为可选，有则走双图路径，无则走单图路径。"""
    masked_image: str                        # 被遮罩的主图（data URI 或 URL）
    prompt: str                              # 重绘描述
    reference_image: str | None = None       # 可选参考图（服装/风格对齐）
    aspect_ratio: str = "3:4"
    model: str | None = None                 # 首选模型
    negative_prompt: str | None = None       # 绝对禁止描述（V5.XVII.2 新增）
    mask_image: str | None = None            # 二值 mask 图（黑=保留，白=重绘）


class InpaintResponse(BaseModel):
    url: str                                 # 重绘后图片 URL
    used_model: str | None = None
    used_fallback: bool = False
