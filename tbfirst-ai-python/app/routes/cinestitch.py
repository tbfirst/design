import json
import logging
import math
import re
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

from app.utils.image.uri import decode_image_to_inline, decode_video_to_inline
from app.schemas import (
    BibleCharacter,
    BibleScene,
    Shot,
    StoryBible,
    StoryboardDraft,
)


class _Base(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
from app.providers.callxyq import CallxyqVideoProvider
from app.providers.gemini import GeminiProvider
from app.services.model_chain import image_chain, text_chain

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cinestitch", tags=["cinestitch"])
_gemini = GeminiProvider()


# ---- Endpoint request/response schemas ----

class BibleRequest(_Base):
    story_text: str = Field(
        ...,
        alias="storyText",
        validation_alias=AliasChoices("story_text", "storyText"),
    )
    # 输入模式：script=用户脚本 / images=人物参考图 / auto=AI 自由创作
    mode: str | None = Field(
        default=None,
        validation_alias=AliasChoices("mode"),
    )
    # mode=images 时的人物参考图引用（/img/... 短链、http(s) 或 data URI 均可）
    image_refs: list[str] | None = Field(
        default=None,
        alias="imageRefs",
        validation_alias=AliasChoices("image_refs", "imageRefs"),
    )
    model: str | None = None


class DraftRequest(_Base):
    story_text: str = Field(
        ...,
        alias="storyText",
        validation_alias=AliasChoices("story_text", "storyText"),
    )
    pre_production: dict[str, Any] = Field(
        ...,
        alias="preProduction",
        validation_alias=AliasChoices("pre_production", "preProduction"),
    )
    # 服装视觉一致性档案（有则前置注入提示词，令每镜描述贴合该服装）
    consistency_protocol: str | None = Field(
        default=None,
        alias="consistencyProtocol",
        validation_alias=AliasChoices("consistency_protocol", "consistencyProtocol"),
    )
    # 动态脚本（导演意图，需扩写为逐镜画面）；有则作为主动作来源
    dynamic_script: str | None = Field(
        default=None,
        alias="dynamicScript",
        validation_alias=AliasChoices("dynamic_script", "dynamicScript"),
    )
    # 关键帧数 N（= 分镜数 = 宫格数）：有则要求恰好生成 N 个分镜
    grid_count: int | None = Field(
        default=None,
        alias="gridCount",
        validation_alias=AliasChoices("grid_count", "gridCount"),
    )
    model: str | None = None


class FrameRequest(_Base):
    shot_description: str = Field(
        ...,
        alias="shotDescription",
        validation_alias=AliasChoices("shot_description", "shotDescription"),
    )
    frame_index: int = Field(
        ...,
        alias="frameIndex",
        validation_alias=AliasChoices("frame_index", "frameIndex"),
    )
    # 本镜总帧数（用于表达动作完成度 N/M，避免各帧重复）
    frame_total: int = Field(
        default=1,
        alias="frameTotal",
        validation_alias=AliasChoices("frame_total", "frameTotal"),
    )
    motion_type: str = Field(
        default="static",
        alias="motionType",
        validation_alias=AliasChoices("motion_type", "motionType"),
    )
    aspect_ratio: str = Field(
        default="16:9",
        alias="aspectRatio",
        validation_alias=AliasChoices("aspect_ratio", "aspectRatio"),
    )
    # 渲染画质：映射 Gemini imageConfig.imageSize（1K / 2K）
    image_size: str = Field(
        default="1K",
        alias="imageSize",
        validation_alias=AliasChoices("image_size", "imageSize"),
    )
    # 服装参考图（/img/ 短链等）：作为 inline_data 喂入，锁定服装一致性
    garment_refs: list[str] | None = Field(
        default=None,
        alias="garmentRefs",
        validation_alias=AliasChoices("garment_refs", "garmentRefs"),
    )
    # 模特参考图（来自共享模特库）：作为主模特身份锚点喂入，锁定全片人物一致性
    model_refs: list[str] | None = Field(
        default=None,
        alias="modelRefs",
        validation_alias=AliasChoices("model_refs", "modelRefs"),
    )
    # 上一帧画面：作为连贯性锚点，承接朝向/动作进度（同一运动序列的上一帧，或上一镜的结尾帧）
    prev_frame_ref: str | None = Field(
        default=None,
        alias="prevFrameRef",
        validation_alias=AliasChoices("prev_frame_ref", "prevFrameRef"),
    )
    # 上一帧是否同一镜头序列：True=同镜运动帧（紧接），False=上一镜结尾帧（跨镜承接，可变景别）
    prev_same_shot: bool = Field(
        default=True,
        alias="prevSameShot",
        validation_alias=AliasChoices("prev_same_shot", "prevSameShot"),
    )
    consistency_protocol: str | None = Field(
        default=None,
        alias="consistencyProtocol",
        validation_alias=AliasChoices("consistency_protocol", "consistencyProtocol"),
    )
    # 角色动作（用于画面 + 动作标注）
    action: str | None = None
    # 镜头运动（用于画面 + 运镜标注 + 俯视机位示意）
    camera_movement: str | None = Field(
        default=None,
        alias="cameraMovement",
        validation_alias=AliasChoices("camera_movement", "cameraMovement"),
    )
    # 分镜面板标题（如 "FRAME 2"）
    frame_label: str | None = Field(
        default=None,
        alias="frameLabel",
        validation_alias=AliasChoices("frame_label", "frameLabel"),
    )
    model: str | None = None

    # Java 端的可空包装字段(Boolean/Integer/String)未设置时会被 Feign 序列化为 JSON null，
    # 而这些字段在 Python 侧是非 Optional 的，收到 null 会触发 422。这里把 null 兜回默认值。
    @field_validator("frame_total", "image_size", "prev_same_shot", mode="before")
    @classmethod
    def _null_to_default(cls, v: Any, info: Any) -> Any:
        if v is None:
            return {"frame_total": 1, "image_size": "1K", "prev_same_shot": True}[
                info.field_name
            ]
        return v


class FrameResponse(_Base):
    image_data_uri: str = Field(
        alias="imageDataUri",
        validation_alias=AliasChoices("image_data_uri", "imageDataUri"),
    )


class AnalyzeGarmentRequest(_Base):
    # 服装参考图引用（正/反/细节）：/img/ 短链、http(s) 或 data URI
    image_refs: list[str] = Field(
        ...,
        alias="imageRefs",
        validation_alias=AliasChoices("image_refs", "imageRefs"),
    )
    notes: str | None = None
    model: str | None = None


class AnalyzeGarmentResponse(_Base):
    consistency_protocol: str = Field(
        alias="consistencyProtocol",
        validation_alias=AliasChoices("consistency_protocol", "consistencyProtocol"),
    )
    used_model: str | None = Field(
        default=None,
        alias="usedModel",
        validation_alias=AliasChoices("used_model", "usedModel"),
    )


# ---- AI response schemas (JSON schema dict passed to Gemini responseSchema) ----

_BIBLE_SCHEMA = {
    "type": "object",
    "properties": {
        "logline": {"type": "string"},
        "characters": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "appearance": {"type": "string"},
                },
            },
        },
        "scenes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "location": {"type": "string"},
                    "timeOfDay": {"type": "string"},
                    "lighting": {"type": "string"},
                },
            },
        },
        "styleRef": {"type": "string"},
        "estShotCount": {"type": "integer"},
    },
}

_DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "shots": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "shotNo": {"type": "integer"},
                    "sceneId": {"type": "string"},
                    "scene": {"type": "string"},
                    "characterIds": {"type": "array", "items": {"type": "string"}},
                    "shotSize": {"type": "string"},
                    "description": {"type": "string"},
                    "action": {"type": "string"},
                    "cameraMovement": {"type": "string"},
                    "dialogue": {"type": "string"},
                    "duration": {"type": "string"},
                    "notes": {"type": "string"},
                    "motionType": {"type": "string"},
                    "frameCount": {"type": "integer"},
                },
            },
        },
    },
}


def _parse_json_result(raw_text: str, context: str) -> dict:
    """3-level JSON parsing fallback: direct → strip markdown fences → regex {}"""
    # Level 1: direct parse
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        pass

    # Level 2: strip markdown code fences
    stripped = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_text.strip(), flags=re.MULTILINE)
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    # Level 3: regex extract first {...} block
    m = re.search(r"\{.*\}", raw_text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            pass

    logger.error(
        "[Storyboard] %s: all 3 parse levels failed, raw[:200]=%s",
        context, raw_text[:200],
    )
    raise HTTPException(status_code=502, detail=f"{context} AI 返回无效 JSON")


@router.post("/bible", response_model=StoryBible)
async def generate_bible(req: BibleRequest) -> StoryBible:
    mode = (req.mode or "script").strip().lower()
    image_refs = req.image_refs or []
    logger.info(
        "[Storyboard] bible: mode=%s, story_text_len=%d, image_refs=%d, model=%s",
        mode, len(req.story_text), len(image_refs), req.model,
    )
    if not req.story_text.strip():
        raise HTTPException(status_code=422, detail="剧本文本不能为空")

    if mode == "auto":
        head = (
            "你是专业影视制作人与编剧。请自由创作一个适合拍摄短片的完整原创故事，"
            "并据此产出故事大纲。\n\n"
            f"创作主题/方向（可空，空则完全自由发挥）：\n{req.story_text}\n\n"
        )
    elif mode == "images":
        head = (
            "你是专业影视制作人。下方提供了若干人物参考图，请据此构思一个故事并产出故事大纲。\n"
            "**每个角色的 appearance 必须严格贴合参考图中人物的外观特征**"
            "（发型、脸型、体型、服装、气质等），不要凭空捏造与图片不符的外貌。\n\n"
            f"补充文字说明（可空）：\n{req.story_text}\n\n"
        )
    else:  # script（默认）
        head = (
            "你是专业影视制作人。请分析以下剧本/大纲，提取核心故事大纲。\n\n"
            f"剧本内容：\n{req.story_text}\n\n"
        )

    prompt = head + (
        "请返回 JSON 对象，字段说明：\n"
        "- logline: 一句话故事概要\n"
        "- characters: 角色列表，每项含 name（姓名）、appearance（外貌描述）\n"
        "- scenes: 场景列表，每项含 name（场景名）、location（地点）、"
        "timeOfDay（时间段: 日/夜/黄昏/清晨）、lighting（灯光风格）\n"
        "- styleRef: 整体视觉风格参考（可选）\n"
        "- estShotCount: 预估镜头数整数（可选）\n"
        "角色 id 和场景 id 由服务器生成，JSON 中不需要包含。\n"
        "【语言要求】所有字段一律使用简体中文输出——角色姓名用中文名、外貌/场景名/地点/灯光/风格等全部中文，"
        "不要输出英文（timeOfDay 用 日/夜/黄昏/清晨）。"
    )

    # mode=images：把人物参考图作为 inline_data 喂给多模态模型（最多 6 张）
    parts: list[dict[str, Any]] = []
    if mode == "images" and image_refs:
        for ref in image_refs[:6]:
            try:
                inline = decode_image_to_inline(ref)
            except ValueError as e:
                logger.warning("[Storyboard] bible: skip bad image ref %.80s: %s", ref, e)
                continue
            parts.append({"text": "[人物参考图]"})
            parts.append(inline)
    parts.append({"text": prompt})

    contents = [{"role": "user", "parts": parts}]
    config = {"responseMimeType": "application/json", "responseSchema": _BIBLE_SCHEMA}
    chain = text_chain(preferred_first=req.model) if req.model else text_chain()

    try:
        result = await _gemini.generate_text_with_fallback(contents, config=config, models=chain)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[Storyboard] bible AI failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"圣经生成失败: {e}")

    raw_text = result.get("text") or ""
    if not raw_text:
        raise HTTPException(status_code=502, detail="圣经生成返回为空，请重试")

    data = _parse_json_result(raw_text, "bible")

    # Server-side UUID assignment — override any AI-generated ids
    characters = []
    for c in data.get("characters") or []:
        characters.append(BibleCharacter(
            id=str(uuid.uuid4()),
            name=c.get("name", ""),
            appearance=c.get("appearance"),
        ))

    scenes = []
    for s in data.get("scenes") or []:
        scenes.append(BibleScene(
            id=str(uuid.uuid4()),
            name=s.get("name", ""),
            location=s.get("location"),
            time_of_day=s.get("timeOfDay"),
            lighting=s.get("lighting"),
        ))

    return StoryBible(
        logline=data.get("logline"),
        characters=characters,
        scenes=scenes,
        style_ref=data.get("styleRef"),
        est_shot_count=data.get("estShotCount"),
    )


def _strip_fences(text: str) -> str:
    """去掉模型偶发的 ```/```markdown 围栏与首尾空白。"""
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n?", "", t)
        t = re.sub(r"\n?```$", "", t)
    return t.strip()


# 服装保留硬约束（brandgenius 风格中文版）——仅在 garment_refs 存在时注入。
# 语义：把参考图当权威规格 1:1 还原；图优先于任何文字描述，不臆造。
# 取代旧的「AI 文字分析 → consistency_protocol → 注入提示词」做法：服装图本就直传
# 给生成模型，这里只用一段静态硬约束锁定一致性，避免 AI 二次描述与真实图冲突致幻。
GARMENT_LOCK_BLOCK = (
    "【服装保留 · 硬约束（优先级高于任何姿态 / 光线 / 景别 / 文字描述）】\n"
    "- 把上方服装参考图当作【权威规格图】，不是风格灵感；以图中可见像素为唯一依据。\n"
    "- 1:1 还原：廓形、版型、长度、合身度、所有可见缝线与走线。\n"
    "- 1:1 还原：每块衣片的底色（环境光可带来高光 / 阴影，但不得改变底色色相）。\n"
    "- 1:1 还原：印花、图案、刺绣、logo、标签的位置、比例与朝向。\n"
    "- 1:1 还原：五金件（纽扣、拉链、铆钉、扣具）的数量、材质与工艺。\n"
    "- 全图 / 全片必须是【同一套服装】，跨格跨镜不得换色、换料、换款。\n"
    "- 参考图看不清 / 不确定的细节【不要臆造】，按最贴合可见像素的保守方式呈现；"
    "任何文字描述与参考图冲突时，一律以参考图为准。"
)


