#!/bin/bash
#
# install_cron.sh — register the daily Postgres backup cron entry.
#
# Idempotent: existing pg_backup.sh entries are dropped before the new
# line is appended, so re-running this script never duplicates jobs.
# Spec: .ralph/specs/pg-backup-restore.md.
#
# Usage (run as root or with sudo, since cron belongs to the user that
# will own the backup process — typically root on the mini-host):
#   sudo bash infra/scripts/install_cron.sh
#
set -euo pipefail

CRON_LINE="0 3 * * * /opt/tbfirst/infra/scripts/pg_backup.sh >> /data/tbfirst/logs/pg_backup.log 2>&1"

# 幂等写入：先剔除任何已存在的 pg_backup.sh 行，再 append 新行
( crontab -l 2>/dev/null | grep -v "pg_backup.sh"; echo "${CRON_LINE}" ) | crontab -

echo "[install_cron] 已注册 cron："
crontab -l | grep "pg_backup.sh"
