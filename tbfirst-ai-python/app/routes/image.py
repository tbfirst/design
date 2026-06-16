import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from app.utils.image.uri import decode_image_to_inline
from app.schemas import ImageGenerateRequest, ImageGenerateResponse
from app.providers.gemini import GeminiProvider
from app.services import cache, singleflight
from app.services.model_chain import dna_chain, image_chain
from app.services.prompt_engine import (
    build_phase0_asset_prompt,
    build_phase0_dna_prompt,
    build_phase1_prompt,
    build_phase2_prompt,
    build_color_prompt,
    build_reference_labels,
    build_phase3_dna_prompt,
    build_phase3_prompt,
    build_garment_attrs_block,
    _normalize_garment_attrs,
)

# Phase0 Asset / Phase2 Color 对质量敏感 → 把 pro 顶到链首；失败仍会按链降级。
_PRO_PREFERRED = "gemini-3-pro-image-preview"

logger = logging.getLogger(__name__)
# V5.XIV.4: Phase3 专有 logger — 把 _phase3_dna / _phase3_generate 的失败摘要从
# 通用日志流里拆出来，便于运维定位「生成失败率高」类反馈的根因（refs 缺失 /
# styleDNA 缺失 / 模型链穷尽 / 解码 timeout）。
_PHASE3_LOG = logging.getLogger("phase3")

router = APIRouter(prefix="/image", tags=["image"])
_gemini = GeminiProvider()


def _decode_data_uri(data_uri: str) -> dict[str, Any]:
    """兼容 data: / http(s):// / 相对路径，统一转成 Gemini inline_data。

    GCS 切换后前端不再 fetch URL（CORS 会挡），改成把 URL 字符串原样透传，
    由本函数（实质是 decode_image_to_inline）在服务器侧拉字节。
    """
    return decode_image_to_inline(data_uri)


