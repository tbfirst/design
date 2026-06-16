"""
Gemini Provider — 封装 google-genai SDK 的多模态生成调用。

关键兼容处理（详见 errorConclude）：
  - #9  不使用 types.ImageGenerationConfig（SDK 不存在），改 response_modalities=["IMAGE","TEXT"]
  - #10 请求字段同时接受 camelCase / snake_case（Pydantic AliasChoices，见 schemas.py）
  - #11 tools 必须转为 types.Tool 对象；urlContext 不是标准 tool，用 googleSearch 替代
"""
import asyncio
import base64
import logging
from typing import Any

from app.config import get_settings
from app.providers.base import AbstractProvider
from app.services.model_chain import image_chain, text_chain

logger = logging.getLogger(__name__)


# 可重试错误信号 —— 命中任一 → 切换下一个模型（而不是立刻抛）
_RETRYABLE_SIGNALS = (
    "429", "RESOURCE_EXHAUSTED",             # 配额 / 限流
    "503", "UNAVAILABLE",                    # 服务不可用
    "500", "INTERNAL",                       # 内部错误
    "504", "DEADLINE_EXCEEDED",              # 超时
    # V5.XVII.H：覆盖所有"连接被中间链路 RST / 主机强迫关闭"类错误。原本只有 10060，
    # 实际国内网络在长 prompt（Phase3 重 LUT prompt）下更容易触发 10054（远程主机
    # 强迫关闭）—— 它不被识别为可重试 → 整链直接抛 502 → Java Feign 又重跑一次
    # 满链 → Read timed out 雪崩。把同族错误一并加入。
    "10054",                                 # WinError 远程主机强迫关闭
    "10060",                                 # WinError 连接超时（国内网络 RST 常见）
    "10053",                                 # WinError 软件主动取消
    "ECONNRESET",                            # POSIX 连接重置
    "ECONNABORTED",                          # POSIX 连接中止
    "EPIPE",                                 # POSIX broken pipe
    "404", "NOT_FOUND", "model not found",   # 模型 ID 未开通 / typo
    "SAFETY", "safety_filter",               # 安全阻断（换模型有时能过）
)

_RETRYABLE_CI = (
    "timed out", "timeout", "safety",
    # V5.XVII.H：跨平台兜底，str(e) 在 httpx / google-genai SDK 偶发以英文裸文本
    # 形式抛出，没有标准 errno；用关键子串兜底匹配。
    "connection reset", "connection aborted", "remote host", "broken pipe",
)  # 不区分大小写的匹配


def _is_retryable(err: Exception) -> bool:
    msg = str(err)
    if any(s in msg for s in _RETRYABLE_SIGNALS):
        return True
    low = msg.lower()
    return any(s in low for s in _RETRYABLE_CI)