@router.post("/analyze-garment", response_model=AnalyzeGarmentResponse)
async def analyze_garment(req: AnalyzeGarmentRequest) -> AnalyzeGarmentResponse:
    """[DEPRECATED] 服装视觉一致性档案提取。

    出图链路已改为「服装图直传 + GARMENT_LOCK_BLOCK 硬约束」，不再依赖这段 AI 文字分析
    （AI 二次描述常与真实参考图冲突致幻）。端点保留仅为兼容旧客户端 / 旧存档，前端不再调用。
    """
    logger.info(
        "[Storyboard] analyze-garment: image_refs=%d, model=%s",
        len(req.image_refs), req.model,
    )
    if not req.image_refs:
        raise HTTPException(status_code=422, detail="请至少提供一张服装参考图")

    parts: list[dict[str, Any]] = []
    for ref in req.image_refs[:6]:
        try:
            inline = decode_image_to_inline(ref)
        except ValueError as e:
            logger.warning("[Storyboard] analyze-garment: skip bad ref %.80s: %s", ref, e)
            continue
        parts.append({"text": "[服装参考图 正面/背面/细节]"})
        parts.append(inline)
    if len(parts) == 0:
        raise HTTPException(status_code=422, detail="服装参考图均无法加载，请重试")

    notes = (req.notes or "").strip()
    prompt = (
        "你是资深服装工艺与面料分析师。请基于提供的服装参考图，产出一份"
        "「视觉一致性档案」（Visual Consistency Protocol），用于后续 AI 生图时严格锁定"
        "该服装的外观一致性。\n"
        "用连贯的中文段落描述（不要列表、不要表格、不要标题），覆盖：\n"
        "- 品类与廓形（如 中长款连衣裙、衬衫廓形）\n"
        "- 面料材质（如 高支亚麻、竹节纹理、哑光质感、自然垂坠）\n"
        "- 颜色与色调\n"
        "- 关键结构细节（领型、袖型、门襟、缝线、纽扣、口袋等）\n"
        "- 整体质感与版型特征\n"
        + (f"补充说明：{notes}\n" if notes else "")
        + "只输出这段档案描述本身，不要任何前后缀或解释。"
    )
    parts.append({"text": prompt})

    contents = [{"role": "user", "parts": parts}]
    chain = text_chain(preferred_first=req.model) if req.model else text_chain()

    try:
        result = await _gemini.generate_text_with_fallback(contents, models=chain)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[Storyboard] analyze-garment AI failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"一致性档案提取失败: {e}")

    raw_text = result.get("text") or ""
    if not raw_text.strip():
        raise HTTPException(status_code=502, detail="一致性档案返回为空，请重试")

    return AnalyzeGarmentResponse(
        consistency_protocol=_strip_fences(raw_text),
        used_model=result.get("used_model"),
    )


@router.post("/draft", response_model=StoryboardDraft)
async def generate_draft(req: DraftRequest) -> StoryboardDraft:
    logger.info(
        "[Storyboard] draft: story_text_len=%d, model=%s",
        len(req.story_text), req.model,
    )
    if not req.story_text.strip():
        raise HTTPException(status_code=422, detail="剧本文本不能为空")

    pre_production = req.pre_production
    characters = pre_production.get("characters") or []
    scenes = pre_production.get("scenes") or []
    valid_char_ids: set[str] = {c.get("id") for c in characters if c.get("id")}
    valid_scene_ids: set[str] = {s.get("id") for s in scenes if s.get("id")}

    char_list = "\n".join(
        f"  - id: {c.get('id')}, name: {c.get('name', '')}" for c in characters
    ) or "  （无角色）"
    scene_list = "\n".join(
        f"  - id: {s.get('id')}, name: {s.get('name', '')}" for s in scenes
    ) or "  （无场景）"

    protocol = (req.consistency_protocol or "").strip()
    dynamic = (req.dynamic_script or "").strip()
    protocol_block = (
        "本分镜围绕同一件服装展开，必须严格遵守以下视觉一致性档案"
        "（每个镜头的画面描述都应体现该服装的材质/廓形/颜色/结构特征）：\n"
        f"{protocol}\n\n"
    ) if protocol else ""
    action_block = (
        f"动态脚本（导演意图，需扩写为逐镜画面）：\n{dynamic}\n\n"
        if dynamic else ""
    )

    continuity_block = (
        "【镜头连贯性（最重要，务必遵守）】生成的是一条【连续可剪辑的镜头序列】，不是互不相关的散图：\n"
        "1) 相邻镜头必须自然衔接：默认同一主体、同一场景/空间内推进；通过景别有序变化（如 全景→中景→近景→特写）"
        "和机位有序变化（如 正面→侧面→背面→环绕）来叙事，禁止无理由的大跳切。\n"
        "2) 动作跨镜延续：上一镜结尾的姿态/朝向/动作，是下一镜开头的起点（例：上一镜『开始向右转身』→下一镜『继续转到侧身』→再下一镜『完成至背面』），"
        "整条序列的动作是一个连贯过程，不能各镜动作互相矛盾或方向跳变。\n"
        "3) 场景切换需有明确动机且数量克制；服装/单品展示类应以【同一模特、同一服装、同一空间】的连续展示为主，靠景别与角度推进，而非切到不相干场景。\n"
        "4) 时间与空间保持连续：光线、环境、模特造型在相邻镜头间保持一致，只随剧情需要渐变。\n"
        "5) 按时间顺序排列镜号；description 与 action 要显式体现与前一镜的承接关系。\n\n"
    )
    # 关键帧数 N：要求恰好生成 N 个分镜（每镜对应宫格图的一格）
    grid_n = req.grid_count if (req.grid_count and req.grid_count > 0) else None
    if grid_n:
        count_head = f"你是专业电影分镜师。请根据以下信息，生成一条【连贯的】分镜表，且【必须恰好 {grid_n} 个分镜】（不多不少）。\n\n"
        count_tail = (
            f"\n【数量硬性要求】shots 数组长度必须恰好为 {grid_n}；"
            "若内容不足请合理拆分镜头补足，若过多请合并，最终严格等于该数量。\n"
        )
    else:
        count_head = "你是专业电影分镜师。请根据以下信息，生成一条【连贯的】完整分镜表（最多 40 镜）。\n\n"
        count_tail = ""

    prompt = (
        count_head
        + protocol_block
        + action_block
        + continuity_block
        + f"剧本/补充内容：\n{req.story_text}\n\n"
        f"可用角色（禁止使用白名单外 id）：\n{char_list}\n\n"
        f"可用场景（禁止使用白名单外 id）：\n{scene_list}\n\n"
        "返回 JSON 对象，包含 shots 数组（按时间先后排序），每个 shot 含：\n"
        "- shotNo: 镜号（从 1 开始的整数，按时间顺序递增）\n"
        "- sceneId: 场景 id（必须来自上方白名单，否则填空字符串；相邻镜头尽量沿用同一场景）\n"
        "- scene: 场次（可读场景名/地点，中文短语）\n"
        "- characterIds: 出现角色 id 列表（必须来自上方白名单）\n"
        "- shotSize: 景别（用中文白话填写：大特写 / 特写 / 近景 / 中近景 / 中景 / 中远景 / 远景 / 全景，禁止英文代号）\n"
        "- description: 画面内容（中文，≤100字；体现与上一镜的承接）\n"
        "- action: 角色动作（人物的动作/表情/姿态，中文短句；承接上一镜动作继续推进）\n"
        "- cameraMovement: 镜头运动（固定/推/拉/摇/移/跟/升降/环绕 等）\n"
        "- dialogue: 台词或旁白（无则填空字符串）\n"
        "- duration: 时长（如 \"3.5s\" / \"4秒\"）\n"
        "- notes: 备注（灯光/氛围/音效等提示，无则填空字符串）\n"
        + count_tail
    )
    contents = [{"role": "user", "parts": [{"text": prompt}]}]
    config = {"responseMimeType": "application/json", "responseSchema": _DRAFT_SCHEMA}
    chain = text_chain(preferred_first=req.model) if req.model else text_chain()

    try:
        result = await _gemini.generate_text_with_fallback(contents, config=config, models=chain)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[Storyboard] draft AI failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"分镜表生成失败: {e}")

    raw_text = result.get("text") or ""
    if not raw_text:
        raise HTTPException(status_code=502, detail="分镜表生成返回为空，请重试")

    data = _parse_json_result(raw_text, "draft")

    shots_raw = data.get("shots") or []
    if grid_n and len(shots_raw) > grid_n:
        logger.info(
            "[Storyboard] draft: AI returned %d shots, truncating to gridCount=%d",
            len(shots_raw), grid_n,
        )
        shots_raw = shots_raw[:grid_n]
    elif len(shots_raw) > 40:
        logger.warning(
            "[Storyboard] draft: AI returned %d shots, truncating to 40", len(shots_raw),
        )
        shots_raw = shots_raw[:40]

    shots: list[Shot] = []
    for idx, s in enumerate(shots_raw):
        # Sanitize sceneId — downgrade invalid references to None
        scene_id: str | None = s.get("sceneId") or None
        if scene_id and scene_id not in valid_scene_ids:
            logger.warning(
                "[Storyboard] draft: invalid sceneId %r downgraded to null", scene_id,
            )
            scene_id = None

        # Sanitize characterIds — remove any id not in whitelist
        raw_char_ids: list[str] = s.get("characterIds") or []
        character_ids = [cid for cid in raw_char_ids if cid in valid_char_ids]
        if len(character_ids) < len(raw_char_ids):
            logger.warning(
                "[Storyboard] draft: filtered invalid characterIds %s",
                set(raw_char_ids) - set(character_ids),
            )

        frame_count = min(max(int(s.get("frameCount") or 1), 1), 4)
        shots.append(Shot(
            shot_no=int(s.get("shotNo") or idx + 1),
            scene_id=scene_id,
            scene=s.get("scene"),
            character_ids=character_ids,
            shot_size=s.get("shotSize"),
            description=s.get("description"),
            action=s.get("action"),
            camera_movement=s.get("cameraMovement"),
            dialogue=s.get("dialogue"),
            duration=s.get("duration"),
            notes=s.get("notes"),
            motion_type=s.get("motionType") or "static",
            frame_count=frame_count,
            frames=[],
        ))

    return StoryboardDraft(shots=shots)


