# Observability (EP-0040)

Operational visibility for Gopher: structured logs, a metrics endpoint, health, and per-worker
run stats. Everything is in-process and LAN-local — no external monitoring service.

## Structured logging

`src/server/src/observability/logger.ts` emits **one JSON line per event**:

```json
{"ts":"2026-06-28T20:11:03.512Z","level":"info","message":"request","requestId":"…","method":"GET","path":"/api/v1/dashboard","status":200,"durationMs":7}
```

- **Levels:** `debug` / `info` / `warn` / `error` (warn/error → stderr). Silent under
  `NODE_ENV=test`.
- **Request correlation:** every HTTP request is assigned a `requestId` (returned as the
  `x-request-id` response header) and logged on completion with method, path, status, and
  duration. WS frames are handled by the same process; bus/worker logs carry their own ids.
- **No secrets/PII:** the logger never logs request bodies, tokens, passwords, or cookies.
  Auth value-changes record `<redacted>` (EP-0009). 5xx errors log a short detail only — never
  a stack trace in the response (EP-0038 coordination).

## Health

`GET /health` (non-enveloped, unauthenticated):

```json
{"status":"healthy","services":{"database":true,"redis":true},"name":"gopher-api","version":"v1","build":"dev","uptime":531}
```

`200` when DB + Redis are reachable, `503` (`degraded`) otherwise. `build` comes from the
`BUILD_SHA` env (defaults to `dev`). `uptime` is process seconds.

## Metrics

`GET /metrics` (non-enveloped, unauthenticated — LAN only) returns a live snapshot from
`src/server/src/observability/metrics.ts`:

| Field | Meaning |
|---|---|
| `uptimeSeconds` | Process uptime. |
| `requests` | Total HTTP responses observed. |
| `serverErrors` / `clientErrors` | Responses with status ≥ 500 / 400–499. |
| `errorRate` | `(serverErrors + clientErrors) / requests`. |
| `wsConnections` | Current open WebSocket connections (gauge). |
| `wsConnectionsTotal` | Cumulative WebSocket opens. |
| `workers` | Per-worker run stats (see below). |

Counters are incremented in the app's `onAfterResponse` hook (requests/errors) and in the WS
open/close handlers (connections).

## Background-worker observability

Each worker logs a summary line per run **and** records a stat via `recordWorkerRun(name, …)`,
surfaced under `metrics.workers.<name>`:

```json
{"runs":3,"lastRunAt":"…","lastDurationMs":12,"lastResult":{"skipped":false,"generated":4,"errors":0}}
```

Tracked workers: `recurring-task-generator` (EP-0022), `medication-reminders` (EP-0025),
`allowance-granter` (EP-0028), `money-allowance-granter` (EP-0036). Read `lastResult` to see
what the most recent scan/generation produced; `lastDurationMs` flags slow runs.

## Performance baseline

See `docs/performance-baseline.md` for recorded latency/throughput and the load-test method
(`src/infra/loadtest/loadtest.ts`).
