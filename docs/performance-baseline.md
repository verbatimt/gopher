# Performance Baseline (EP-0040)

A first **reference point** (not an SLO) for Gopher's key endpoints, measured against the
deployed LAN stack (`server.local`, ARM64 Raspberry Pi). Re-run after significant changes to
detect regressions.

## Method

- Tool: `src/infra/loadtest/loadtest.ts` — a self-contained bun load tester (built-in `fetch`,
  no external dependency). It registers a throwaway household, seeds minimal finance data, then
  drives the read endpoints concurrently and times forecast generation sequentially.
- Run:
  ```sh
  cd src/server && TARGET=http://gopher.local CONCURRENCY=10 THINK_MS=10 DURATION_MS=12000 \
    bun run ../infra/loadtest/loadtest.ts
  ```
- Parameters: **10 concurrent clients**, **10 ms think time** between requests (models active
  users), **12 s per endpoint** (all configurable via `CONCURRENCY` / `THINK_MS` /
  `DURATION_MS`). Forecast generation: a 90-day window, 10 sequential runs.
- Endpoints: `GET /health`, `GET /calendar` (1-year range), `GET /tasks`, `GET /dashboard`,
  and `POST /finance/forecasts` (generation timing).
- **Think time matters:** with `THINK_MS=0` the generator issues 30k+ requests in a minute and
  exhausts the *dev host's* local sockets, producing spurious connection failures on the later
  endpoints — a load-generator artifact, not a server limit (a fresh single-endpoint run of the
  dashboard at 8 workers returned 1243× HTTP 200, 0 errors). Use a small think time for a
  representative household baseline.

## Recorded run (against `http://gopher.local`, ARM64 Pi)

```
Target http://gopher.local · concurrency 10 · think 10ms · 12s/endpoint

| Endpoint       | Requests | Errors | Throughput (req/s) | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) |
|----------------|----------|--------|--------------------|----------|----------|----------|----------|
| GET /health    | 10070    | 0      | 838.5              | 1.22     | 4.58     | 6.65     | 37.80    |
| GET /calendar  | 5731     | 0      | 476.9              | 8.17     | 22.42    | 32.12    | 54.21    |
| GET /tasks     | 4056     | 0      | 337.4              | 18.85    | 28.97    | 39.39    | 72.11    |
| GET /dashboard | 1849     | 0      | 153.5              | 53.89    | 66.91    | 97.95    | 201.96   |

Forecast generation (90-day window, 10 sequential runs): p50 86.2 ms · p95 111.8 ms · max 111.8 ms
```

**Reading the numbers.** Zero errors across all endpoints. `/dashboard` is the heaviest read
(it aggregates six modules' sections in parallel) at p95 ≈ 67 ms — still well within interactive
latency. `/health` is trivially fast. Throughput figures are user-paced (think time), not raw
saturation ceilings; they are far above any plausible household load (a household has a handful
of members, not hundreds of req/s).

## Notes

- **Forecast generation** is the heaviest operation (it expands recurrences and writes paired
  ledger entries + daily balances per day in the window). At a representative **90-day window**
  it completes in **~86 ms (p50), ~112 ms (p95)** on the Pi — comfortably under any request
  timeout. **Conclusion: synchronous generation is acceptable** for typical windows; the
  EP-0033 async path (return a forecast id + stream progress) is only warranted for very wide
  multi-year ranges, and would not change the computed results. Validation should keep the
  forecast window bounded in the create flow to stay on the fast path.
- The Pi is ARM64 and shares the host with other apps; numbers are a LAN baseline, not a
  datacenter benchmark. Treat relative change across runs as the signal.
