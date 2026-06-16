"""
Copilot 路由 —— AI 提示词助手 + 品牌 URL 分析。

上游由 tbfirst-image 通过 Feign 调用，非用户直接调。

端点：
  POST /copilot/chat           多轮对话，支持图文混排参考图
  POST /copilot/analyze-brand  输入品牌官网 URL，用 Gemini + googleSearch 返回
                               audience / tone / remark 三字段（JSON Schema 约束）
"""
import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException

from app.schemas import (
    BrandAnalyzeRequest,
    BrandAnalyzeResponse,
    CopilotChatRequest,
    CopilotChatResponse,
    CopilotInspireRequest,
    CopilotInspireResponse,
)
from app.utils.image.uri import decode_image_to_inline
from app.providers.gemini import GeminiProvider
from app.services.model_chain import text_chain
from app.services.prompt_engine import (
    build_brand_analyze,
    build_copilot_inspire,
    build_copilot_system,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/copilot", tags=["copilot"])
_gemini = GeminiProvider()


_ROLE_LABEL_CN = {
    "product": "产品图（这是本次的主商品 / 主服装本体）",
    "model": "模特参考图（仅作姿态 / 身材 / 肤色参考，并不是主商品）",
    "inspiration": "Phase3 灵感参考图（用于提取视觉 DNA，不是主商品）",
}


def _build_image_role_block(roles: list[str], total: int) -> str:
    """
    V5.XVII.D：基于前端下发的 roles，给 Gemini 逐张图打位置标签。
    roles 短于 images 时尾部按 unknown 兜底；缺省时返回空串（走旧路径）。
    """
    if not total:
        return ""
    if not roles:
        return ""
    lines: list[str] = []
    for i in range(total):
        role = roles[i] if i < len(roles) else "unknown"
        label = _ROLE_LABEL_CN.get(role, "未知用途参考图")
        lines.append(f"      - 第{i + 1}张：{label}")
    return "本次共上传 {n} 张参考图，按 inline_data 顺序对应如下：\n{lines}".format(
        n=total, lines="\n".join(lines),
    )


_PHASE_ANCHOR_HINT = {
    0: "Phase 0（起点）—— 还在装配资产阶段，灵感 / 建议应面向后续 Phase1/2/3 的种子。",
    1: "Phase 1（场景 / 构图 / 景别 / 色调）—— 主体是【产品本身】，灵感应聚焦在如何把主商品放进场景，"
       "不要把模特参考图当作主商品。",
    2: "Phase 2（模特动作 / 表情 / 手势）—— 主体是【穿着主商品的模特】，灵感应聚焦在模特如何动作，"
       "服装就是上一阶段已识别出的主商品。",
    3: "Phase 3（影调大师 / LUT 调色）—— 不改变主商品本色，仅调整光与色，灵感应聚焦在整体调色风格。",
}


def _phase_anchor_header(active_phase: int) -> str:
    hint = _PHASE_ANCHOR_HINT.get(active_phase, _PHASE_ANCHOR_HINT[0])
    return (
        f"【当前阶段：Phase {active_phase}】(本次回复唯一适用阶段)\n"
        f"  - {hint}\n"
        f"  - 历史消息里若出现别的 Phase 讨论，仅作背景，本次输出必须严格按 Phase {active_phase} 视角。"
    )


@router.post("/chat", response_model=CopilotChatResponse)
async def chat(req: CopilotChatRequest) -> CopilotChatResponse:
    # 把参考图数量塞进 context 的临时字段，供 build_copilot_system 的
    # "已知素材清单" 复用（避免 Python 侧再从 context.inputs 里猜字段名）
    ctx = dict(req.context or {})
    ctx["_referenceImageCount"] = len(req.reference_images)
    ctx["_referenceImageRoles"] = list(req.reference_image_roles or [])
    system_instruction = build_copilot_system(ctx)

    active_phase = int(ctx.get("activePhase", 0) or 0)

    # 构建 Parts（图文混排）
    # 防御：前端偶发会传非 data URI 字符串（如 http URL 或空串），此处跳过而不是 500
    # 与 inspire 路由 :153-156 的处理对齐
    user_parts: list[dict] = []
    valid_count = 0
    for ref in req.reference_images:
        try:
            comma = ref.index(",")
        except (ValueError, AttributeError):
            logger.warning("[Copilot] chat skip non-data-uri reference: %r", ref[:40] if isinstance(ref, str) else ref)
            continue
        meta = ref[:comma]
        b64 = ref[comma + 1 :]
        mime = meta.replace("data:", "").replace(";base64", "")
        user_parts.append({"inline_data": {"mime_type": mime, "data": b64}})
        valid_count += 1

    # V5.XVII.D：anchor 首行强提示当前 Phase + 逐张图打标签，
    # 避免历史消息把模型拉到别的 Phase；也避免模特图被误识为主商品。
    anchor_lines = [_phase_anchor_header(active_phase)]
    role_block = _build_image_role_block(list(req.reference_image_roles or []), valid_count)
    if role_block:
        anchor_lines.append(role_block)
    if req.user_input and req.user_input.strip():
        anchor_lines.append(f"用户输入：\n{req.user_input.strip()}")
    user_parts.append({"text": "\n\n".join(anchor_lines)})

    # 构建对话历史
    contents = [
        {"role": m.get("role", "user"), "parts": [{"text": m.get("text", "")}]}
        for m in req.history
    ]
    contents.append({"role": "user", "parts": user_parts})

    config: dict = {"systemInstruction": system_instruction}
    # 防御 None：前端若显式传 {"brand": null}，.get("brand", {}) 会返回 None 而不是默认 {}，
    # 后续 brand.get("url") 就会 AttributeError → FastAPI 500（曾是 Copilot 500 报错根因）
    brand = req.context.get("brand") or {}
    if isinstance(brand, dict) and brand.get("url"):
        # errorConclude #11：Gemini 工具字段名是 google_search（蛇形），"urlContext" 不存在
        config["tools"] = [{"google_search": {}}]

    # 链路降级 —— req.model 若前端显式传入，视为本次首选插入链首；
    # 否则走 TEXT_CHAIN 默认（flash-3.1 → 2.5-flash）。
    # 外层再套一次 10060 重试：国内网络下长 prompt 偶发 WinError 10060，中间链路 RST 掉空闲连接，
    # 整条链都失败后 sleep(1) 重跑一遍往往能恢复（见 errorConclude #35）。
    models = text_chain(preferred_first=req.model)
    last_err: Exception | None = None
    for attempt in range(2):
        try:
            result = await _gemini.generate_text_with_fallback(contents, config, models=models)
            return CopilotChatResponse(text=result.get("text") or "抱歉，我无法生成回复。")
        except Exception as e:
            last_err = e
            msg = str(e).lower()
            is_transient = "10060" in msg or "timed out" in msg or "timeout" in msg
            if attempt == 0 and is_transient:
                logger.warning("[Copilot] chat transient failure, retrying: %s", e)
                await asyncio.sleep(1)
                continue
            break

    # exc_info=True 打完整 traceback，便于排查根因（以前只 str(last_err) 看不到堆栈）
    logger.error("[Copilot] chat failed: %s", last_err, exc_info=last_err)
    raise HTTPException(status_code=502, detail=str(last_err))


@router.post("/analyze-brand", response_model=BrandAnalyzeResponse)
async def analyze_brand(req: BrandAnalyzeRequest) -> BrandAnalyzeResponse:
    system_instruction = build_brand_analyze()
    contents = [
        {"role": "user", "parts": [{"text": f"请分析这个网站：{req.url}"}]}
    ]
    config = {
        "systemInstruction": system_instruction,
        "tools": [{"urlContext": {}}],
        "responseMimeType": "application/json",
        "responseSchema": {
            "type": "OBJECT",
            "properties": {
                # JSON Schema 的 description 关键字（给模型看的字段说明），不要改成 remark
                "audience": {"type": "STRING", "description": "目标受众描述"},
                "tone": {"type": "STRING", "description": "品牌调性关键词"},
                "remark": {"type": "STRING", "description": "核心视觉风格与品牌故事总结"},
            },
            "required": ["audience", "tone", "remark"],
        },
    }

    try:
        result = await _gemini.generate_text_with_fallback(
            contents, config, models=text_chain(preferred_first=req.model),
        )
    except Exception as e:
        logger.error("[Copilot] brand analysis failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))

    text = result.get("text") or ""
    cleaned = text.replace("```json\n", "").replace("\n```", "").strip()
    try:
        parsed = json.loads(cleaned or "{}")
        return BrandAnalyzeResponse(
            audience=parsed.get("audience", ""),
            tone=parsed.get("tone", ""),
            remark=parsed.get("remark", ""),
        )
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="分析超时或数据格式异常，请重试")


@router.post("/inspire", response_model=CopilotInspireResponse)
async def inspire(req: CopilotInspireRequest) -> CopilotInspireResponse:
    """
    灵感按钮 —— 无用户输入，基于当前工作台素材/选项/品牌随机生成一条
    简短 Prompt 灵感（≤60 字中文）。

    前端点💡按钮调用，模型默认复用 chat 的 gemini-3-flash-preview。
    temperature 调高 (0.95) 以便多次点击产生差异明显的结果。

    同样套用 #35 的 10060 一次性重试逻辑。
    """
    ctx = dict(req.context or {})
    ctx["_referenceImageCount"] = len(req.reference_images)
    ctx["_referenceImageRoles"] = list(req.reference_image_roles or [])
    ctx["_recentInspirations"] = list(req.recent_inspirations or [])

    system_instruction = build_copilot_inspire(ctx)
    active_phase = int(ctx.get("activePhase", 0) or 0)

    # 灵感生成也把参考图喂给模型，让它能看到真实素材
    # V5.XVIII: 改用 decode_image_to_inline，支持 data:、http(s):// 和短链 URL；
    #            旧代码 ref.index(",") 只能处理 data: 格式，短链 URL 全被 continue 跳过
    #            导致模型实际收不到图片、服装描述无法与上传图关联。
    user_parts: list[dict] = []
    valid_count = 0
    for ref in req.reference_images:
        try:
            part = await asyncio.to_thread(decode_image_to_inline, ref)
            user_parts.append(part)
            valid_count += 1
        except Exception as e:
            logger.warning("[Copilot] inspire: skip image (decode failed): %s", e)
            continue

    # V5.XVII.D: anchor 重排 ——
    #   1) 首行强声明当前 Phase（消除 chat 历史污染 / 跨 Phase 漂移）
    #   2) 紧跟逐张图位置标签（消除"商品 / 模特 / 灵感图"笼统措辞带来的歧义）
    #   3) 再叠加品类识别要求 + 最近灵感去重
    anchor_lines = [_phase_anchor_header(active_phase)]
    role_block = _build_image_role_block(list(req.reference_image_roles or []), valid_count)
    if role_block:
        anchor_lines.append(role_block)
    if req.reference_images:
        anchor_lines.append(
            "请基于【产品图】（如上方标注）观察主商品的真实类型与材质"
            "（例如：亚麻衬衫 / 针织羊毛衫 / 真丝连衣裙 / 牛仔外套 / 棉麻长裤），"
            "灵感必须与该主商品相符。严禁把模特参考图里的衣服当作本次主商品；"
            "严禁臆造为图中不存在的品类。"
        )
    if req.recent_inspirations:
        recent_block = "\n".join(f"- {r}" for r in req.recent_inspirations[-8:])
        anchor_lines.append(
            "以下是同会话最近已生成的灵感，本次必须与它们在场景 / 光线 / 动作 / 关键词上"
            "明显不同（不要换汤不换药地复用同一场景或光影）：\n" + recent_block
        )
    user_parts.append({"text": "\n\n".join(anchor_lines)})

    contents = [{"role": "user", "parts": user_parts}]
    config: dict = {
        "systemInstruction": system_instruction,
        "temperature": 0.95,
    }

    models = text_chain(preferred_first=req.model)
    last_err: Exception | None = None
    for attempt in range(2):
        try:
            result = await _gemini.generate_text_with_fallback(contents, config, models=models)
            text = (result.get("text") or "").strip()
            # 防御性清洗：去掉偶发的 markdown 代码块 / 引号包裹
            if text.startswith("```"):
                text = text.strip("`").strip()
                if text.lower().startswith("prompt"):
                    text = text[len("prompt"):].lstrip("\n :：")
            text = text.strip('"').strip("'").strip("「」").strip("『』").strip()
            return CopilotInspireResponse(text=text or "在清晨薄雾的海边，模特轻跃起身，裙摆被风带起。")
        except Exception as e:
            last_err = e
            msg = str(e).lower()
            is_transient = "10060" in msg or "timed out" in msg or "timeout" in msg
            if attempt == 0 and is_transient:
                logger.warning("[Copilot] inspire transient failure, retrying: %s", e)
                await asyncio.sleep(1)
                continue
            break

    logger.error("[Copilot] inspire failed: %s", last_err, exc_info=last_err)
    raise HTTPException(status_code=502, detail=str(last_err))
