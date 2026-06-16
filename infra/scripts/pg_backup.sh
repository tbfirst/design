#!/bin/bash
#
# pg_backup.sh — daily Postgres dump → GCS, with 30-day rolling retention.
#
# Runs on the office mini-host. Invoked by cron at 03:00 Asia/Shanghai
# (see install_cron.sh). Spec: .ralph/specs/pg-backup-restore.md.
#
# Required env vars:
#   DB_USER             — Postgres superuser used by pg_dumpall
#   GCS_BACKUP_BUCKET   — bucket name (no gs:// prefix), e.g. tbfirst-backup
#
# Usage:
#   sudo DB_USER=tbfirst GCS_BACKUP_BUCKET=tbfirst-backup \
#     bash infra/scripts/pg_backup.sh
#
set -euo pipefail

: "${DB_USER:?DB_USER is required}"
: "${GCS_BACKUP_BUCKET:?GCS_BACKUP_BUCKET is required}"

TS=$(date +%Y%m%d-%H%M%S)
FILE="tbfirst-pg-${TS}.sql.gz"
TMP="/tmp/${FILE}"

echo "[$(date)] 开始备份 → ${FILE}"

# pg_dumpall 全库（所有 schema）→ gzip → 本地临时文件
docker exec tbfirst-postgres-prod pg_dumpall -U "${DB_USER}" | gzip > "${TMP}"

# 体积健全性检查：低于 1KB 几乎肯定是 dump 失败
SIZE=$(stat -c%s "${TMP}")
if [[ ${SIZE} -lt 1024 ]]; then
    echo "[ERROR] 备份文件异常小（${SIZE} bytes），中止上传"
    rm -f "${TMP}"
    exit 1
fi

# 上传 GCS
gsutil cp "${TMP}" "gs://${GCS_BACKUP_BUCKET}/postgres/${FILE}"

# 清理本地临时文件
rm -f "${TMP}"

# 保留 30 天滚动：按字典序倒排（最新在前），跳过前 30 个，其余删除
gsutil ls "gs://${GCS_BACKUP_BUCKET}/postgres/tbfirst-pg-*.sql.gz" \
    | sort -r \
    | tail -n +31 \
    | xargs -r gsutil rm

echo "[$(date)] 备份完成：${FILE} (${SIZE} bytes)"
