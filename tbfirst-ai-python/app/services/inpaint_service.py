import logging

from fastapi import HTTPException

from app.utils.image.uri import decode_image_to_inline
from app.schemas.image import InpaintRequest, InpaintResponse
from app.providers.gemini import GeminiProvider
from app.services.model_chain import image_chain
from app.services.prompt_engine import build_inpaint_prompt

logger = logging.getLogger(__name__)

_gemini = GeminiProvider()
_PRO_PREFERRED = "gemini-3-pro-image-preview"


async def inpaint(req: InpaintRequest) -> InpaintResponse:
    """局部重绘核心业务逻辑：图像解码 → mask 分支 → prompt 构建 → Gemini 调用。"""
    has_mask_image = bool(req.mask_image)
    has_reference = bool(req.reference_image)
    parts: list[dict] = []

    try:
        parts.append(decode_image_to_inline(req.masked_image))
        if has_mask_image:
            parts.append(decode_image_to_inline(req.mask_image))
        if has_reference:
            parts.append(decode_image_to_inline(req.reference_image))
    except ValueError as e:
        logger.error("[Inpaint] decode reference failed: %s", e)
        raise HTTPException(status_code=400, detail=str(e))

    prompt = build_inpaint_prompt(
        req.prompt, has_reference, req.negative_prompt, has_mask_image
    )
    parts.append({"text": prompt})

    preferred = req.model or _PRO_PREFERRED
    models = image_chain(preferred_first=preferred)

    try:
        result = await _gemini.generate_with_fallback(
            parts,
            config={
                "imageConfig": {"aspectRatio": req.aspect_ratio},
                "tools": [{"googleSearch": {}}],
            },
            models=models,
        )
    except Exception as e:
        logger.error("[Inpaint] failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))

    urls = result.get("urls", [])
    if not urls:
        raise HTTPException(status_code=502, detail="Inpainting generation failed.")

    return InpaintResponse(
        url=urls[0],
        used_model=result.get("used_model"),
        used_fallback=result.get("used_fallback", False),
    )
