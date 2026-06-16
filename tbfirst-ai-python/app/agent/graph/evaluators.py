"""Reflection 评估器。

三个公开函数：
  - latest_artifact(state)           → (artifact_str | None, kind_str)
  - evaluate_text_rubric(text, ...)  → (score: float, critique: str)
  - evaluate_image(data_uri, ...)    → (score: float, critique: str)

任何评估器异常均返回容错值（score=1.0, critique=""），绝不上抛到主对话。
"""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 独立 rubric 评估 prompt（文本 / 图像各用各自的）
# ---------------------------------------------------------------------------

_IMAGE_EVAL_PROMPT = """\
你是图像质量评估员。请根据以下品牌规范和创作提示对图像进行评分。

品牌规范：
{basic_rules}

创作提示词：
{prompt}

请从以下维度综合评估图像：
1. 图像内容是否与创作提示匹配
2. 是否符合品牌 DNA 与风格
3. 是否包含禁忌内容或品牌违规

请用 JSON 格式回复（不要添加任何额外内容）：
{{"score": <0.0到1.0的浮点数，1.0为完全符合>, "critique": "<简短评语，不符合时说明原因，符合时为空字符串>"}}
"""

_TEXT_RUBRIC_PROMPT = """\
你是内容质量评估员。请根据以下品牌规范对给定文本进行评分。

品牌规范：
{basic_rules}

待评估文本：
{text}

请用 JSON 格式回复（不要添加任何额外内容）：
{{"score": <0.0到1.0的浮点数，1.0为完全符合>, "critique": "<简短评语，不符合时说明原因，符合时为空字符串>"}}
"""


async def evaluate_text_rubric(
    text: str,
    *,
    basic_rules: str = "",
) -> tuple[float, str]:
    """文本 rubric 评估：对照 basic_rules 与品牌禁忌词，返回 (score 0-1, critique)。

    独立 ChatGoogleGenerativeAI 实例（不绑 ALL_TOOLS）。
    LLM 任何异常 → 返回 (1.0, "")，评估失败默认 accept 不阻断主流程。
    """
    try:
        from app.config import get_settings
        s = get_settings()
        if not s.gemini_api_key:
            return 1.0, ""
        from langchain_google_genai import ChatGoogleGenerativeAI
        llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=s.gemini_api_key,
            temperature=0.0,
        )
        prompt = _TEXT_RUBRIC_PROMPT.format(basic_rules=basic_rules or "（无规范）", text=text)
        resp = await llm.ainvoke(prompt)
        raw = getattr(resp, "content", "") or ""
        if isinstance(raw, list):
            raw = " ".join(str(p) for p in raw)
        raw = raw.strip()
        # 尝试剥掉 markdown 代码块
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw)
        score = float(data.get("score", 1.0))
        critique = str(data.get("critique", ""))
        return max(0.0, min(1.0, score)), critique
    except Exception as e:
        logger.warning("evaluate_text_rubric 失败（容错 accept）: %s", e)
        return 1.0, ""


async def evaluate_image(
    data_uri: str,
    *,
    basic_rules: str = "",
    prompt: str = "",
) -> tuple[float, str]:
    """多模态图像评估：把 data URI 拆为 inline_data part 传给 vision LLM，返回 (score, critique)。

    独立 ChatGoogleGenerativeAI 实例（不绑 ALL_TOOLS）。
    LLM 任何异常 → 返回 (1.0, "")，评估失败默认 accept 不阻断主流程。
    """
    try:
        from app.config import get_settings
        s = get_settings()
        if not s.gemini_api_key:
            return 1.0, ""
        from langchain_google_genai import ChatGoogleGenerativeAI

        # 拆分 data URI → mime_type + base64 data
        # 格式：data:<mime>;base64,<data>
        mime_type = "image/png"
        b64_data = ""
        if data_uri.startswith("data:") and ";base64," in data_uri:
            header, b64_data = data_uri.split(";base64,", 1)
            mime_type = header[5:]  # strip "data:"

        eval_prompt = _IMAGE_EVAL_PROMPT.format(
            basic_rules=basic_rules or "（无规范）",
            prompt=prompt or "（无描述）",
        )
        # LangChain Google GenAI 多模态 inline_data 格式
        message_content = [
            {"type": "text", "text": eval_prompt},
            {
                "type": "image_url",
                "image_url": {"url": data_uri},
            },
        ]
        llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=s.gemini_api_key,
            temperature=0.0,
        )
        from langchain_core.messages import HumanMessage as _HM
        resp = await llm.ainvoke([_HM(content=message_content)])
        raw = getattr(resp, "content", "") or ""
        if isinstance(raw, list):
            raw = " ".join(str(p) for p in raw)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw)
        score = float(data.get("score", 1.0))
        critique = str(data.get("critique", ""))
        return max(0.0, min(1.0, score)), critique
    except Exception as e:
        logger.warning("evaluate_image 失败（容错 accept）: %s", e)
        return 1.0, ""


def latest_artifact(state: dict) -> tuple[str | None, str]:
    """从 messages 倒向扫描，找最近的 ToolMessage 产物。

    - content 含 `data:image/` → kind="image"（图像 data URI）
    - content 为非空字符串且不是 data URI → kind="text"（分镜表等文本）
    - 无匹配 → (None, "")
    """
    msgs: list[Any] = state.get("messages") or []
    for m in reversed(msgs):
        if getattr(m, "type", None) != "tool" and type(m).__name__ != "ToolMessage":
            continue
        content = getattr(m, "content", None)
        if not content:
            continue
        # content 可能是 list（多部分）或 str
        text: str
        if isinstance(content, list):
            # 取第一个 str 部分
            text = next(
                (p if isinstance(p, str) else (p.get("text") or "") for p in content),
                "",
            )
        elif isinstance(content, str):
            text = content
        else:
            text = str(content)
        text = text.strip()
        if not text:
            continue
        if text.startswith("data:image/"):
            return text, "image"
        # 非 data URI 的非空文本产物（分镜表 / Markdown 等）
        return text, "text"
    return None, ""
