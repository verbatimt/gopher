// In-process metrics registry (EP-0040). Cheap counters/gauges for operational visibility:
// request + error rates, current/total WebSocket connections, and per-worker run stats. No
// secrets/PII are recorded (coordinate with EP-0038). Exposed via the /metrics endpoint and
// summarized in logs; replaced by a real metrics backend only if/when one is introduced.

export interface WorkerStat {
  runs: number;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastResult: Record<string, unknown> | null;
}

const state = {
  startedAt: Date.now(),
  requests: 0,
  serverErrors: 0, // responses with status >= 500
  clientErrors: 0, // responses with status 400–499
  wsConnections: 0, // current (gauge)
  wsConnectionsTotal: 0, // cumulative
  workers: {} as Record<string, WorkerStat>,
};

/** Record an HTTP response by status class. */
export function recordRequest(status: number): void {
  state.requests += 1;
  if (status >= 500) state.serverErrors += 1;
  else if (status >= 400) state.clientErrors += 1;
}

export function wsOpened(): void {
  state.wsConnections += 1;
  state.wsConnectionsTotal += 1;
}

export function wsClosed(): void {
  state.wsConnections = Math.max(0, state.wsConnections - 1);
}

/** Record one background-worker run (duration + its returned metrics). */
export function recordWorkerRun(
  name: string,
  durationMs: number,
  result: Record<string, unknown>,
): void {
  const prev = state.workers[name];
  state.workers[name] = {
    runs: (prev?.runs ?? 0) + 1,
    lastRunAt: new Date().toISOString(),
    lastDurationMs: durationMs,
    lastResult: result,
  };
}

/** A point-in-time snapshot for the /metrics endpoint. */
export function metricsSnapshot() {
  const uptimeSeconds = Math.round((Date.now() - state.startedAt) / 1000);
  const totalErrors = state.serverErrors + state.clientErrors;
  return {
    uptimeSeconds,
    requests: state.requests,
    serverErrors: state.serverErrors,
    clientErrors: state.clientErrors,
    errorRate: state.requests > 0 ? Math.round((totalErrors / state.requests) * 1000) / 1000 : 0,
    wsConnections: state.wsConnections,
    wsConnectionsTotal: state.wsConnectionsTotal,
    workers: state.workers,
  };
}

/** Reset (tests only). */
export function resetMetrics(): void {
  state.requests = 0;
  state.serverErrors = 0;
  state.clientErrors = 0;
  state.wsConnections = 0;
  state.wsConnectionsTotal = 0;
  state.workers = {};
}
