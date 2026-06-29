// Tests for the observability metrics registry + endpoint (EP-0040).

import { describe, expect, it } from 'bun:test';
import { createApp } from '../app.ts';
import {
  metricsSnapshot,
  recordRequest,
  recordWorkerRun,
  resetMetrics,
  wsClosed,
  wsOpened,
} from './metrics.ts';

const app = createApp();

async function get(path: string) {
  const res = await app.handle(new Request(`http://localhost${path}`));
  return { status: res.status, body: JSON.parse(await res.text()) };
}

describe('metrics registry', () => {
  it('records requests, ws connections, and worker runs', () => {
    resetMetrics();
    recordRequest(200);
    recordRequest(404);
    recordRequest(500);
    wsOpened();
    wsOpened();
    wsClosed();
    recordWorkerRun('w', 7, { generated: 3 });

    const s = metricsSnapshot();
    expect(s.requests).toBe(3);
    expect(s.clientErrors).toBe(1);
    expect(s.serverErrors).toBe(1);
    expect(s.errorRate).toBeCloseTo(2 / 3, 2);
    expect(s.wsConnections).toBe(1);
    expect(s.wsConnectionsTotal).toBe(2);
    expect(s.workers.w!.runs).toBe(1);
    expect(s.workers.w!.lastResult).toEqual({ generated: 3 });
  });
});

describe('observability endpoints', () => {
  it('GET /health reports name/version/build/uptime', async () => {
    const r = await get('/health');
    expect(r.body.name).toBe('gopher-api');
    expect(r.body.version).toBe('v1');
    expect(r.body).toHaveProperty('build');
    expect(typeof r.body.uptime).toBe('number');
  });

  it('GET /metrics exposes counters', async () => {
    const r = await get('/metrics');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('requests');
    expect(r.body).toHaveProperty('errorRate');
    expect(r.body).toHaveProperty('wsConnections');
    expect(r.body).toHaveProperty('workers');
  });
});
