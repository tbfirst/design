from __future__ import annotations

import hashlib
import logging
from pathlib import Path

import psycopg

from app.config import get_settings

logger = logging.getLogger(__name__)


def _dsn() -> str:
    settings = get_settings()
    return (
        f"host={settings.db_host} port={settings.db_port} dbname={settings.db_name} "
        f"user={settings.db_user} password={settings.db_password}"
    )


def _migration_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "migrations"


async def run_migrations() -> None:
    """Apply immutable SQL migrations once, guarded by a PostgreSQL advisory lock."""
    paths = sorted(_migration_dir().glob("*.sql"))
    if not paths:
        return

    async with await psycopg.AsyncConnection.connect(_dsn()) as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT pg_advisory_xact_lock(hashtext('tbfirst-ai-python-migrations'))")
            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS ai.schema_migration (
                    version VARCHAR(128) PRIMARY KEY,
                    checksum VARCHAR(64) NOT NULL,
                    applied_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
                """
            )
            for path in paths:
                sql = path.read_text(encoding="utf-8")
                checksum = hashlib.sha256(sql.encode("utf-8")).hexdigest()
                await cur.execute(
                    "SELECT checksum FROM ai.schema_migration WHERE version = %s",
                    (path.name,),
                )
                row = await cur.fetchone()
                if row:
                    applied = row[0]
                    if applied != checksum:
                        raise RuntimeError(f"migration checksum changed after apply: {path.name}")
                    continue
                await cur.execute(sql, prepare=False)
                await cur.execute(
                    "INSERT INTO ai.schema_migration (version, checksum) VALUES (%s, %s)",
                    (path.name, checksum),
                )
                logger.info("applied AI migration %s", path.name)
        await conn.commit()
