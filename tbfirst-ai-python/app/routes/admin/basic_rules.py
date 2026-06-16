"""V6.M2.A.8: L1 admin CRUD（仅 ADMIN/GROUP_LEADER 可访问；Java gateway JWT 验签 + X-User-Role 透传）。"""
from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field
from app.agent.memory.basic_rules import (
    list_basic_rules,
    upsert_basic_rules,
    soft_delete_basic_rules,
)

router = APIRouter(prefix="/agent/admin/basic-rules", tags=["agent-admin"])


def _require_admin(role: Optional[str]) -> None:
    if not role:
        raise HTTPException(status_code=403, detail="admin or group_leader required")
    roles = {r.strip().upper() for r in role.split(",")}
    if not roles & {"ADMIN", "GROUP_LEADER"}:
        raise HTTPException(status_code=403, detail="admin or group_leader required")


class BasicRuleItem(BaseModel):
    id: int
    scope: str
    scope_ref_id: Optional[int]
    category: str
    body: str
    version: int
    is_active: bool


class UpsertRequest(BaseModel):
    scope: str = Field(..., pattern="^(global|brand|group)$")
    scope_ref_id: Optional[int] = None
    category: str = Field(..., max_length=32)
    body: str = Field(..., min_length=1)


@router.get("", response_model=list[BasicRuleItem])
async def list_basic_rules_route(
    scope: Optional[str] = Query(None),
    scope_ref_id: Optional[int] = Query(None),
    active_only: bool = Query(True),
    x_user_role: Optional[str] = Header(None, alias="X-User-Roles"),
) -> list[BasicRuleItem]:
    _require_admin(x_user_role)
    rows = await list_basic_rules(scope, scope_ref_id, active_only)
    return [BasicRuleItem(**{k: r[k] for k in BasicRuleItem.model_fields}) for r in rows]


@router.post("", response_model=BasicRuleItem)
async def create_basic_rule(
    req: UpsertRequest,
    x_user_id: Optional[int] = Header(None, alias="X-User-Id"),
    x_user_role: Optional[str] = Header(None, alias="X-User-Roles"),
) -> BasicRuleItem:
    _require_admin(x_user_role)
    new_id = await upsert_basic_rules(req.scope, req.scope_ref_id, req.category, req.body, x_user_id)
    rows = await list_basic_rules(req.scope, req.scope_ref_id, active_only=True)
    for r in rows:
        if r["id"] == new_id:
            return BasicRuleItem(**{k: r[k] for k in BasicRuleItem.model_fields})
    raise HTTPException(500, "upsert succeeded but read-back missed")


@router.put("/{basic_rule_id}", response_model=BasicRuleItem)
async def update_basic_rule(
    basic_rule_id: int,
    req: UpsertRequest,
    x_user_id: Optional[int] = Header(None, alias="X-User-Id"),
    x_user_role: Optional[str] = Header(None, alias="X-User-Roles"),
) -> BasicRuleItem:
    """PUT 等价于"基于现有条目新建一个 version，旧 version is_active=FALSE"——保留全部历史。"""
    _require_admin(x_user_role)
    new_id = await upsert_basic_rules(req.scope, req.scope_ref_id, req.category, req.body, x_user_id)
    rows = await list_basic_rules(req.scope, req.scope_ref_id, active_only=True)
    for r in rows:
        if r["id"] == new_id:
            return BasicRuleItem(**{k: r[k] for k in BasicRuleItem.model_fields})
    raise HTTPException(500, "update succeeded but read-back missed")


@router.delete("/{basic_rule_id}", status_code=204)
async def delete_basic_rule(
    basic_rule_id: int,
    x_user_role: Optional[str] = Header(None, alias="X-User-Roles"),
) -> None:
    _require_admin(x_user_role)
    await soft_delete_basic_rules(basic_rule_id)
