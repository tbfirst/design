# Design Agent execution hardening

## Goals

The execution path must remain usable when PostgreSQL, Redis, the gateway, the
image service, or the model provider is slow or temporarily unavailable. The
implementation preserves the existing context compression, layered memory,
planning/reflection paradigms, prompt governance, and approval model.

## Execution invariants

1. A user session has at most one active graph execution across workers.
2. A design action is executed only after its stored payload hash and brief
   version have been verified.
3. A generation retry with the same request id returns the existing job and is
   not charged twice by the gateway daily quota.
4. Database connections are never held while waiting for model generation.
5. An SSE stream always emits structured events; normal and handled-error paths
   end with `[DONE]`. A disconnected client releases its execution lease.
6. Dependency breakers are time-driven and have exactly three states. They do
   not store request or failure counters.

## Circuit breaker

Both Python and Java use `CLOSED -> OPEN -> HALF_OPEN -> CLOSED/OPEN`:

- A classified dependency failure opens the circuit immediately.
- Elapsed monotonic time makes one HALF_OPEN probe eligible.
- Other callers fail fast while that probe is active.
- A failed probe doubles the open duration up to a configured maximum.
- Permit generations prevent a late result from an older concurrent request
  from changing the current state.
- User-scoped 4xx and gateway quota 429 responses do not poison the shared
  Python gateway breaker. Java's model-provider breaker treats provider 429 as
  an upstream availability signal.

Runtime health is exposed through the image service Actuator health details as
`state` and `retryAfterMs`.

## Admission control

The gateway uses Spring Cloud Gateway's Redis token bucket with separate route
buckets:

| Traffic | Refill | Burst |
| --- | ---: | ---: |
| Agent control and SSE | 3/s | 12 |
| Image generation | 1/s | 4 |
| Image query and polling | 10/s | 30 |

Keys include route id and user id. Anonymous keys additionally include remote
IP so unrelated anonymous clients do not share one global bucket.

The daily image quota is a single Redis Lua transaction. It checks an
endpoint-scoped idempotency key, checks the cap, increments usage, and writes
expiry atomically. Redis failure remains fail-open so quota infrastructure does
not take down generation.

MCP tool quotas use atomic user and group token buckets. Both scopes are checked
before either is debited, so a denied request cannot partially consume quota.
The in-memory fallback mirrors these semantics and is bounded.

## Idempotency and serialization

- Chat requests accept `request_id`; the server generates one when omitted and
  emits it in `request_started`.
- A Redis lease serializes executions by user and session. A heartbeat renews
  long runs. Completed request ids are retained for deduplication; failed or
  disconnected requests are released for retry.
- Design runs retain their database-backed request id and approval action.
- Image generation stores `request_id` with a partial unique index on
  `(user_id, request_id)` for non-deleted jobs.
- The regular `image_gen` tool and design workflows both call the gateway with
  stable generation request ids.

## Connection lifecycle

- Agent repositories, routes, context compression, and all memory layers share
  one `psycopg_pool.AsyncConnectionPool`.
- MCP gateway calls and artifact downloads use process-wide pooled
  `httpx.AsyncClient` instances.
- The image SSE proxy uses one JDK `HttpClient`, which reuses upstream
  connections.
- Shutdown closes each shared resource independently; one close failure cannot
  skip the remaining resources.

## Configuration

| Environment variable | Default | Purpose |
| --- | ---: | --- |
| `AGENT_DB_POOL_MIN_SIZE` | 1 | Warm PostgreSQL connections |
| `AGENT_DB_POOL_MAX_SIZE` | 10 | Agent PostgreSQL concurrency ceiling |
| `AGENT_DB_POOL_TIMEOUT_SECONDS` | 10 | Pool acquisition timeout |
| `AGENT_EXECUTION_LEASE_SECONDS` | 120 | Session execution lease duration |
| `AGENT_REQUEST_DEDUPE_SECONDS` | 86400 | Completed chat request retention |
| `TBFIRST_MCP_HTTP_TIMEOUT_SECONDS` | 120 | Gateway request timeout |
| `TBFIRST_MCP_RETRY_ATTEMPTS` | 3 | Idempotent/readonly attempt ceiling |
| `TBFIRST_MCP_CIRCUIT_INITIAL_OPEN_SECONDS` | 10 | Initial gateway open duration |
| `TBFIRST_MCP_CIRCUIT_MAX_OPEN_SECONDS` | 60 | Maximum gateway open duration |
| `TBFIRST_MCP_QUOTA_PERIOD_SECONDS` | 86400 | MCP token refill period |
| `AI_PYTHON_CONNECT_TIMEOUT` | 10s | Java SSE upstream connect timeout |
| `AI_PYTHON_RESPONSE_TIMEOUT` | 30s | Java SSE response establishment timeout |
| `AI_PYTHON_CIRCUIT_INITIAL_OPEN` | 15s | Image provider initial open duration |
| `AI_PYTHON_CIRCUIT_MAX_OPEN` | 120s | Image provider maximum open duration |

Pool size should be budgeted with the LangGraph checkpointer pool and PostgreSQL
server connection limit. Rate and quota changes should be deployed together so
the short-term token bucket stays below the intended daily spend envelope.
