import { describe, expect, it } from 'bun:test';
import { healthPlugin, summarize } from './health.ts';

describe('health summarize', () => {
  it('is healthy only when both services are up', () => {
    expect(summarize({ database: true, redis: true })).toEqual({
      status: 'healthy',
      httpStatus: 200,
    });
  });

  it('is degraded (503) when either service is down', () => {
    expect(summarize({ database: false, redis: true }).httpStatus).toBe(503);
    expect(summarize({ database: true, redis: false }).httpStatus).toBe(503);
    expect(summarize({ database: false, redis: false }).status).toBe('degraded');
  });
});

describe('GET /health', () => {
  it('returns the documented shape with 200 when both up', async () => {
    const app = healthPlugin({ checkDatabase: async () => true, checkRedis: async () => true });
    const res = await app.handle(new Request('http://localhost/health'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('healthy');
    expect(body.services).toEqual({ database: true, redis: true });
    expect(typeof body.version).toBe('string');
    expect(typeof body.uptime).toBe('number');
  });

  it('returns 503 when a dependency is down', async () => {
    const app = healthPlugin({ checkDatabase: async () => true, checkRedis: async () => false });
    const res = await app.handle(new Request('http://localhost/health'));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; services: { redis: boolean } };
    expect(body.status).toBe('degraded');
    expect(body.services.redis).toBe(false);
  });
});
