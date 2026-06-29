// Opaque token helpers. Refresh and reset tokens are 256-bit random strings; only their
// SHA-256 hash is ever stored (Redis + user_sessions). JWT access tokens are signed by the
// Elysia JWT plugin in the routes.

import { createHash, randomBytes } from 'node:crypto';

/** Generate a random token (default 256-bit) as hex. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/** SHA-256 hex digest — used to store token hashes, never the raw token. */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
