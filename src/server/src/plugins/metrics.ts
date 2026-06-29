// Metrics endpoint (EP-0040). Non-enveloped diagnostics (like /health): request/error
// counters, WebSocket connections, and per-worker run stats. Unauthenticated and read-only;
// intended for LAN operational visibility, not public exposure.

import { Elysia } from 'elysia';
import { metricsSnapshot } from '../observability/metrics.ts';

export function metricsPlugin() {
  return new Elysia({ name: 'metrics' }).get('/metrics', () => metricsSnapshot(), {
    detail: { summary: 'Operational counters: requests, errors, WS connections, worker runs' },
  });
}