@router.post("/generate-frame", response_model=FrameResponse)
async def generate_frame(req: FrameRequest) -> FrameResponse:
    logger.info(
        "[Storyboard] generate-frame: frameIndex=%d, motionType=%s, aspectRatio=%s, model=%s",
        req.frame_index, req.motion_type, req.aspect_ratio, req.model,
    )

    if req.frame_index > 4:
        raise HTTPException(
            status_code=422,
            detail=f"frameIndex 超出限制（最大 4，收到 {req.frame_index}）",
        )

    parts: list[dict[str, Any]] = []
    # 主模特身份锚点先注入（≤2 张），锁定全片人物面部一致性
    for ref in (req.model_refs or [])[:2]:
        try:
            inline = decode_image_to_inline(ref)
        except ValueError as e:
            logger.warning("[Storyboard] generate-frame: skip bad model ref %.80s: %s", ref, e)
            continue
        parts.append({"text": "[主模特身份 — 必须严格克隆该人物的面部结构/五官/发型，全片同一人]"})
        parts.append(inline)
    # 服装参考图作为多模态上下文注入（≤4 张），锁定服装一致性
    for ref in (req.garment_refs or [])[:4]:
        try:
            inline = decode_image_to_inline(ref)
        except ValueError as e:
            logger.warning("[Storyboard] generate-frame: skip bad garment ref %.80s: %s", ref, e)
            continue
        parts.append({"text": "[服装参考图 — 必须严格保持该服装的材质/廓形/颜色/结构]"})
        parts.append(inline)

    # 上一帧（同镜运动帧 或 上一镜结尾帧）：连贯性锚点 —— 承接朝向/动作进度
    has_prev = False
    prev_ref = (req.prev_frame_ref or "").strip()
    if prev_ref:
        prev_tag = (
            "[上一帧画面（同一运动镜头序列）— 必须承接此画面：保持同一人物/服装/场景/机位，"
            "人物朝向与动作【沿同一方向继续推进】到下一瞬间，禁止跳变/反向/换姿势]"
            if req.prev_same_shot else
            "[上一镜结尾画面 — 承接其中人物的朝向/姿态/服装/场景作为本镜起点，"
            "动作从此自然延续，禁止把人物重置成正面或换无关姿势]"
        )
        try:
            parts.append({"text": prev_tag})
            parts.append(decode_image_to_inline(prev_ref))
            has_prev = True
        except ValueError as e:
            logger.warning("[Storyboard] generate-frame: skip bad prev frame ref %.80s: %s", prev_ref, e)

    protocol = (req.consistency_protocol or "").strip()
    action = (req.action or "").strip()
    camera = (req.camera_movement or "").strip()

    # 目标：交给下游视频生成模型的【干净成片画面】。画面里不放任何文字/标注/示意图——
    # 运镜/动作/服饰等信息只作为构图与呈现的依据（影响姿态、取景、服装还原），不绘制成标签。
    prompt_parts = [
        "生成一张【真实摄影质感的电影分镜画面】（photorealistic cinematic film still）："
        "真实人物、真实皮肤与毛孔、真实面料与垂坠、真实场景、电影级自然布光、真实相机景深。"
        "这是要交给视频生成模型的【干净成片画面】，必须是纯净照片本身。"
        "【严禁出现】任何文字 / 标签 / 标题 / FRAME 字样 / 箭头 / 指示线 / 边框 / 分镜格 / "
        "俯视机位示意图 / 水印 / UI 元素；"
        "【严禁风格】插画 / 手绘 / 漫画 / 卡通 / 水彩 / 油画 / 素描 / 3D 渲染 / CG。",
        f"画面内容：{req.shot_description}。",
    ]
    if action:
        prompt_parts.append(f"人物动作与姿态：{action}（自然呈现在画面中，不要任何文字标注）。")
    if camera:
        prompt_parts.append(f"取景 / 机位角度参考：{camera}（据此决定构图与视角，但不要在画面里画出镜头、箭头或示意图）。")
    if has_prev and req.prev_same_shot:
        # 同镜运动序列：紧接上一帧；按 N/M 完成度【明显推进】动作，避免与上一帧重复
        total = max(req.frame_total or 0, req.frame_index)
        prompt_parts.append(
            f"这是运动镜头序列的第 {req.frame_index} 帧 / 共 {total} 帧：在上一帧基础上沿【同一方向、同一连贯动作】"
            f"把动作【明显向前推进】到约 {req.frame_index}/{total} 的完成度"
            "（例：360° 转身共 4 帧 → 第2帧≈转到侧身90°、第3帧≈背面180°、第4帧≈接近完成）。"
            "本帧人物的姿态 / 朝向 / 肢体角度必须与上一帧有【清晰可见的差异】，"
            "这是连续动画里的不同瞬间，【严禁与上一帧重复或几乎相同、严禁原样复制】。"
        )
        prompt_parts.append(
            "【背景完全一致】场景、背景环境、布景与道具、墙面/地面、景深、光线方向与色调"
            "都与上一帧严格相同，背景不得更换、位移或重新生成；变化的只有人物的动作姿态。"
        )
    elif has_prev and not req.prev_same_shot:
        # 跨镜承接：从上一镜结尾的人物状态延续，再按本镜描述/景别呈现（景别/机位可变）
        prompt_parts.append(
            "本镜【承接上一镜】：画面中的人物必须从【上一镜结尾画面】的朝向与姿态自然延续过来"
            "（例如上一镜结尾人物正在向左转身，本镜就从那个朝向继续转 / 继续该动作），"
            "【严禁】把人物重置为正面或换成与上一镜无关的姿势；人物与服装保持一致，"
            "在此基础上再按本镜画面内容呈现（景别 / 机位 / 角度可按本镜需要变化）。"
        )
        prompt_parts.append(
            "【背景保持同一空间】除非本镜画面内容明确指明切换到新场景，否则必须沿用上一镜的"
            "同一场景与背景环境（同一空间、布景、道具、墙面/地面材质、光线方向与色调）；"
            "即便景别/机位变化，背景也应是同一空间的不同取景，禁止跳到无关的新背景。"
        )
    elif req.motion_type == "motion" and req.frame_index > 1:
        prompt_parts.append(
            f"这是运动镜头序列的第 {req.frame_index} 帧，与同序列其他帧的人物 / 服装 / 场景保持连续，"
            "沿同一方向自然推进动作，禁止动作跳变或反向。"
        )

    # 人物身份
    if req.model_refs:
        prompt_parts.append(
            "[主模特身份锁定] 画面中的人物必须是参考图中的主模特——"
            "严格克隆其面部结构、五官比例、发型与气质，所有镜头保持同一人，禁止随机生成其他面孔。"
        )
    # 服装
    if req.garment_refs:
        # 图直传 + 硬约束（图优先于文字）；手填档案仅作从属补充
        prompt_parts.append(GARMENT_LOCK_BLOCK)
        if protocol:
            prompt_parts.append(f"服装补充说明（与参考图冲突以图为准）：{protocol}")
    elif protocol:
        prompt_parts.append(
            f"服装必须严格还原参考服装的材质 / 廓形 / 颜色 / 结构（自然穿着呈现）。视觉一致性档案：{protocol}"
        )

    prompt_parts.append(
        f"画幅 {req.aspect_ratio}。真实人物摄影、电影级布光、构图考究；"
        "输出纯净画面，画面内不得有任何文字、标注、箭头或示意图。"
    )

    parts.append({"text": "\n".join(prompt_parts)})
    config = {"imageConfig": {"aspectRatio": req.aspect_ratio, "imageSize": req.image_size}}
    chain = image_chain(preferred_first=req.model) if req.model else image_chain()

    try:
        result = await _gemini.generate_with_fallback(parts, config=config, models=chain)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[Storyboard] generate-frame failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"分镜图生成失败: {e}")

    urls = result.get("urls") or []
    if not urls:
        logger.error(
            "[Storyboard] generate-frame returned no urls, result=%s", result,
        )
        raise HTTPException(status_code=502, detail="分镜图生成返回为空，请重试")

    return FrameResponse(image_data_uri=urls[0])