@router.post("/generate", response_model=ImageGenerateResponse)
async def generate_image(req: ImageGenerateRequest) -> ImageGenerateResponse:
    # V5.XVII.K.1：移除生图结果的 payload-sha256 全量缓存。
    # 旧实现把 Gemini 一次性随机输出当成确定函数结果缓存 1h，导致用户第一次出错图
    # 再点生图时被命中错图、永远拿不到新结果。生图结果不应缓存；命中率优化交给
    # 1) Phase B 的 DNA 中间产物缓存（确定性高）
    # 2) Phase D 的 singleflight 短时合并（in-flight 90s，不留结果）
    # 3) future.md §11 的语义缓存（v6.M2+）
    logger.info(
        "[Image] generate request: phase=%s, refs=%d, prompt=%.80s, phase_config=%s",
        req.phase,
        len(req.reference_images),
        req.prompt,
        req.phase_config,
    )

    # V5.XVII.K.5：singleflight 合并 in-flight 重复请求。
    # 用户连点 N 下 / StrictMode 双触发 → 后端只跑 1 次 Gemini，其余共享结果。
    # 90s 内完成即 DEL key，不持久化结果；下次点击会作为新请求重生成（错图不再固化）。
    sf_payload = singleflight.normalize_image_payload(req.model_dump())
    sf_key = singleflight.compute_key("image", sf_payload)

    async with singleflight.coalesce(sf_key, ttl=90) as sf:
        if not sf.is_leader and sf.shared_result is not None:
            # follower 拿到 leader 广播
            return ImageGenerateResponse(**sf.shared_result)

        try:
            result = await _dispatch_by_phase(req)
        except ValueError as e:
            logger.error("[Image] ValueError: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))
        except Exception as e:
            logger.error("[Image] generate failed: %s", e, exc_info=True)
            raise HTTPException(status_code=502, detail=str(e))

        resp = ImageGenerateResponse(
            urls=result.get("urls", []),
            text=result.get("text"),
            raw={"summary": "ok"},
            used_fallback=result.get("used_fallback", False),
            used_model=result.get("used_model"),
            attempts=result.get("attempts", []),
        )
        # leader 把结果广播给 follower；fallback 路径 publish 是 no-op，由实现侧保证语义
        if sf.is_leader:
            await sf.publish(resp.model_dump())  # type: ignore[attr-defined]
        return resp


async def _dispatch_by_phase(req: ImageGenerateRequest) -> dict[str, Any]:
    """根据 phase 路由到对应的 prompt 构建器 + 生成方法"""
    phase = req.phase
    pc = req.phase_config or {}
    refs = req.reference_images

    image_config = {"aspectRatio": req.aspect_ratio, "imageSize": req.image_size}

    if phase == "phase0":
        step = pc.get("step", "dna")
        if step == "dna":
            return await _phase0_dna(req, pc, refs)
        else:
            return await _phase0_asset(req, pc, refs, image_config)
    elif phase == "phase1":
        return await _phase1(req, pc, refs, image_config)
    elif phase == "phase2":
        return await _phase2(req, pc, refs, image_config)
    elif phase == "phase2Color":
        return await _phase2_color(req, pc, refs, image_config)
    elif phase == "phase3":
        step = pc.get("step", "dna")
        if step == "dna":
            return await _phase3_dna(req, pc, refs)
        else:
            return await _phase3_generate(req, pc, refs, image_config)
    else:
        # Fallback: 直接发 prompt
        parts: list[dict[str, Any]] = []
        for ref in refs:
            parts.append(_decode_data_uri(ref))
        parts.append({"text": req.prompt})
        return await _gemini.generate_with_fallback(
            parts, config={"imageConfig": image_config}, models=image_chain(),
        )


async def _phase0_dna(
    req: ImageGenerateRequest, pc: dict, refs: list[str]
) -> dict[str, Any]:
    """Phase 0 Step 1 — Visual DNA Extraction

    errorConclude #41 延伸：
    - 三张人台图（Front/Side/Back）逐一用 `[Reference Image: <ViewName>]` 打标，避免 Gemini
      按位置盲猜错配。
    - refs 超过 3 张时，把 index 3+ 视为"结构细节/不同角度的补充图"；若前端通过
      request.reference_labels 提供了用户自定义标签（如 "45° 斜视" / "领口开口" / "面料纹理"），
      优先使用；否则兜底为带序号的 "Detail Reference #N"，保持多图之间互相可辨。
    """
    views = []
    parts: list[dict[str, Any]] = []
    view_names = ["Front View", "Side View", "Back View"]
    user_labels = req.reference_labels or []

    def _pick_user(i: int) -> str | None:
        if i >= len(user_labels):
            return None
        v = user_labels[i]
        if not isinstance(v, str):
            return None
        v = v.strip()
        return v or None

    # V5.XVII.K.2：DNA 提取缓存预查（用户可通过 phase_config.force_refresh 旁路）
    force_refresh = bool(pc.get("force_refresh"))
    cache_prompt = (pc.get("remark") or req.prompt or "") + "||labels=" + ",".join(user_labels)
    ref_sigs = [cache.ref_signature(r) for r in refs]
    if not force_refresh:
        # K.10: cache.py 用同步 redis client，放进 to_thread 避免阻塞 event loop
        cached = await asyncio.to_thread(cache.get_dna, "phase0", ref_sigs, cache_prompt)
        if cached is not None:
            return cached

    for i, ref in enumerate(refs):
        user_lbl = _pick_user(i)
        if user_lbl:
            # 用户自己打了标，优先用它（无论是前三张还是后面的细节图）
            parts.append({"text": f"[Reference Image: {user_lbl}]"})
            if i < len(view_names):
                views.append(user_lbl)
        elif i < len(view_names):
            parts.append({"text": f"[Reference Image: {view_names[i]}]"})
            views.append(view_names[i])
        else:
            # 超过三视图又没打标：兜底序号
            parts.append({"text": f"[Reference Image: Detail Reference #{i - len(view_names) + 1}]"})
        parts.append(_decode_data_uri(ref))

    prompt = build_phase0_dna_prompt(
        views=", ".join(views) if views else "Front View",
        extra_remark=pc.get("remark") or req.prompt,
    )
    parts.append({"text": prompt})
    # DNA 是 vision + structured text，走 DNA 链（默认 flash → 2.5-flash）
    # 使用 generate_with_fallback 而非 text 版本：因为需要把参考图作为 parts 传入（非多轮 role/parts 结构）
    result = await _gemini.generate_with_fallback(parts, models=dna_chain())
    # 仅在成功时写缓存；失败/异常路径（generate_with_fallback 自身会抛）不会到达这里
    # K.10: 同步 redis 调用放 to_thread
    await asyncio.to_thread(cache.put_dna, "phase0", ref_sigs, cache_prompt, result)
    return result


async def _phase0_asset(
    req: ImageGenerateRequest, pc: dict, refs: list[str], image_config: dict
) -> dict[str, Any]:
    """Phase 0 Step 2 — Industrial Asset Reconstruction"""
    view = pc.get("view", "3D_FRONT")
    dna = pc.get("dna", req.prompt)

    ref_index = 0
    reference_context = "Input is Front View. Infer 3D structure."
    if view == "3D_BACK" and len(refs) >= 3:
        ref_index = 2
        reference_context = (
            "Input is DIRECT BACK VIEW reference. Strictly maintain ALL visual design "
            "elements visible in the reference image. faithfully reconstruct any closure "
            "systems, structural cutouts, pattern continuity, or decorative elements exactly "
            "as shown. IMPORTANT: Consult 'Design DNA' for side details (like slits/vents) "
            "that might be hidden or flattened in this back view."
        )
    elif view == "3D_SIDE" and len(refs) >= 2:
        ref_index = 1
        reference_context = "Input is DIRECT SIDE VIEW reference."

    prompt = build_phase0_asset_prompt(dna, view, reference_context, pc)
    # 与 _phase0_dna 保持同样的"图前打标"策略：按 ref_index 回推是哪个视角
    view_label_map = ["Front View", "Side View", "Back View"]
    input_view_label = view_label_map[ref_index] if ref_index < len(view_label_map) else "Front View"
    parts: list[dict[str, Any]] = [
        {"text": f"[Reference Image: {input_view_label}]"},
        _decode_data_uri(refs[ref_index]),
        {"text": prompt},
    ]
    # Phase0 Asset（工业级资产重建）对几何/纹理精度敏感 → pro 优先
    return await _gemini.generate_with_fallback(
        parts,
        config={"imageConfig": image_config},
        models=image_chain(preferred_first=_PRO_PREFERRED),
    )


async def _phase1(
    req: ImageGenerateRequest, pc: dict, refs: list[str], image_config: dict
) -> dict[str, Any]:
    """Phase 1 — Context-aware generation"""
    parts: list[dict[str, Any]] = []
    # 槽位旗标兼容驼峰 / 蛇形；前端不发时按 True 走老逻辑，避免老链路回归。
    has_model_ref = pc.get("hasModelRef")
    if has_model_ref is None:
        has_model_ref = pc.get("has_model_ref", True)
    has_scene_ref = pc.get("hasSceneRef")
    if has_scene_ref is None:
        has_scene_ref = pc.get("has_scene_ref", True)
    # reference_labels 由前端每张图的 ImageTagger 填入；空串 = 走 build_reference_labels 默认位置映射
    labels = build_reference_labels(
        refs, "phase1", req.reference_labels,
        has_model_ref=bool(has_model_ref), has_scene_ref=bool(has_scene_ref),
    )
    for lbl_info in labels:
        idx = lbl_info["index"]
        label = lbl_info["label"]
        if label:
            parts.append({"text": label})
        parts.append(_decode_data_uri(refs[idx]))

    # V5.XVI.14：从 phase_config 提取 garmentAttrs（驼峰 / 蛇形兼容），生成
    # AUTHORITATIVE GARMENT SPEC 段，注入到 GARMENT_PRESERVATION_BLOCK 后方。
    garment_attrs = _normalize_garment_attrs(pc.get("garment_attrs") or pc.get("garmentAttrs"))
    garment_spec_text = build_garment_attrs_block(garment_attrs)
    pc_ext = {**pc, "aspectRatio": req.aspect_ratio or ""}
    prompt = build_phase1_prompt(pc_ext, garment_spec=garment_spec_text)
    parts.append({"text": prompt})
    # V5.XIV.2: 人像写实场景偏好 Pro 顶链首（与 _phase0_asset / _phase2_color /
    # _phase3_generate 一致），Flash 在多参考图人像融合上写实度偏弱。
    return await _gemini.generate_with_fallback(
        parts,
        config={"imageConfig": image_config, "tools": [{"googleSearch": {}}]},
        models=image_chain(preferred_first=_PRO_PREFERRED),
    )


async def _phase2(
    req: ImageGenerateRequest, pc: dict, refs: list[str], image_config: dict
) -> dict[str, Any]:
    """Phase 2 — Refinement"""
    parts: list[dict[str, Any]] = []
    labels = build_reference_labels(refs, "phase2", req.reference_labels)
    for lbl_info in labels:
        idx = lbl_info["index"]
        label = lbl_info["label"]
        if label:
            parts.append({"text": label})
        parts.append(_decode_data_uri(refs[idx]))

    action = pc.get("action", "Maintain original pose")
    # V5.XVI.16：Phase2 同样支持 garmentAttrs
    garment_attrs = _normalize_garment_attrs(pc.get("garment_attrs") or pc.get("garmentAttrs"))
    garment_spec_text = build_garment_attrs_block(garment_attrs)
    pc_ext = {**pc, "aspectRatio": req.aspect_ratio or ""}
    prompt = build_phase2_prompt(action, pc_ext, garment_spec=garment_spec_text)
    parts.append({"text": prompt})
    return await _gemini.generate_with_fallback(
        parts,
        config={"imageConfig": image_config, "tools": [{"googleSearch": {}}]},
        models=image_chain(),
    )


async def _phase2_color(
    req: ImageGenerateRequest, pc: dict, refs: list[str], image_config: dict
) -> dict[str, Any]:
    """Phase 2 Color — Color Lab

    模型链选型：image_chain()（flash 顶链首）
      - 换色任务复杂度低于场景生图；flash 10-30s 即可完成，pro 60-180s 且频繁触发
        Cloudflare Tunnel 100s 超时（HTTP 524）。
      - 失败时仍按链降级：flash → pro → 2.5-flash。
      - 与 phase1/_phase0_asset/_phase3_generate 的 PRO 优先策略不同；换色不依赖
        pro 的几何还原精度，质量可接受。
    """
    parts: list[dict[str, Any]] = []
    if refs:
        parts.append({"text": "This is the Original Image (Base Image) that needs to be modified:"})
        # asyncio.to_thread：_decode_data_uri 内含同步 httpx 拉取 GCS 短链，
        # 直接调用会阻塞 event loop 0-30s，影响并发请求响应能力。
        parts.append(await asyncio.to_thread(_decode_data_uri, refs[0]))

    has_reference = bool(pc.get("referenceImageUrl"))
    if has_reference and len(refs) >= 2:
        parts.append({"text": "This is the Reference Image providing texture and color style:"})
        parts.append(await asyncio.to_thread(_decode_data_uri, refs[1]))

    prompt = build_color_prompt(pc, has_reference)
    parts.append({"text": prompt})
    return await _gemini.generate_with_fallback(
        parts,
        config={"imageConfig": image_config},
        models=image_chain(),
    )


async def _phase3_dna(
    req: ImageGenerateRequest, pc: dict, refs: list[str]
) -> dict[str, Any]:
    """Phase 3 Step 1 —— 灵感图 → 视觉 DNA 提取（影调大师两步流水线的第一步）。

    入参契约：
      - refs[0] = 灵感参考图 data URI（用户在 Phase3 控制面板上传或拖拽进来）；
        多张时仅取第一张，与前端 generateSinglePhase3Image 的单底片语义对齐。
      - pc.step == "dna"（由调用方 `_dispatch_by_phase` 已判定，本函数无需再校验）。

    出参契约：
      - 模型必须返回 RAW JSON（无 markdown fence）：
            {"tags": "k1, k2, ... (12-15)",
             "translation": {"color": "...", "lighting": "...", "texture": "...", "mood": "..."}}
      - 走 `generate_with_fallback` 的 text 通道：JSON 文本落 raw["text"]，Java
        `setRawResponse(raw.get("text"))` 透传给前端 `extractToneDNA` 做 JSON.parse
        （前端兼容 fence/HashMap.toString 兜底，见 geminiService.ts 顶部说明）。

    模型链选型：dna_chain()（默认 flash 顶链首；DNA 是纯 vision→structured text，
    PRO 在这一步性价比低，留给 Step 2 渲染）。
    """
    # V5.XIV.4: 灵感参考图是 DNA 提取的唯一视觉输入，缺失时模型只能瞎猜，
    # 返回的 JSON 必然不合 schema → 前端 JSON.parse 失败 → 整个 Phase3 流程崩。
    # 提前 400 拒绝，把错误归因从「模型不稳定」纠正到「前端少传图」。
    if not refs:
        _PHASE3_LOG.warning("phase3 dna rejected: refs empty")
        raise HTTPException(status_code=400, detail="Phase3 DNA 提取需要灵感参考图")

    # V5.XVII.K.2：DNA 提取缓存预查（用户可通过 phase_config.force_refresh 旁路）
    force_refresh = bool(pc.get("force_refresh"))
    cache_prompt = req.prompt or ""
    ref_sigs = [cache.ref_signature(refs[0])]
    if not force_refresh:
        # K.10: 同 phase0，to_thread 包同步 redis 客户端调用
        cached = await asyncio.to_thread(cache.get_dna, "phase3", ref_sigs, cache_prompt)
        if cached is not None:
            return cached

    parts: list[dict[str, Any]] = []
    parts.append({"text": "[Inspiration Reference Image: Extract visual DNA from this image]"})
    parts.append(_decode_data_uri(refs[0]))
    prompt = build_phase3_dna_prompt()
    parts.append({"text": prompt})
    try:
        result = await _gemini.generate_with_fallback(parts, models=dna_chain())
    except HTTPException:
        raise
    except Exception as e:
        _PHASE3_LOG.exception("phase3 dna failed")
        raise HTTPException(status_code=502, detail=f"Phase3 DNA 提取失败: {e}")
    # K.10: 同步 redis 调用放 to_thread
    await asyncio.to_thread(cache.put_dna, "phase3", ref_sigs, cache_prompt, result)
    return result


async def _phase3_generate(
    req: ImageGenerateRequest, pc: dict, refs: list[str], image_config: dict
) -> dict[str, Any]:
    """Phase 3 Step 2 —— 单底片影调渲染（达芬奇式整体调色，禁改服装本色）。

    入参契约：
      - refs[0] = 用户在 Phase3「待处理底片」队列里选择的底片 data URI；多张时
        前端会拆成 N 次独立调用并发，每次只发一张（与 generateSinglePhase3Image
        单底片语义一一对应）。
      - pc.step == "generate"；其余字段全部透传到 build_phase3_prompt：
            * styleDNA      — Step 1 产出的 12-15 个英文 tag 串
            * intensity     — 0..1 → prompt 内 "Grade intensity %"
            * grain         — bool → 切 "organic 35mm" vs "clean digital"
            * contrast      — Low/Standard/High → prompt "Contrast curve"
            * targetQuality — 1K/2K/4K（与 req.image_size 二者皆可，前者优先）
            * remark        — 用户控制面板"补充描述"，非空时 prompt 顶部插入
                              [P0 USER DIRECTIVE — HIGHEST PRIORITY] 段
                              (覆盖 styleDNA 的默认倾向，是真人调色师导演说明)。
      - 兜底：styleDNA 为空时退回 req.prompt（前端 generateSinglePhase3Image 把
        prompt 字段写成 styleDNA 同值，仅用于 Java @NotBlank 校验）。

    出参契约：
      - 走 `generate_with_fallback` 的图像通道：raw["urls"] = [data URI...]；
        Java persistImages 看到 data: 前缀会落盘到 image/phase3/<uuid>.png。

    模型链选型：image_chain(preferred_first=PRO)
      - 调色对色彩还原 / LUT 精度敏感，PRO 顶链首；失败按链降级到 flash。
      - 用户 4K 选项 + PRO 模型组合，Gemini 单次调用观测到约 30-60s。
        Vite 代理已显式放到 200s（vite.config.ts: PROXY_TIMEOUT_MS）。
    """
    # V5.XIV.4: 严格校验底片与 styleDNA。
    # - refs 缺失 → 没有底片可调色，必败；
    # - styleDNA 与 prompt 同时为空 → prompt_engine 拼出来的指令没有风格描述，
    #   Gemini 等同于「按这张图原样输出」，是 Phase3 失败反馈里另一类高频根因。
    if not refs:
        _PHASE3_LOG.warning("phase3 generate rejected: refs empty")
        raise HTTPException(status_code=400, detail="Phase3 生成需要底片")
    style_dna = (pc.get("styleDNA") or req.prompt or "").strip()
    if not style_dna:
        _PHASE3_LOG.warning("phase3 generate rejected: styleDNA empty")
        raise HTTPException(status_code=400, detail="Phase3 生成缺少 styleDNA")
    parts: list[dict[str, Any]] = []
    # 若前端传来灵感参考图（Step 1 上传的图像），将其作为视觉风格锚点注入，
    # 让 Gemini 可以直接"看到"目标影调，而非仅凭文字 styleDNA 标签推断。
    inspiration_uri = (pc.get("inspirationImage") or "").strip()
    if inspiration_uri:
        parts.append({"text": (
            "[Style Reference: Use this image ONLY to calibrate the target tonal palette — "
            "color cast, luminosity curve, highlight rolloff, shadow depth, grain character. "
            "Do NOT copy subjects, clothing, composition, or any object from it.]"
        )})
        parts.append(_decode_data_uri(inspiration_uri))
    parts.append({"text": "[Base Image: Preserve all structure, composition, and garment albedo]"})
    parts.append(_decode_data_uri(refs[0]))
    # V5.XVI.16：Phase3 也支持 garmentAttrs（虽然 Phase3 主要做整体调色，
    # 但具体规格能进一步压制"把红色染成紫色"这类越界）。
    p3_garment_attrs = _normalize_garment_attrs(pc.get("garment_attrs") or pc.get("garmentAttrs"))
    p3_garment_spec = build_garment_attrs_block(p3_garment_attrs)
    prompt = build_phase3_prompt(
        style_dna=style_dna,
        intensity=float(pc.get("intensity", 0.8)),
        grain=bool(pc.get("grain", True)),
        contrast=str(pc.get("contrast", "Standard")),
        image_size=str(pc.get("targetQuality") or req.image_size or "2K"),
        remark=pc.get("remark"),
        garment_spec=p3_garment_spec,
        has_style_ref=bool(inspiration_uri),
    )
    parts.append({"text": prompt})
    # V5.XVII.H：Phase3 整链失败兜底一次本地重试，与 copilot.py chat/inspire 的 #35
    # 重试逻辑对齐。原因：Phase3 prompt 长（~3KB LUT 指令）+ PRO 模型响应慢（30-60s），
    # 国内网络偶发整链全部 10054/10060，sleep(1) 再跑一遍常能恢复。
    # 不能依赖 Java Feign 重试 —— 它会让累计耗时叠到 read-timeout=600s 以上。
    last_err: Exception | None = None
    for attempt in range(2):
        try:
            return await _gemini.generate_with_fallback(
                parts,
                config={"imageConfig": image_config},
                models=image_chain(preferred_first=_PRO_PREFERRED),
            )
        except HTTPException:
            raise
        except Exception as e:
            last_err = e
            msg = str(e).lower()
            is_transient = (
                "10054" in msg or "10060" in msg or "10053" in msg
                or "econnreset" in msg or "econnaborted" in msg
                or "connection reset" in msg or "remote host" in msg
                or "timed out" in msg or "timeout" in msg
            )
            if attempt == 0 and is_transient:
                _PHASE3_LOG.warning("[Phase3] transient failure, retrying once: %s", e)
                await asyncio.sleep(1)
                continue
            break

    _PHASE3_LOG.exception("phase3 generate failed", exc_info=last_err)
    raise HTTPException(status_code=502, detail=f"Phase3 渲染失败: {last_err}")
