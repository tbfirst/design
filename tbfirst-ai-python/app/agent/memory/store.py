"""PgvectorStore — LangGraph BaseStore 的薄 wrapper。"""
from __future__ import annotations
from typing import Any, Optional, Sequence
import psycopg
from psycopg.rows import dict_row
from langgraph.store.base import BaseStore, Item
from app.config import get_settings


def _dsn() -> str:
    s = get_settings()
    return s.computed_checkpoint_dsn


def _assert_user_namespace(namespace: tuple, ctx_user_id: int) -> None:
    if namespace and namespace[0] == "shared":
        return
    if len(namespace) < 2:
        raise ValueError(f"namespace must include user_id at index 1: {namespace}")
    if namespace[1] != ctx_user_id and namespace[1] != "public":
        raise PermissionError(f"namespace user_id mismatch: ns={namespace} ctx_user_id={ctx_user_id}")


class PgvectorStore(BaseStore):
    def __init__(self) -> None:
        super().__init__()

    def batch(self, ops: Any) -> list[Any]:
        raise NotImplementedError("PgvectorStore.batch pending C/D/E impl")

    async def abatch(self, ops: Any) -> list[Any]:
        raise NotImplementedError("PgvectorStore.abatch pending C/D/E impl")

    async def aget(self, namespace: tuple[str, ...], key: str) -> Optional[Item]:
        raise NotImplementedError("PgvectorStore.aget pending C/D/E impl")

    async def aput(self, namespace: tuple[str, ...], key: str, value: dict[str, Any]) -> None:
        raise NotImplementedError("PgvectorStore.aput pending C/D/E impl")

    async def asearch(self, namespace: tuple[str, ...], *, query: Optional[Sequence[float]] = None, filter: Optional[dict] = None, limit: int = 5) -> list[Item]:
        raise NotImplementedError("PgvectorStore.asearch pending C/D/E impl")

    async def alist(self, namespace: tuple[str, ...], filter: Optional[dict] = None) -> list[Item]:
        raise NotImplementedError("PgvectorStore.alist pending C/D/E impl")

    async def adelete(self, namespace: tuple[str, ...], key: str) -> None:
        raise NotImplementedError("PgvectorStore.adelete pending C/D/E impl")