# ---- 宫格出图（一次性画整张 N 宫格） ----

_GRID_DIMS: dict[int, tuple[int, int]] = {
    1: (1, 1), 4: (2, 2), 6: (2, 3), 9: (3, 3), 16: (4, 4), 25: (5, 5),
}


def _grid_dims(n: int) -> tuple[int, int]:
    """N → (行数, 列数)。6=2×3 六宫格，其余正方形；未登记的 N 退化为最接近正方形。"""
    if n in _GRID_DIMS:
        return _GRID_DIMS[n]
    side = max(1, math.ceil(math.sqrt(max(1, n))))
    return (side, side)


class GridShot(_Base):
    """宫格中一个小格对应的分镜信息。"""
    description: str | None = None
    action: str | None = None
    camera_movement: str | None = Field(
        default=None,
        alias="cameraMovement",
        validation_alias=AliasChoices("camera_movement", "cameraMovement"),
    )
    shot_size: str | None = Field(
        default=None,
        alias="shotSize",
        validation_alias=AliasChoices("shot_size", "shotSize"),
    )


class GridRequest(_Base):
    # N 个分镜（一格一个），按顺序填入宫格
    shots: list[GridShot] = Field(default_factory=list)
    # 关键帧数 N（= 分镜数 = 宫格数）
    grid_count: int = Field(
        default=1,
        alias="gridCount",
        validation_alias=AliasChoices("grid_count", "gridCount"),
    )
    aspect_ratio: str = Field(
        default="3:4",
        alias="aspectRatio",
        validation_alias=AliasChoices("aspect_ratio", "aspectRatio"),
    )
    image_size: str = Field(
        default="1K",
        alias="imageSize",
        validation_alias=AliasChoices("image_size", "imageSize"),
    )
    garment_refs: list[str] | None = Field(
        default=None,
        alias="garmentRefs",
        validation_alias=AliasChoices("garment_refs", "garmentRefs"),
    )
    model_refs: list[str] | None = Field(
        default=None,
        alias="modelRefs",
        validation_alias=AliasChoices("model_refs", "modelRefs"),
    )
    consistency_protocol: str | None = Field(
        default=None,
        alias="consistencyProtocol",
        validation_alias=AliasChoices("consistency_protocol", "consistencyProtocol"),
    )
    model: str | None = None

    @field_validator("grid_count", "aspect_ratio", "image_size", mode="before")
    @classmethod
    def _null_to_default(cls, v: Any, info: Any) -> Any:
        if v is None:
            return {"grid_count": 1, "aspect_ratio": "3:4", "image_size": "1K"}[
                info.field_name
            ]
        return v


