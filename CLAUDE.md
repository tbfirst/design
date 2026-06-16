# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`tbfirst` (working dir `E:\design-agent`) is a polyglot monorepo for an AI tooling matrix: Java Spring Cloud microservices + a FastAPI/LangGraph Python AI service + a React/Vite frontend, all sitting behind one gateway. Every backend module is named `tbfirst-*`. Infrastructure is PostgreSQL 16 + pgvector, Redis 7, and Nacos 2.4 (service registry **and** config center).

> Note: `README.md` is detailed but was written for an older checkout at `E:/tbfirst` and links an `errorConclude/` directory that does **not** exist in this copy. Trust this file's paths; the repo root is `E:\design-agent`. There is no git history yet.

## Layout & ports

| Component | Dir | Port | State |
|---|---|---|---|
| Gateway (only external entry) | `tbfirst-gateway` | 8000 | active |
| Auth | `tbfirst-auth` | 8101 | active |
| Image (生图, the one built-out business service) | `tbfirst-image` | 8102 | active |
| CineStitch (分镜生成) | `tbfirst-cinestitch` | 8105 | skeleton (health-check only; has an active gateway route) |
| Python AI service | `tbfirst-ai-python` | 8200 | active |
| Frontend (not a Maven module) | `tbfirst-frontend` | 5173 | active |

`tbfirst-common/` holds 8 shared Java libs (`-core`, `-web`, `-security`, `-redis`, `-datasource`, `-feign`, `-log`, `-oss`); `tbfirst-dependencies/` is the internal BOM. Parent `pom.xml` is `com.tbfirst:tbfirst` (Java 21, Spring Boot 3.5.8, Spring Cloud 2025.0.1 + Alibaba 2025.0.0.0).

## Build / run / test

**Prerequisite for any Java service:** Nacos must have an admin user, the namespace `dev`, and a config `tbfirst-common.yaml` (group `DEFAULT_GROUP`) seeded from `infra/nacos/tbfirst-common.yaml`. Services read shared config from there on startup. Run **`bash infra/scripts/init_nacos.sh`** once after `docker compose -f docker-compose.infra.yml up -d` — it is idempotent and does all three. **Gotcha (Nacos 3.x):** the `nacos/nacos-server:v3.1.1` image no longer auto-creates the default `nacos/nacos` admin and ignores `NACOS_AUTH_ADMIN_PASSWORD`; without the admin user, every service dies at startup with `NacosException: Code: 401, User not found!` (service registration fails with `failFast=true`, which then shuts the context down — the tail-end symptom is a misleading `nacos-client ... DefaultPublisher InterruptedException`). The admin lives in the `nacos-data` volume, so this only bites on a fresh server or after `docker compose down -v`.

Java (Maven, from repo root):
```bash
mvn -T 2C clean install -DskipTests          # build all modules
mvn -pl tbfirst-image -am install -DskipTests # build one module + its deps
mvn -pl tbfirst-auth test                     # test one module
mvn -pl tbfirst-auth test -Dtest=ClassName#method  # single test
```
Run services locally via their `*Application` main classes, in order: Gateway → Auth → Image → CineStitch. Note: Java `src/test` dirs are mostly empty `.gitkeep` — the real test suite lives in Python.

Python (`cd tbfirst-ai-python`):
```bash
python -m venv .venv && source .venv/Scripts/activate   # Windows Git Bash
pip install -r requirements.txt
cp .env.example .env            # set GEMINI_API_KEY
uvicorn app.main:app --host 0.0.0.0 --port 8200 --reload
pytest                          # all tests
pytest tests/graph/test_plan_node.py::test_name   # single test
```

Frontend (`cd tbfirst-frontend`):
```bash
npm install
npm run dev      # Vite dev server on 5173, proxies /api,/static,/img → :8000
npm run build
npm run lint     # === tsc --noEmit (typecheck only; there is no ESLint)
```

Full stack via Docker (root): `docker compose up -d --build` (11 containers). Infra only: `docker compose -f docker-compose.infra.yml up -d`.

## Architecture & request flow

