"""A.2: Phase D feature flag 默认值与 env 覆盖测试。"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_flags_default_false():
    """get_settings() 无 env 时三 flag 均为 False。"""
    # 清掉可能残留的 env，确保读到默认值
    for key in ("AGENT_PLAN_ENABLED", "AGENT_REFLECT_ENABLED", "AGENT_REFLEXION_ENABLED"):
        os.environ.pop(key, None)

    # lru_cache 版本需要绕过缓存直接实例化
    from app.config import Settings
    s = Settings()
    assert s.agent_plan_enabled is False
    assert s.agent_reflect_enabled is False
    assert s.agent_reflexion_enabled is False


def test_flags_env_true(monkeypatch):
    """monkeypatch env 设为 true 后，Settings() 读取为 True。"""
    monkeypatch.setenv("AGENT_PLAN_ENABLED", "true")
    monkeypatch.setenv("AGENT_REFLECT_ENABLED", "1")
    monkeypatch.setenv("AGENT_REFLEXION_ENABLED", "True")

    from app.config import Settings
    s = Settings()
    assert s.agent_plan_enabled is True
    assert s.agent_reflect_enabled is True
    assert s.agent_reflexion_enabled is True


def test_flags_env_false(monkeypatch):
    """monkeypatch env 设为 false/0 后，Settings() 读取为 False。"""
    monkeypatch.setenv("AGENT_PLAN_ENABLED", "false")
    monkeypatch.setenv("AGENT_REFLECT_ENABLED", "0")
    monkeypatch.setenv("AGENT_REFLEXION_ENABLED", "False")

    from app.config import Settings
    s = Settings()
    assert s.agent_plan_enabled is False
    assert s.agent_reflect_enabled is False
    assert s.agent_reflexion_enabled is False
