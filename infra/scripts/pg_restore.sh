#!/bin/bash
#
# pg_restore.sh — restore the office Postgres from a GCS-stored dump.
#
# Pulls the latest tbfirst-pg-<DATE>*.sql.gz from
# gs://${GCS_BACKUP_BUCKET}/postgres/, decompresses, and feeds it to the
# running tbfirst-postgres-prod container. DESTRUCTIVE — overwrites all
# databases on the target cluster. Spec: .ralph/specs/pg-backup-restore.md.
#
# Required env vars:
#   DB_USER             — Postgres superuser
#   GCS_BACKUP_BUCKET   — bucket name (no gs:// prefix)
#
# Usage:
#   ./pg_restore.sh 20260501
#     ↑ date in YYYYMMDD; the script picks the latest backup of that day.
#
set -euo pipefail

: "${DB_USER:?DB_USER is required}"
: "${GCS_BACKUP_BUCKET:?GCS_BACKUP_BUCKET is required}"
: "${1:?需要指定日期，如 ./pg_restore.sh 20260501}"

DATE="$1"
PATTERN="gs://${GCS_BACKUP_BUCKET}/postgres/tbfirst-pg-${DATE}*.sql.gz"

echo "[$(date)] 查找 ${PATTERN}"

# 当天可能有多份（手动跑 + cron 03:00），取字典序最大的（即最新一份）
URL=$(gsutil ls "${PATTERN}" | sort | tail -1)

if [[ -z "${URL}" ]]; then
    echo "[ERROR] 没找到 ${DATE} 的备份"
    exit 1
fi

echo "找到：${URL}"
TMP="/tmp/pg-restore-$$.sql.gz"
gsutil cp "${URL}" "${TMP}"

echo "==========================================================="
echo "WARNING: 即将覆盖当前 PG，按 Ctrl-C 中止，5s 后继续"
echo "==========================================================="
sleep 5

# pg_dumpall 产物用普通 psql 灌回（包含 CREATE DATABASE 等顶层语句）
gunzip -c "${TMP}" | docker exec -i tbfirst-postgres-prod psql -U "${DB_USER}" postgres

rm -f "${TMP}"
echo "[$(date)] 恢复完成：${URL}"
