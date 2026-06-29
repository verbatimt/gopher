// Password-reset tokens: random token, SHA-256 hash stored in Redis with a 1-hour TTL,
// single-use (consumed on read). No external email — the raw token is delivered
// out-of-band (in non-prod it may be returned by the API for testing; see routes).

import { redis } from '../../redis/client.ts';
import { generateToken, sha256 } from './tokens.ts';

const RESET_TTL_SECONDS = 60 * 60; // 1 hour
const resetKey = (hash: string) => `pwreset:${hash}`;

/** Issue a single-use reset token for a user; returns the raw token. */
export async function createResetToken(userId: string): Promise<string> {
  const raw = generateToken(32);
  await redis.set(resetKey(sha256(raw)), userId, 'EX', RESET_TTL_SECONDS);
  return raw;
}

/** Consume a reset token (single-use). Returns the userId, or null if invalid/expired. */
export async function consumeResetToken(rawToken: string): Promise<string | null> {
  const key = resetKey(sha256(rawToken));
  const userId = await redis.get(key);
  if (!userId) return null;
  await redis.del(key); // single-use
  return userId;
}