@router.post("/generate-grid", response_model=FrameResponse)
async def generate_grid(req: GridRequest) -> FrameResponse:
    """一次性生成【整张 N 宫格图】：每格一个小图、对应一个分镜，全图同一主模特/服装。"""
    n = req.grid_count if req.grid_count and req.grid_count > 0 else max(1, len(req.shots))
    rows, cols = _grid_dims(n)
    logger.info(
        "[Storyboard] generate-grid: n=%d (%dx%d), shots=%d, aspectRatio=%s, model=%s",
        n, rows, cols, len(req.shots), req.aspect_ratio, req.model,
    )

    parts: list[dict[str, Any]] = []
    for ref in (req.model_refs or [])[:2]:
        try:
            inline = decode_image_to_inline(ref)
        except ValueError as e:
            logger.warning("[Storyboard] generate-grid: skip bad model ref %.80s: %s", ref, e)
            continue
        parts.append({"text": "[主模特身份 — 必须严格克隆该人物的面部结构/五官/发型，整张图所有格同一人]"})
        parts.append(inline)
    for ref in (req.garment_refs or [])[:4]:
        try:
            inline = decode_image_to_inline(ref)
        except ValueError as e:
            logger.warning("[Storyboard] generate-grid: skip bad garment ref %.80s: %s", ref, e)
            continue
        parts.append({"text": "[服装参考图 — 必须严格保持该服装的材质/廓形/颜色/结构，所有格同一套]"})
        parts.append(inline)

    protocol = (req.consistency_protocol or "").strip()

    # 逐格内容
    cell_lines: list[str] = []
    for i in range(n):
        s = req.shots[i] if i < len(req.shots) else None
        desc = (s.description or "").strip() if s else ""
        act = (s.action or "").strip() if s else ""
        cam = (s.camera_movement or "").strip() if s else ""
        size = (s.shot_size or "").strip() if s else ""
        seg = f"第{i + 1}格：画面={desc or '同一主体、同一服装的一个时尚镜头'}"
        if size:
            seg += f"；景别={size}"
        if act:
            seg += f"；动作={act}"
        if cam:
            seg += f"；取景/机位={cam}"
        cell_lines.append(seg)
    cells_block = "\n".join(cell_lines)

    # 计算单格画幅比例（供 AI 参考，避免自行"修正"布局）
    _ar_w, _ar_h = (req.aspect_ratio or "3:4").split(":") if ":" in (req.aspect_ratio or "") else ("3", "4")
    _cell_w = int(_ar_w) * rows
    _cell_h = int(_ar_h) * cols
    _g = math.gcd(_cell_w, _cell_h)
    cell_ar_str = f"{_cell_w // _g}:{_cell_h // _g}"

    prompt_parts = [
        f"【格数硬性约束】整张图必须恰好有 {n} 个等大格子，排成 {rows} 行 × {cols} 列，格数不能多也不能少。"
        f"格子多于或少于 {n} 个均视为错误输出。",
        f"生成【一张】真实摄影质感的图片：整张图是一个 {rows} 行 × {cols} 列的等分宫格拼贴（共 {n} 格）。"
        "每个格子都是一张独立的真实人物时尚大片画面（photorealistic cinematic film still）："
        "真实皮肤与毛孔、真实面料与垂坠、真实场景、电影级自然布光、真实相机景深。",
        f"排布：严格 {rows} 行 × {cols} 列，从左到右、从上到下依次编号 1 到 {n}；"
        f"各格【等大、等高、等宽、紧密相邻、edge-to-edge】，单格画幅比约为 {cell_ar_str}；"
        "格与格之间至多一条极细且统一的白色分隔线，不要留大块空白、不要外边框、不要圆角、不要装订线。",
        f"各格内容（按编号一一对应，共 {n} 格，不要串格、不要遗漏、不要多画）：\n" + cells_block,
        "【全图强一致性】所有格里必须是【同一个主模特】（同一张脸、同一发型，全图同一人）、"
        "穿【同一套服装】（材质/廓形/颜色/结构完全一致）、同一整体视觉风格与调色光线；"
        "格与格之间只允许在景别、动作姿态、机位角度上变化，严禁换人 / 换衣 / 换风格 / 换场景基调。",
        "【严禁出现】任何文字 / 数字 / 序号 / 标签 / 标题 / 箭头 / 指示线 / 水印 / UI 元素；"
        "【严禁风格】插画 / 手绘 / 漫画 / 卡通 / 水彩 / 油画 / 素描 / 3D 渲染 / CG。",
    ]
    if req.garment_refs:
        # 图直传 + 硬约束（图优先于文字）；手填档案仅作从属补充
        prompt_parts.append(GARMENT_LOCK_BLOCK)
        if protocol:
            prompt_parts.append(f"服装补充说明（仅供参考，与参考图冲突一律以图为准）：{protocol}")
    elif protocol:
        # 无参考图但有手填档案：退化为纯文字约束（旧行为兜底）
        prompt_parts.append(f"服装视觉一致性档案（所有格严格遵守）：{protocol}")
    if req.model_refs:
        prompt_parts.append(
            "[主模特身份锁定] 所有格中的人物必须是参考图中的主模特——严格克隆其面部结构、五官比例、"
            "发型与气质，禁止随机生成其它面孔。"
        )
    prompt_parts.append(
        f"整图画幅 {req.aspect_ratio}；输出纯净照片本身，画面内不得有任何文字、标注或示意图。"
    )

    parts.append({"text": "\n".join(prompt_parts)})
    config = {"imageConfig": {"aspectRatio": req.aspect_ratio, "imageSize": req.image_size}}
    chain = image_chain(preferred_first=req.model) if req.model else image_chain()

    try:
        result = await _gemini.generate_with_fallback(parts, config=config, models=chain)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[Storyboard] generate-grid failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"宫格图生成失败: {e}")

    urls = result.get("urls") or []
    if not urls:
        logger.error("[Storyboard] generate-grid returned no urls, result=%s", result)
        raise HTTPException(status_code=502, detail="宫格图生成返回为空，请重试")

    return FrameResponse(image_data_uri=urls[0])


# ============================================================================
# 服装参考图 → Markdown 分镜表（旧版「一键分镜」链路）
# ============================================================================

class CinestitchGenerateRequest(_Base):
    """分镜生成请求。image_url 为必填 GCS 短链，Python 侧用 decode_image_to_inline 拉取。"""
    image_url: str = Field(
        ...,
        alias="imageUrl",
        validation_alias=AliasChoices("image_url", "imageUrl"),
    )
    prompt: str | None = None
    model: str | None = None
    scene_count: int = Field(
        default=6,
        alias="sceneCount",
        validation_alias=AliasChoices("scene_count", "sceneCount"),
        ge=1,
        le=12,
    )


class CinestitchGenerateResponse(_Base):
    """分镜生成响应。markdown 为 Markdown 格式的分镜表格字符串。"""
    markdown: str
    used_model: str | None = Field(
        default=None,
        alias="usedModel",
        validation_alias=AliasChoices("used_model", "usedModel"),
    )


def _build_storyboard_prompt(scene_count: int, user_prompt: str | None) -> str:
    instruction = (
        f"你是专业电影分镜导演。请分析输入的服装参考图，"
        f"生成一份 {scene_count} 幕的中文电影分镜脚本。\n\n"
        "严格按以下 Markdown 表格格式输出，不输出其他内容：\n"
        "| 镜号 | 景别 | 画面描述 | 模特动作与表情 | 场景与灯光 | 服装展示重点 | 导演注记 |\n"
        "|---|---|---|---|---|---|---|\n"
        f"（共 {scene_count} 行数据）\n\n"
        "要求：充分展示服装设计亮点、材质感、廓形细节；每幕视觉风格有差异，避免重复。"
    )
    if user_prompt:
        instruction += f"\n\n导演方向：{user_prompt}"
    return instruction


@router.post("/generate", response_model=CinestitchGenerateResponse)
async def generate(req: CinestitchGenerateRequest) -> CinestitchGenerateResponse:
    logger.info(
        "[Cinestitch] generate: scene_count=%d, model=%s, prompt=%.60s",
        req.scene_count, req.model, req.prompt or "",
    )

    try:
        image_part = decode_image_to_inline(req.image_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"图片加载失败: {e}")

    prompt_text = _build_storyboard_prompt(req.scene_count, req.prompt)
    parts = [
        {"text": "[Reference Image: Garment Reference]"},
        image_part,
        {"text": prompt_text},
    ]

    chain = text_chain(preferred_first=req.model) if req.model else text_chain()
    contents = [{"role": "user", "parts": parts}]
    try:
        result = await _gemini.generate_text_with_fallback(contents, models=chain)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[Cinestitch] generate failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"分镜生成失败: {e}")

    markdown = result.get("text") or ""
    if not markdown:
        logger.error("[Cinestitch] model returned empty text, result=%s", result)
        raise HTTPException(status_code=502, detail="分镜生成返回为空，请重试")
    return CinestitchGenerateResponse(
        markdown=markdown,
        used_model=result.get("used_model"),
    )


# ============================================================================
# Markdown 分镜表 → 逐镜英文视频提示词
# ============================================================================

class VideoPromptsRequest(_Base):
    scenes_markdown: str = Field(
        alias="scenesMarkdown",
        validation_alias=AliasChoices("scenes_markdown", "scenesMarkdown"),
    )
    model: str | None = None


class VideoPromptsResponse(_Base):
    prompts: list[str]
    used_model: str | None = Field(
        default=None,
        alias="usedModel",
        validation_alias=AliasChoices("used_model", "usedModel"),
    )


