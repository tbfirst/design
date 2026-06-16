#!/bin/bash
#
# init_host_dirs.sh — initialize tbfirst host data directories on the office mini-host.
#
# Creates /data/tbfirst/{pg,redis,nacos,img-cache,backups,logs,secrets} and locks
# down the secrets directory. Idempotent — safe to re-run.
#
# Usage (run as root or with sudo):
#   sudo bash infra/scripts/init_host_dirs.sh
#
set -euo pipefail

BASE_DIR="/data/tbfirst"
SUBDIRS=(
  "pg"
  "redis"
  "nacos"
  "nacos/data"
  "nacos/logs"
  "img-cache"
  "backups"
  "logs"
  "secrets"
)

echo "[init_host_dirs] base: ${BASE_DIR}"

mkdir -p "${BASE_DIR}"

for d in "${SUBDIRS[@]}"; do
  full="${BASE_DIR}/${d}"
  mkdir -p "${full}"
  echo "[init_host_dirs] ensured ${full}"
done

# Secrets dir must be 700 to keep tunnel tokens / db creds out of other users' reach.
chmod 700 "${BASE_DIR}/secrets"
echo "[init_host_dirs] chmod 700 ${BASE_DIR}/secrets"

echo "[init_host_dirs] done."
