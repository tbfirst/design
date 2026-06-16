#!/bin/bash
#
# init_nacos.sh — one-time Nacos bootstrap for tbfirst (Nacos 3.x).
#
# Nacos 2.4+/3.x no longer auto-create the default `nacos/nacos` admin user, and
# the nacos-server docker image does NOT honour NACOS_AUTH_ADMIN_PASSWORD. So on a
# fresh server (or after `docker compose down -v`) every service fails to start with:
#
#   HttpLoginProcessor : login failed ... 403 "Access Denied" /nacos/v3/auth/user/login
#   NacosServiceRegistry : ... register failed ... failFast=true
#   NacosException: Code: 401, Message: User not found! Please check user exist or password is right!
#
# This script fixes that by, idempotently:
#   1. initializing the admin user (password = ${NACOS_PASS})
#   2. creating the config/registry namespace (${NACOS_NS})
#   3. seeding the shared config infra/nacos/tbfirst-common.yaml into ${NACOS_NS}/DEFAULT_GROUP
#
# Run it ONCE after the infra is up:
#   docker compose -f docker-compose.infra.yml up -d
#   bash infra/scripts/init_nacos.sh
#
# Override defaults via env, e.g.:
#   NACOS_ADDR=localhost:8848 NACOS_PASS=nacos NACOS_NS=dev bash infra/scripts/init_nacos.sh
#
set -euo pipefail

NACOS_ADDR="${NACOS_ADDR:-localhost:8848}"
NACOS_USER="${NACOS_USER:-nacos}"
NACOS_PASS="${NACOS_PASS:-nacos}"
NACOS_NS="${NACOS_NS:-dev}"
GROUP="${NACOS_GROUP:-DEFAULT_GROUP}"
DATA_ID="${NACOS_DATA_ID:-tbfirst-common.yaml}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_YAML="${COMMON_YAML:-${SCRIPT_DIR}/../nacos/tbfirst-common.yaml}"

BASE="http://${NACOS_ADDR}/nacos"

if [ ! -f "${COMMON_YAML}" ]; then
  echo "[init_nacos] ERROR: shared config not found: ${COMMON_YAML}" >&2
  exit 1
fi

login() {
  # echoes the accessToken on success, empty string otherwise
  curl -s -X POST "${BASE}/v3/auth/user/login" \
    --data-urlencode "username=${NACOS_USER}" \
    --data-urlencode "password=${NACOS_PASS}" 2>/dev/null \
    | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p'
}

echo "[init_nacos] target: ${BASE}  namespace=${NACOS_NS}  user=${NACOS_USER}"

# 1. Wait for Nacos to answer, and ensure the admin user exists.
TOKEN=""
for i in $(seq 1 60); do
  TOKEN="$(login || true)"
  if [ -n "${TOKEN}" ]; then
    echo "[init_nacos] admin login OK (attempt ${i})"
    break
  fi
  # First boot: the admin user does not exist yet — create it. Idempotent: on an
  # already-initialized server this just returns an error which we ignore.
  curl -s -X POST "${BASE}/v3/auth/user/admin" \
    --data-urlencode "password=${NACOS_PASS}" >/dev/null 2>&1 || true
  echo "[init_nacos] waiting for nacos / admin init... (attempt ${i})"
  sleep 2
done

if [ -z "${TOKEN}" ]; then
  echo "[init_nacos] ERROR: could not authenticate to Nacos at ${NACOS_ADDR} after 60 attempts." >&2
  echo "[init_nacos]   Is the container up?  docker ps | grep nacos" >&2
  exit 1
fi

AUTH=(-H "accessToken: ${TOKEN}")

# 2. Create the namespace (idempotent — 'already exists' is fine).
echo "[init_nacos] ensuring namespace '${NACOS_NS}'..."
curl -s -X POST "${BASE}/v3/admin/core/namespace" "${AUTH[@]}" \
  --data-urlencode "namespaceId=${NACOS_NS}" \
  --data-urlencode "namespaceName=${NACOS_NS}" \
  --data-urlencode "namespaceDesc=${NACOS_NS}" >/dev/null 2>&1 || true

# 3. Publish every shared config under infra/nacos/ (dataId = filename).
# Read each file via cat (so the shell, not Windows curl.exe, resolves the path —
# curl's `content@file` form chokes on Git Bash's POSIX-style paths).
NACOS_DIR="$(dirname "${COMMON_YAML}")"
published=0
for f in "${NACOS_DIR}"/*.yaml; do
  [ -e "${f}" ] || continue
  dataId="$(basename "${f}")"
  echo "[init_nacos] publishing ${dataId} -> ${NACOS_NS}/${GROUP}..."
  content="$(cat "${f}")"
  resp="$(curl -s -X POST "${BASE}/v3/admin/cs/config" "${AUTH[@]}" \
    --data-urlencode "dataId=${dataId}" \
    --data-urlencode "groupName=${GROUP}" \
    --data-urlencode "namespaceId=${NACOS_NS}" \
    --data-urlencode "type=yaml" \
    --data-urlencode "content=${content}")"
  case "${resp}" in
    *'"data":true'*) echo "[init_nacos]   OK"; published=$((published+1)) ;;
    *) echo "[init_nacos]   WARN: unexpected publish response: ${resp}" >&2 ;;
  esac
done
echo "[init_nacos] published ${published} shared config(s)."

echo "[init_nacos] done. Start services in order: gateway -> auth -> image -> cinestitch."
