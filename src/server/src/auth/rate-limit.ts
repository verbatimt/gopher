// Redis-backed fixed-window rate limiting (per bucket + identifier, typically IP).

import { redis } from '../redis/client.ts';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number; // seconds until the window resets
}

export async function checkRateLimit(
  bucket: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const key = `ratelimit:${bucket}:${identifier}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  if (count > limit) {
    const ttl = await redis.ttl(key);
    return { allowed: false, remaining: 0, retryAfter: ttl > 0 ? ttl : windowSeconds };
  }
  return { allowed: true, remaining: Math.max(0, limit - count), retryAfter: 0 };
}
