// Health endpoint. Verifies Postgres (SELECT 1) and Redis (ping) and returns a documented
// diagnostic shape (NOT the standard envelope — see docs/api-conventions.md):
//   { status, services: { database, redis }, version, uptime }   200 healthy / 503 degraded
// Checks are injectable so the response/status logic is unit-testable without live services.

import { Elysia } from 'elysia';
import { config } from '../config.ts';
import { pingDatabase } from '../db/index.ts';
import { pingRedis } from '../redis/client.ts';

export interface HealthChecks {
  checkDatabase: () => Promise<boolean>;
  checkRedis: () => Promise<boolean>;
}

export function summarize(services: { database: boolean; redis: boolean }): {
  status: 'healthy' | 'degraded';
  httpStatus: 200 | 503;
} {
  const healthy = services.database && services.redis;
  return healthy ? { status: 'healthy', httpStatus: 200 } : { status: 'degraded', httpStatus: 503 };
}

export function healthPlugin(checks: Partial<HealthChecks> = {}) {
  const checkDatabase = checks.checkDatabase ?? pingDatabase;
  const checkRedis = checks.checkRedis ?? pingRedis;

  return new Elysia({ name: 'health' }).get(
    '/health',
    async ({ set }) => {
      const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
      const { status, httpStatus } = summarize({ database, redis });
      set.status = httpStatus;
      return {
        status,
        services: { database, redis },
        name: 'gopher-api',
        version: config.apiVersion,
        build: process.env.BUILD_SHA ?? 'dev',
        uptime: Math.round(process.uptime()),
      };
    },
    { detail: { summary: 'Liveness/readiness of the API and its dependencies' } },
  );
}