All external traffic enters the **gateway (:8000)**. Routes live in `tbfirst-gateway/src/main/resources/application.yml`: manual routes for `/api/auth/**`, `/api/image/**`, `/api/cinestitch/**`, `/static/**`, `/img/**`, and `/api/ai/**` (which `RewritePath`-strips the `/api/ai` prefix). Discovery-locator also auto-creates `/<service-id>/**` routes (used to reach each service's Swagger UI).

**Auth is header-based and this is the single most important invariant to respect:**
1. Gateway validates the JWT **once** (`AuthGlobalFilter`), then injects `X-User-Id / -Name / -Roles / -Group-Id / -Group-Role / -Personal-Cap / -Group-Cap` headers to downstream services.
2. Each Java service trusts those headers via `UserContextFilter` (in `tbfirst-common-security`), which parses them into a ThreadLocal `UserContext` (`UserContextHolder`). Services never re-verify the JWT.
3. A business `/api/**` request **missing `X-User-Id` is rejected 401** (fail-fast — it means the request bypassed the gateway). Don't try to make services callable directly.
4. Authorization is **pure role + resource-ownership, decided in the service layer.** The old fine-grained `permissions` / `@RequirePermission` / `PermissionAspect` system was fully removed — e.g. `image:manage-models` now just means "must be ADMIN".

**Whitelist invariant:** `UserContextFilter.isExempt()` and the gateway's `AuthGlobalFilter.WHITELIST` must stay in sync (login/register/refresh, `/internal/`, actuator, OpenAPI/swagger paths). Editing one without the other causes login loops or leaked endpoints.

Inter-service calls use **OpenFeign** (e.g. `tbfirst-image` → auth `usersByIds` to resolve usernames). Internal endpoints live under `/internal/`, are protected by an internal token, and are exempt from the user-context check. The Python service has **no JWT of its own** — by design it is only reachable through the gateway / internal calls.

## Python AI agent

`app/main.py` builds a LangGraph `StateGraph` (`app/agent/graph/build.py`) at startup with **graceful degradation** — if the PG checkpointer/store fails to init, the app still runs without agent capabilities. The graph implements a six-layer memory model (L1 basic rules, L2→L3 message compression, L4 user preferences, L5/L6 vector recall) plus optional Plan-Solve / Reflection / Reflexion nodes. Those advanced layers are gated by env flags, all default **OFF**: `AGENT_PLAN_ENABLED`, `AGENT_REFLECT_ENABLED`, `AGENT_REFLEXION_ENABLED`, `AGENT_VECTOR_MEMORY_ENABLED`. Vector memory requires pgvector + the `BAAI/bge-m3` embedding model; persistence uses the LangGraph Postgres checkpointer. Config is `app/config.py` (pydantic-settings, reads `.env`). Routes are aggregated in `app/routes/__init__.py`; agent tools (image_gen, web_search, knowledge_search, memory_inspector, budget/executor/registry) under `app/agent/graph/tools/`.

## Conventions

- **Naming:** Maven `artifactId` == directory name, all `tbfirst-` prefixed.
- **Database:** each service owns one schema (`auth`, `image`, `cinestitch`, …) plus a shared `asset` schema. Migrations are Flyway files at `<module>/src/main/resources/db/migration/V*.sql`. For a clean rebuild use `infra/postgres/init_new.sql` (all columns inlined into `CREATE TABLE`); `infra/postgres/init.sql` is the older additive version.
- **Redis keys:** prefixed `tbfirst:<namespace>:*`.
- **Config:** runtime secrets via root `.env` (Docker) and `tbfirst-ai-python/.env` (Python); shared Java config via Nacos `tbfirst-common.yaml`. JWT secret/expiry and image daily quota are gateway `app.*` config.

## Gotchas (cross-file, non-obvious)

- **Swagger through the gateway** needs **relative** `springdoc.swagger-ui.url` / `config-url` (e.g. `../v3/api-docs`). Absolute paths 404 when proxied through the gateway. Each service has its own Swagger (`/swagger-ui/index.html`); there is no Knife4j aggregation. Python uses FastAPI `/docs`.
- **Vite dev proxy** sets a long `timeout`/`proxyTimeout` (~200s) in `vite.config.ts` because image generation is slow upstream; without it long requests are silently dropped (never reach the gateway, no 502).
- **tbfirst-image generation lifecycle:** new jobs are `saved=false`; a 30-day LRU cleaner (`@Scheduled`, default 03:00) deletes unsaved DB rows + disk files; "download & save" (`POST /api/image/jobs/{id}/save`) renews the TTL. Visibility is group-scoped (`generation_job.group_id` snapshot) — same-group members can see and download each other's history. Keep this in mind when touching image history/auth.
