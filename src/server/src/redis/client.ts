// Redis client (ioredis). Connects lazily on first command so importing never blocks.
// Used for cache, sessions/refresh tokens, pub/sub, and background queues. Under
// NODE_ENV=test it is an in-process ioredis-mock — same API, no server, no localhost.

import type { Redis as RedisType } from 'ioredis';
import { config } from '../config.ts';
import { logger } from '../observability/logger.ts';

async function createRedis(): Promise<RedisType> {
  if (config.nodeEnv === 'test') {
    const RedisMock = (await import('ioredis-mock')).default;
    return new RedisMock() as unknown as RedisType;
  }
  const { Redis } = await import('ioredis');
  return new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    // Keep retrying with capped backoff so the app recovers when Redis returns.
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
}

export const redis = await createRedis();

// Without an 'error' listener ioredis can throw unhandled errors when Redis is down.
redis.on('error', (err) => {
  logger.warn('redis connection error', { error: err.message });
});

/** Liveness probe for /health. Resolves false (never throws) within ~3s. */
export async function pingRedis(): Promise<boolean> {
  const ping = redis
    .ping()
    .then((res) => res === 'PONG')
    .catch(() => false);
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000));
  return Promise.race([ping, timeout]);
}
