"""B.2 / B.3 / B.4: evaluators.py 测试。"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage  # noqa: E402

from app.agent.graph.evaluators import evaluate_image, evaluate_text_rubric, latest_artifact  # noqa: E402


def run(coro):
    return asyncio.run(coro)

# ---------------------------------------------------------------------------
# B.2: latest_artifact
# ---------------------------------------------------------------------------


def _image_tool_msg(data_uri: str = "data:image/png;base64,abc123") -> ToolMessage:
    return ToolMessage(content=data_uri, tool_call_id="tc_img")


def _text_tool_msg(text: str = "| 镜头 | 描述 |\n|---|---|\n| 1 | 开场 |") -> ToolMessage:
    return ToolMessage(content=text, tool_call_id="tc_text")


def test_latest_artifact_image():
    """含 image_gen ToolMessage 的 messages → 返回 data URI + 'image'。"""
    state = {
        "messages": [
            HumanMessage(content="生成一张图"),
            AIMessage(content="", tool_calls=[{"id": "tc_img", "name": "image_gen", "args": {}}]),
            _image_tool_msg(),
        ]
    }
    artifact, kind = latest_artifact(state)
    assert kind == "image"
    assert artifact is not None
    assert artifact.startswith("data:image/")


def test_latest_artifact_text():
    """含分镜表文本的 ToolMessage → 返回文本 + 'text'。"""
    state = {
        "messages": [
            HumanMessage(content="生成分镜"),
            AIMessage(content="", tool_calls=[{"id": "tc_text", "name": "storyboard", "args": {}}]),
            _text_tool_msg(),
        ]
    }
    artifact, kind = latest_artifact(state)
    assert kind == "text"
    assert artifact is not None
    assert len(artifact) > 0


def test_latest_artifact_pure_conversation():
    """纯对话（无 ToolMessage）→ (None, '')。"""
    state = {
        "messages": [
            HumanMessage(content="你好"),
            AIMessage(content="你好！有什么可以帮你的？"),
        ]
    }
    artifact, kind = latest_artifact(state)
    assert artifact is None
    assert kind == ""


def test_latest_artifact_empty_messages():
    """空 messages → (None, '')。"""
    artifact, kind = latest_artifact({"messages": []})
    assert artifact is None
    assert kind == ""


def test_latest_artifact_returns_most_recent():
    """多条 ToolMessage 时，返回最近一条（倒向扫描）。"""
    state = {
        "messages": [
            HumanMessage(content="先生成文本"),
            _text_tool_msg("旧文本"),
            HumanMessage(content="再生成图"),
            _image_tool_msg("data:image/jpeg;base64,xyz"),
        ]
    }
    artifact, kind = latest_artifact(state)
    assert kind == "image"  # 最近的是图片
    assert "jpeg" in artifact


# ---------------------------------------------------------------------------
# B.3: evaluate_text_rubric
# ---------------------------------------------------------------------------


class _FakeLLMResp:
    def __init__(self, content: str):
        self.content = content


class _FakeLLM:
    def __init__(self, content: str):
        self._content = content

    async def ainvoke(self, prompt: str):
        return _FakeLLMResp(self._content)


def _patch_llm_and_settings(monkeypatch, fake_ainvoke):
    """辅助：用 sys.modules 注入假 langchain_google_genai，并 patch get_settings。"""
    import sys
    from app.config import Settings

    fake_settings = Settings.model_construct(gemini_api_key="fake-key")
    monkeypatch.setattr("app.config.get_settings", lambda: fake_settings)
    # 清掉 lru_cache（如果有）
    try:
        from app.config import get_settings as _gs
        _gs.cache_clear()
    except AttributeError:
        pass

    class _FakeGoogleGenai:
        class ChatGoogleGenerativeAI:
            def __init__(self, **kw):
                pass
            async def ainvoke(self, prompt):
                return await fake_ainvoke(prompt)

    monkeypatch.setitem(sys.modules, "langchain_google_genai", _FakeGoogleGenai())


def test_evaluate_text_rubric_parses_score_and_critique(monkeypatch):
    """monkeypatch LLM → 解析出 score/critique。"""
    async def fake_invoke(prompt):
        return _FakeLLMResp('{"score": 0.75, "critique": "色调偏暗"}')

    _patch_llm_and_settings(monkeypatch, fake_invoke)
    score, critique = run(evaluate_text_rubric("测试文本", basic_rules="不得含有暴力内容"))
    assert score == 0.75
    assert critique == "色调偏暗"


def test_evaluate_text_rubric_exception_returns_accept(monkeypatch):
    """LLM 抛异常 → 容错返回 (1.0, '')。"""
    async def raise_invoke(prompt):
        raise RuntimeError("LLM 调用失败")

    _patch_llm_and_settings(monkeypatch, raise_invoke)
    score, critique = run(evaluate_text_rubric("测试文本", basic_rules="规范"))
    assert score == 1.0
    assert critique == ""


# ---------------------------------------------------------------------------
# B.4: evaluate_image
# ---------------------------------------------------------------------------


def test_evaluate_image_parses_score_and_critique(monkeypatch):
    """monkeypatch LLM → 解析出 score/critique。"""
    async def fake_invoke(msgs):
        return _FakeLLMResp('{"score": 0.6, "critique": "主体模糊"}')

    _patch_llm_and_settings(monkeypatch, fake_invoke)
    score, critique = run(
        evaluate_image(
            "data:image/png;base64,abc123",
            basic_rules="品牌规范",
            prompt="生成一个红色苹果",
        )
    )
    assert score == 0.6
    assert critique == "主体模糊"


def test_evaluate_image_exception_returns_accept(monkeypatch):
    """LLM 抛异常 → 容错返回 (1.0, '')。"""
    async def raise_invoke(msgs):
        raise RuntimeError("视觉评估失败")

    _patch_llm_and_settings(monkeypatch, raise_invoke)
    score, critique = run(
        evaluate_image("data:image/png;base64,abc", basic_rules="规范", prompt="提示词")
    )
    assert score == 1.0
    assert critique == ""