class GeminiProvider(AbstractProvider):
    def __init__(self) -> None:
        self._settings = get_settings()

    def _client(self):
        from google import genai  # type: ignore
        from google.genai import types  # type: ignore

        if not self._settings.gemini_api_key:
            raise ValueError("GEMINI_API_KEY 未配置")
        # 显式 180s 超时，默认 httpx 行为在国内长 prompt（触发 grounding）时易触发 WinError 10060
        return genai.Client(
            api_key=self._settings.gemini_api_key,
            http_options=types.HttpOptions(timeout=180_000),
        )

    # ------------------------------------------------------------------
    # 文本生成
    # ------------------------------------------------------------------
    async def generate_text(self, model: str, prompt: str, **kwargs: Any) -> dict[str, Any]:
        client = self._client()
        config = kwargs.get("config")
        # V5.XVII.I：SDK generate_content 是同步阻塞调用（最长 30-60s），直接放在
        # async def 里会阻塞整个 uvicorn event loop —— 单线程模式下连 /health 都
        # 响应不了。包到 asyncio.to_thread 让线程池跑，event loop 释放。
        if config:
            resp = await asyncio.to_thread(
                client.models.generate_content, model=model, contents=prompt, config=config,
            )
        else:
            resp = await asyncio.to_thread(
                client.models.generate_content, model=model, contents=prompt,
            )
        return {"text": getattr(resp, "text", None), "raw": str(resp)}

    # ------------------------------------------------------------------
    # 图片生成 (简单版 — 纯文本 prompt)
    # ------------------------------------------------------------------
    async def generate_image(self, model: str, prompt: str, **kwargs: Any) -> dict[str, Any]:
        client = self._client()
        # V5.XVII.I：同 generate_text，wrap 同步 SDK 调用到 thread pool
        resp = await asyncio.to_thread(
            client.models.generate_content, model=model, contents=prompt,
        )
        return self._extract_image_urls(resp)

    # ------------------------------------------------------------------
    # 多模态图片生成 (支持参考图片 + 配置)
    # ------------------------------------------------------------------
    async def generate_with_parts(
        self,
        model: str,
        parts: list[dict[str, Any]],
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        多模态生成 — 接受 parts 数组（文本 + inline_data），
        对应原项目 callAIProxy(model, {parts}, config)
        """
        client = self._client()
        contents = self._build_contents(parts)

        generate_kwargs: dict[str, Any] = {"model": model, "contents": contents}
        if config:
            built = self._build_config(config)
            generate_kwargs.update(built)

        # V5.XVII.I：核心修复点 —— Phase1/2/3 图像生成都走这里。原版同步阻塞
        # generate_content 会卡住 uvicorn event loop 30-60s，导致 Java Feign
        # 等不到响应连环超时 → Tomcat 线程池打爆 → ERR_EMPTY_RESPONSE 雪崩。
        resp = await asyncio.to_thread(client.models.generate_content, **generate_kwargs)
        return self._extract_image_urls(resp)

    # ------------------------------------------------------------------
    # 多模态文本生成 (Copilot 多轮对话)
    # ------------------------------------------------------------------
    async def generate_text_with_parts(
        self,
        model: str,
        contents: list[dict[str, Any]],
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        多轮对话生成 — 接受 contents 数组（含 role + parts）
        """
        client = self._client()

        from google.genai import types  # type: ignore
        built_contents = []
        for msg in contents:
            role = msg.get("role", "user")
            msg_parts = self._build_contents(msg.get("parts", []))
            built_contents.append(types.Content(role=role, parts=msg_parts))

        generate_kwargs: dict[str, Any] = {"model": model, "contents": built_contents}
        if config:
            built = self._build_config(config)
            generate_kwargs.update(built)

        # V5.XVII.I：Copilot chat/inspire 走这里，同样需要 thread pool wrap
        resp = await asyncio.to_thread(client.models.generate_content, **generate_kwargs)
        return {"text": getattr(resp, "text", None), "raw": str(resp)}

    # ------------------------------------------------------------------
    # Fallback 逻辑: 按 models 链依次尝试（429 / 5xx / 404 / 安全阻断 / 瞬态网络均触发下一个）
    # ------------------------------------------------------------------
    async def generate_with_fallback(
        self,
        parts: list[dict[str, Any]],
        config: dict[str, Any] | None = None,
        models: list[str] | None = None,
    ) -> dict[str, Any]:
        """
        依次尝试 models 里的每个模型；可重试错误 → 切下一个；非可重试 → 立即抛。

        返回值新增：
          - used_model:    实际成功的模型 ID（Java 回写 generation_job.model）
          - used_fallback: 是否用过备用（链首失败为 True）
          - attempts:      每次尝试的 {model, error, msg} 列表（msg 截断到 200 字符）
        """
        chain = models or image_chain()
        if not chain:
            raise RuntimeError("generate_with_fallback: empty model chain")

        attempts: list[dict[str, str]] = []
        last_err: Exception | None = None
        for idx, model in enumerate(chain):
            try:
                result = await self.generate_with_parts(model, parts, config)
                result["used_model"] = model
                result["used_fallback"] = idx > 0
                result["attempts"] = attempts
                if idx > 0:
                    logger.info("[Gemini] chain succeeded at %s after %d failure(s)", model, idx)
                return result
            except Exception as e:
                last_err = e
                attempts.append({"model": model, "error": type(e).__name__, "msg": str(e)[:200]})
                if not _is_retryable(e) or idx == len(chain) - 1:
                    logger.error("[Gemini] chain exhausted at %s: %s", model, e)
                    raise
                logger.warning(
                    "[Gemini] %s failed (%s), falling to %s",
                    model, type(e).__name__, chain[idx + 1],
                )
        raise last_err or RuntimeError("generate_with_fallback: empty chain")

    # ------------------------------------------------------------------
    # 文本 / 多轮对话的降级链 —— 逻辑同 image，但循环 generate_text_with_parts
    # ------------------------------------------------------------------
    async def generate_text_with_fallback(
        self,
        contents: list[dict[str, Any]],
        config: dict[str, Any] | None = None,
        models: list[str] | None = None,
    ) -> dict[str, Any]:
        chain = models or text_chain()
        if not chain:
            raise RuntimeError("generate_text_with_fallback: empty model chain")

        attempts: list[dict[str, str]] = []
        last_err: Exception | None = None
        for idx, model in enumerate(chain):
            try:
                result = await self.generate_text_with_parts(model, contents, config)
                result["used_model"] = model
                result["used_fallback"] = idx > 0
                result["attempts"] = attempts
                if idx > 0:
                    logger.info("[Gemini] text chain succeeded at %s after %d failure(s)", model, idx)
                return result
            except Exception as e:
                last_err = e
                attempts.append({"model": model, "error": type(e).__name__, "msg": str(e)[:200]})
                if not _is_retryable(e) or idx == len(chain) - 1:
                    logger.error("[Gemini] text chain exhausted at %s: %s", model, e)
                    raise
                logger.warning(
                    "[Gemini] text %s failed (%s), falling to %s",
                    model, type(e).__name__, chain[idx + 1],
                )
        raise last_err or RuntimeError("generate_text_with_fallback: empty chain")

    # ------------------------------------------------------------------
    # 内部工具方法
    # ------------------------------------------------------------------
    def _build_contents(self, parts: list[dict[str, Any]]) -> list:
        """将 dict parts 转为 Gemini SDK Part 对象"""
        from google.genai import types  # type: ignore

        built: list = []
        for p in parts:
            if "text" in p:
                built.append(types.Part.from_text(text=p["text"]))
            elif "inline_data" in p:
                inline = p["inline_data"]
                raw_data = inline["data"]
                if isinstance(raw_data, str):
                    raw_data = base64.b64decode(raw_data)
                built.append(
                    types.Part.from_bytes(
                        data=raw_data,
                        mime_type=inline.get("mime_type", "image/png"),
                    )
                )
        return built

    def _build_config(self, config: dict[str, Any]) -> dict[str, Any]:
        """构建传给 generate_content 的额外参数"""
        from google.genai import types  # type: ignore

        result: dict[str, Any] = {}
        cfg: dict[str, Any] = {}

        if "systemInstruction" in config:
            cfg["system_instruction"] = config["systemInstruction"]

        # 图片生成模式：启用 response_modalities + 把 aspectRatio/imageSize 真正透传给 SDK
        # 过去的实现只设了 response_modalities，imageConfig 里的 aspectRatio/imageSize 被丢掉，
        # 导致 Gemini 完全按 prompt 语义猜比例（Phase1 的时装 prompt → 恰好 3:4；
        # Phase0 的电商产品 prompt → 变成 16:9 横图），表现就是"Phase0 图框矮扁"。
        if "imageConfig" in config:
            cfg["response_modalities"] = ["IMAGE", "TEXT"]
            ic_in = config["imageConfig"] or {}
            # 兼容两种命名（前端/BFF 过来的是 camelCase，SDK 是 snake_case，但 ImageConfig pydantic 用 alias 接受两者）
            aspect = ic_in.get("aspectRatio") or ic_in.get("aspect_ratio")
            size = ic_in.get("imageSize") or ic_in.get("image_size")
            ic_kwargs: dict[str, Any] = {}
            if aspect:
                ic_kwargs["aspect_ratio"] = aspect
            if size:
                ic_kwargs["image_size"] = size
            if ic_kwargs:
                cfg["image_config"] = types.ImageConfig(**ic_kwargs)

        # tools — 转为 SDK 类型，不认识的跳过
        if "tools" in config:
            sdk_tools = []
            for t in config["tools"]:
                if "googleSearch" in t or "google_search" in t:
                    sdk_tools.append(types.Tool(google_search=types.GoogleSearch()))
                elif "urlContext" in t or "url_context" in t:
                    # urlContext 不是标准 Gemini SDK tool，跳过即可。
                    # 历史版本曾替代为 google_search，但这会让 Copilot chat 触发
                    # grounding，响应时间从 ~3s 暴增到 30s+，在国内网络下叠加
                    # 中间链路 RST 容易出 WinError 10060（见 errorConclude #35）。
                    logger.warning("[Gemini] urlContext tool ignored (not a real SDK tool)")
                else:
                    # 未知 tool 类型，跳过避免 SDK 报错
                    logger.warning("[Gemini] skipping unknown tool: %s", t)
            if sdk_tools:
                cfg["tools"] = sdk_tools

        if "responseMimeType" in config:
            cfg["response_mime_type"] = config["responseMimeType"]

        if "responseSchema" in config:
            cfg["response_schema"] = config["responseSchema"]

        if "temperature" in config:
            cfg["temperature"] = config["temperature"]

        if cfg:
            result["config"] = cfg

        return result

    def _extract_image_urls(self, resp: Any) -> dict[str, Any]:
        """从 Gemini 响应中提取 base64 图片 URL"""
        urls: list[str] = []
        text_parts: list[str] = []
        try:
            for part in resp.candidates[0].content.parts:
                inline = getattr(part, "inline_data", None)
                if inline is not None and getattr(inline, "data", None):
                    b64 = base64.b64encode(inline.data).decode("utf-8")
                    mime = getattr(inline, "mime_type", "image/png")
                    urls.append(f"data:{mime};base64,{b64}")
                text_val = getattr(part, "text", None)
                if text_val:
                    text_parts.append(text_val)
        except Exception as e:
            logger.warning("[Gemini] parse response parts failed: %s", e)
        return {
            "urls": urls,
            "text": "\n".join(text_parts) if text_parts else None,
            "raw": str(resp),
        }