def _build_video_prompts_prompt(scenes_markdown: str) -> str:
    return (
        "You are a professional video director. Based on the following storyboard table, "
        "generate a concise English video generation prompt (≤30 words) for each scene row.\n\n"
        "Storyboard:\n"
        f"{scenes_markdown}\n\n"
        "Output a JSON array of strings, one prompt per scene, in the same order as the table rows. "
        "Output ONLY the JSON array, no other text."
    )


@router.post("/generate-video-prompts", response_model=VideoPromptsResponse)
async def generate_video_prompts(req: VideoPromptsRequest) -> VideoPromptsResponse:
    logger.info("[Cinestitch] generate-video-prompts: model=%s", req.model)

    prompt_text = _build_video_prompts_prompt(req.scenes_markdown)
    contents = [{"role": "user", "parts": [{"text": prompt_text}]}]
    chain = text_chain(preferred_first=req.model) if req.model else text_chain()
    try:
        result = await _gemini.generate_text_with_fallback(contents, models=chain)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[Cinestitch] generate-video-prompts failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"视频提示词生成失败: {e}")

    raw_text = result.get("text") or ""
    try:
        prompts = json.loads(raw_text)
        if not isinstance(prompts, list):
            raise ValueError("not a list")
    except (json.JSONDecodeError, ValueError):
        m = re.search(r"\[.*\]", raw_text, re.DOTALL)
        if m:
            try:
                prompts = json.loads(m.group())
            except json.JSONDecodeError as e2:
                logger.error("[Cinestitch] generate-video-prompts parse failed: %s", raw_text)
                raise HTTPException(status_code=502, detail=f"提示词解析失败: {e2}")
        else:
            logger.error("[Cinestitch] generate-video-prompts no JSON array: %s", raw_text)
            raise HTTPException(status_code=502, detail="AI 未返回有效提示词数组")

    return VideoPromptsResponse(
        prompts=[str(p) for p in prompts],
        used_model=result.get("used_model"),
    )


# ============================================================================
# 视觉描述 → 单张分镜图（带风格预设）
# ============================================================================

class GenerateShotImageRequest(_Base):
    visual_description: str = Field(
        alias="visualDescription",
        validation_alias=AliasChoices("visual_description", "visualDescription"),
        max_length=2000,
    )
    style_preset: str = Field(
        default="cinematic",
        alias="stylePreset",
        validation_alias=AliasChoices("style_preset", "stylePreset"),
    )
    aspect_ratio: str = Field(
        default="16:9",
        alias="aspectRatio",
        validation_alias=AliasChoices("aspect_ratio", "aspectRatio"),
    )
    model: str | None = None


class GenerateShotImageResponse(_Base):
    image_url: str = Field(
        alias="imageUrl",
        validation_alias=AliasChoices("image_url", "imageUrl"),
    )
    used_model: str | None = Field(
        default=None,
        alias="usedModel",
        validation_alias=AliasChoices("used_model", "usedModel"),
    )


_STYLE_PREFIX = {
    "cinematic": "Cinematic realistic film photography,",
    "comic": "American superhero comic art style,",
    "cyberpunk": "Cyberpunk neon-lit dark sci-fi style,",
    "watercolor": "Soft watercolor illustration style,",
    "sketch": "Clean minimalist line sketch style,",
}


@router.post("/generate-shot-image", response_model=GenerateShotImageResponse)
async def generate_shot_image(req: GenerateShotImageRequest) -> GenerateShotImageResponse:
    logger.info(
        "[Cinestitch] generate-shot-image: style=%s, aspect=%s, model=%s",
        req.style_preset, req.aspect_ratio, req.model,
    )

    prefix = _STYLE_PREFIX.get(req.style_preset, "")
    prompt = (f"{prefix} {req.visual_description}").strip() if prefix else req.visual_description

    parts = [{"text": prompt}]
    config = {"imageConfig": {"aspectRatio": req.aspect_ratio, "imageSize": "1K"}}
    chain = image_chain(preferred_first=req.model) if req.model else image_chain()

    try:
        result = await _gemini.generate_with_fallback(parts, config=config, models=chain)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[Cinestitch] generate-shot-image failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"分镜图生成失败: {e}")

    urls = result.get("urls") or []
    if not urls:
        logger.error("[Cinestitch] generate-shot-image returned no urls, result=%s", result)
        raise HTTPException(status_code=502, detail="分镜图生成返回为空，请重试")

    return GenerateShotImageResponse(
        image_url=urls[0],
        used_model=result.get("used_model"),
    )


# ============================================================================
# 参考视频 → Markdown 分镜表（视频解析）
# ============================================================================

class VideoParseRequest(_Base):
    # http(s) 视频链接（与 video_data_uri 二选一）
    video_url: str | None = Field(
        default=None,
        alias="videoUrl",
        validation_alias=AliasChoices("video_url", "videoUrl"),
    )
    # 上传短视频的 base64 data URI（data:video/...;base64,...），与 video_url 二选一
    video_data_uri: str | None = Field(
        default=None,
        alias="videoDataUri",
        validation_alias=AliasChoices("video_data_uri", "videoDataUri"),
    )
    prompt: str | None = None
    model: str | None = None
    scene_count: int = Field(
        default=6,
        alias="sceneCount",
        validation_alias=AliasChoices("scene_count", "sceneCount"),
        ge=1,
        le=12,
    )


class VideoParseResponse(_Base):
    markdown: str
    used_model: str | None = Field(
        default=None,
        alias="usedModel",
        validation_alias=AliasChoices("used_model", "usedModel"),
    )


def _build_video_parse_prompt(scene_count: int, user_prompt: str | None) -> str:
    instruction = (
        f"你是专业电影分镜导演。请分析输入的参考视频，"
        f"提取并还原其分镜，生成一份恰好 {scene_count} 行的中文电影分镜脚本。\n\n"
        "【输出规则】只输出下方 Markdown 表格（表头 + 分隔行 + 数据行），"
        "严禁在表格前后输出任何问候、说明或注释文字。\n"
        "| 镜头号 | 场次 | 景别 | 画面内容 | 角色动作 | 镜头运动 | 台词/旁白 | 时长 | 备注 |\n"
        "|---|---|---|---|---|---|---|---|---|\n"
        f"（此处填写恰好 {scene_count} 行数据，无其他内容）\n\n"
        "要求：忠实还原视频中各镜头的视角、景别和节奏；充分捕捉服装展示亮点；时长以秒为单位估算。"
    )
    if user_prompt:
        instruction += f"\n\n导演方向：{user_prompt}"
    return instruction


def _extract_table(text: str) -> str:
    """保留以 | 开头的行，丢弃 AI 在表格前后添加的多余文字。"""
    lines = [line for line in text.splitlines() if line.strip().startswith("|")]
    return "\n".join(lines)


