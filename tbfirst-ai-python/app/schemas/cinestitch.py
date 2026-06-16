"""分镜向导专用数据模型。

层级：StoryBible（基础脚本）→ Shot（镜头）→ ShotFrame（帧）
所有字段同时支持驼峰（前端直调）和蛇形（Java Feign 转发）两种命名。
"""
from typing import Annotated

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class _Base(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class BibleCharacter(_Base):
    """基础脚本人物条目（角色档案）。"""
    id: str = ""                          # 人物唯一 ID（前端生成，Python 透传）
    name: str                             # 人物名称
    appearance: str | None = None         # 外貌描述（用于出图 prompt 注入）


class BibleScene(_Base):
    """基础脚本场景条目（场景档案）。"""
    id: str = ""                          # 场景唯一 ID
    name: str                             # 场景名称
    location: str | None = None           # 地点描述
    time_of_day: Annotated[
        str | None,
        Field(alias="timeOfDay", validation_alias=AliasChoices("time_of_day", "timeOfDay")),
    ] = None                              # 时段（清晨/黄昏/夜晚等）
    lighting: str | None = None           # 光线描述（用于出图 prompt）


class StoryBible(_Base):
    """基础脚本：包含核心概念、人物、场景和统一视觉风格。"""
    logline: str | None = None            # 一句话故事摘要
    characters: list[BibleCharacter] = [] # 人物列表
    scenes: list[BibleScene] = []         # 场景列表
    style_ref: Annotated[
        str | None,
        Field(alias="styleRef", validation_alias=AliasChoices("style_ref", "styleRef")),
    ] = None                              # 视觉风格参考描述（摄影风格/色调）
    est_shot_count: Annotated[
        int | None,
        Field(alias="estShotCount", validation_alias=AliasChoices("est_shot_count", "estShotCount")),
    ] = None                              # 预估镜头数量（LLM 输出，前端据此预分配列表）


class ShotFrame(_Base):
    """单帧状态（一个镜头可包含多帧，如运动镜头的前/中/后帧）。"""
    frame_index: Annotated[
        int,
        Field(alias="frameIndex", validation_alias=AliasChoices("frame_index", "frameIndex")),
    ]                                     # 帧序号（从 0 开始）
    image_url: Annotated[
        str | None,
        Field(alias="imageUrl", validation_alias=AliasChoices("image_url", "imageUrl")),
    ] = None                              # 该帧的生成图 URL（生图后回填）
    status: str = "idle"                  # 帧状态：idle / generating / done / error


class Shot(_Base):
    """单镜头数据模型，对应分镜表中的一行。"""
    shot_no: Annotated[
        int,
        Field(alias="shotNo", validation_alias=AliasChoices("shot_no", "shotNo")),
    ]                                     # 镜号（从 1 开始）
    scene_id: Annotated[
        str | None,
        Field(alias="sceneId", validation_alias=AliasChoices("scene_id", "sceneId")),
    ] = None                              # 关联的 BibleScene.id
    character_ids: Annotated[
        list[str],
        Field(alias="characterIds", validation_alias=AliasChoices("character_ids", "characterIds")),
    ] = []                                # 出镜人物 ID 列表
    shot_size: Annotated[
        str | None,
        Field(alias="shotSize", validation_alias=AliasChoices("shot_size", "shotSize")),
    ] = None                              # 景别（ECU/CU/MCU/MS/MLS/LS/WS）
    description: str | None = None        # 画面描述（中文）
    scene: str | None = None              # 场景/背景描述
    action: str | None = None             # 模特动作/表情
    camera_movement: Annotated[
        str | None,
        Field(alias="cameraMovement", validation_alias=AliasChoices("camera_movement", "cameraMovement")),
    ] = None                              # 运镜方式（固定/推/拉/摇/移/跟/甩）
    dialogue: str | None = None           # 台词或独白
    duration: str | None = None           # 时长描述（如 "3s"）
    notes: str | None = None              # 导演注记
    motion_type: Annotated[
        str,
        Field(alias="motionType", validation_alias=AliasChoices("motion_type", "motionType")),
    ] = "static"                          # 运动类型：static（静帧）/ motion（运动，需多帧）
    frame_count: Annotated[
        int,
        Field(alias="frameCount", validation_alias=AliasChoices("frame_count", "frameCount")),
    ] = 1                                 # 该镜头需生成的帧数（motion 时 > 1）
    frames: list[ShotFrame] = []          # 已生成的帧列表


class StoryboardDraft(_Base):
    """分镜草稿（Shot 列表），是分镜向导输出的顶层数据结构。"""
    shots: list[Shot] = []