@router.post("/parse-video", response_model=VideoParseResponse)
async def parse_video(req: VideoParseRequest) -> VideoParseResponse:
    source = req.video_data_uri or req.video_url
    logger.info(
        "[Cinestitch] parse-video: scene_count=%d, model=%s, source=%s",
        req.scene_count, req.model,
        "dataUri" if req.video_data_uri else (req.video_url or "")[:80],
    )
    if not source:
        raise HTTPException(status_code=422, detail="请提供视频文件或视频链接")

    try:
        video_part = decode_video_to_inline(source)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"视频加载失败: {e}")

    prompt_text = _build_video_parse_prompt(req.scene_count, req.prompt)
    parts = [
        {"text": "[Reference Video: Storyboard Analysis]"},
        video_part,
        {"text": prompt_text},
    ]

    chain = text_chain(preferred_first=req.model) if req.model else text_chain()
    contents = [{"role": "user", "parts": parts}]
    try:
        result = await _gemini.generate_text_with_fallback(contents, models=chain)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[Cinestitch] parse-video failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"视频分镜解析失败: {e}")

    raw = result.get("text") or ""
    if not raw:
        logger.error("[Cinestitch] parse-video returned empty text, result=%s", result)
        raise HTTPException(status_code=502, detail="视频分镜解析返回为空，请重试")
    markdown = _extract_table(raw)
    if not markdown:
        logger.warning("[Cinestitch] parse-video: no table rows found, falling back to raw. raw[:200]=%s", raw[:200])
        markdown = raw
    return VideoParseResponse(
        markdown=markdown,
        used_model=result.get("used_model"),
    )


# ============================================================================
# 剧本/大纲 → 中英双语 Markdown 分镜表（脚本解析）
# ============================================================================

class ScriptParseRequest(_Base):
    script_content: str = Field(
        alias="scriptContent",
        validation_alias=AliasChoices("script_content", "scriptContent"),
        max_length=10000,
    )
    prompt: str | None = None
    model: str | None = None
    scene_count: int = Field(
        default=8,
        alias="sceneCount",
        validation_alias=AliasChoices("scene_count", "sceneCount"),
        ge=1,
        le=20,
    )


class ScriptParseResponse(_Base):
    markdown: str
    used_model: str | None = Field(
        default=None,
        alias="usedModel",
        validation_alias=AliasChoices("used_model", "usedModel"),
    )


def _build_script_parse_prompt(scene_count: int, user_prompt: str | None) -> str:
    instruction = (
        f"你是专业电影分镜导演。请分析以下剧本/大纲，"
        f"生成一份 {scene_count} 幕的中英双语电影分镜脚本。\n\n"
        "严格按以下 Markdown 表格格式输出，不输出其他内容：\n"
        "| 镜号 | 景别 | 角度 | 运镜 | 人物 | 环境/背景 | 动作与台词 | 视觉描述(EN) |\n"
        "|---|---|---|---|---|---|---|---|\n"
        f"（共 {scene_count} 行数据）\n\n"
        "景别可选：ECU/CU/MCU/MS/MLS/LS/WS\n"
        "角度可选：正面/侧面/俯拍/仰拍/鸟瞰/主观视角\n"
        "运镜可选：固定/推/拉/摇/移/跟/甩\n"
        "视觉描述(EN)：≤40词英文，用于图像生成模型（含主体、动作、环境、光线风格）。"
    )
    if user_prompt:
        instruction += f"\n\n导演方向：{user_prompt}"
    return instruction


@router.post("/parse-script", response_model=ScriptParseResponse)
async def parse_script(req: ScriptParseRequest) -> ScriptParseResponse:
    logger.info(
        "[Cinestitch] parse-script: scene_count=%d, model=%s, content_len=%d",
        req.scene_count, req.model, len(req.script_content),
    )

    if not req.script_content.strip():
        raise HTTPException(status_code=422, detail="脚本内容不能为空")

    prompt_text = _build_script_parse_prompt(req.scene_count, req.prompt)
    parts = [
        {"text": prompt_text},
        {"text": req.script_content},
    ]

    chain = text_chain(preferred_first=req.model) if req.model else text_chain()
    contents = [{"role": "user", "parts": parts}]
    try:
        result = await _gemini.generate_text_with_fallback(contents, models=chain)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[Cinestitch] parse-script failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"脚本分镜解析失败: {e}")

    markdown = result.get("text") or ""
    if not markdown:
        logger.error("[Cinestitch] parse-script returned empty text, result=%s", result)
        raise HTTPException(status_code=502, detail="脚本分镜解析返回为空，请重试")
    return ScriptParseResponse(
        markdown=markdown,
        used_model=result.get("used_model"),
    )


# ============================================================================
# Seedance 2.0（callxyq 网关）图/文生视频：异步任务 + 轮询
# ============================================================================

class VideoClipRequest(_Base):
    """Seedance 2.0（callxyq 网关）图/文生视频请求。

    image_data_uris = 参考图列表（排版宫格图 / 故事板 / 分镜表图，最多 9 张，@Image1..@ImageN），
    可空（纯文本生成）。prompt = 由分镜表构建的单条英文提示词，驱动整条连续视频。
    """
    image_data_uris: list[str] | None = Field(
        default=None,
        alias="imageDataUris",
        validation_alias=AliasChoices("image_data_uris", "imageDataUris"),
    )
    prompt: str
    # Seedance 单条视频时长，最长 15s
    duration_seconds: int = Field(
        default=10,
        alias="durationSeconds",
        validation_alias=AliasChoices("duration_seconds", "durationSeconds"),
        ge=1, le=15,
    )
    aspect_ratio: str = Field(
        default="9:16",
        alias="aspectRatio",
        validation_alias=AliasChoices("aspect_ratio", "aspectRatio"),
    )
    resolution: str = Field(
        default="720p",
        validation_alias=AliasChoices("resolution"),
    )
    model: str | None = None


class VideoClipStartResponse(_Base):
    operation_name: str = Field(
        alias="operationName",
        validation_alias=AliasChoices("operation_name", "operationName"),
    )


class PollVideoClipRequest(_Base):
    operation_name: str = Field(
        alias="operationName",
        validation_alias=AliasChoices("operation_name", "operationName"),
    )


class PollVideoClipResponse(_Base):
    done: bool
    video_uri: str | None = Field(
        default=None,
        alias="videoUri",
        validation_alias=AliasChoices("video_uri", "videoUri"),
    )
    error: str | None = None


@router.post("/generate-video-clip", response_model=VideoClipStartResponse)
async def generate_video_clip(req: VideoClipRequest) -> VideoClipStartResponse:
    """启动 Seedance 2.0（callxyq 网关）视频生成任务，返回 task_id 作 operationName 供前端轮询。

    整条故事板合成一条视频：image_data_uri 为整张排版宫格图/故事板（单张参考图），
    prompt 由分镜表构建驱动镜头。
    """
    logger.info(
        "[Storyboard] generate-video-clip: model=%s, seconds=%ds, aspect=%s, resolution=%s, ref_images=%d",
        req.model or "(default)", req.duration_seconds, req.aspect_ratio, req.resolution,
        len(req.image_data_uris or []),
    )
    try:
        operation_name = await CallxyqVideoProvider().create_video_task(
            req.prompt,
            req.image_data_uris,
            model=req.model,
            seconds=req.duration_seconds,
            aspect_ratio=req.aspect_ratio,
            resolution=req.resolution,
        )
    except Exception as e:
        logger.error("[Storyboard] generate-video-clip failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"视频生成启动失败: {e}")
    return VideoClipStartResponse(operation_name=operation_name)


@router.post("/poll-video-clip", response_model=PollVideoClipResponse)
async def poll_video_clip(req: PollVideoClipRequest) -> PollVideoClipResponse:
    """查询 Seedance 视频任务进度，done=True 时包含 videoUri（data:video/mp4;base64）。"""
    try:
        result = await CallxyqVideoProvider().poll_video_task(req.operation_name)
    except Exception as e:
        logger.error("[Storyboard] poll-video-clip failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"轮询视频状态失败: {e}")
    return PollVideoClipResponse(**result)
