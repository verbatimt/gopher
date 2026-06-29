// Refresh-token sessions: stored as a SHA-256 hash in BOTH Redis (fast lookup, 30-day TTL)
// and user_sessions (device tracking). Rotation deletes the prior hash to prevent replay.

import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { userSessions } from '../../db/schema/index.ts';
import { redis } from '../../redis/client.ts';
import { generateToken, sha256 } from './tokens.ts';

const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const refreshKey = (hash: string) => `refresh:${hash}`;

interface SessionPayload {
  userId: string;
  householdId: string | null;
  sessionId: string;
}

/** Create a session: persist hash (Redis + DB), return the raw token (cookie-only). */
export async function createRefreshSession(
  userId: string,
  householdId: string | null,
  deviceLabel: string | null,
): Promise<{ raw: string; sessionId: string }> {
  const raw = generateToken(32);
  const hash = sha256(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

  const [session] = await db
    .insert(userSessions)
    .values({ userId, refreshTokenHash: hash, deviceLabel, expiresAt })
    .returning();

  const payload: SessionPayload = { userId, householdId, sessionId: session!.id };
  await redis.set(refreshKey(hash), JSON.stringify(payload), 'EX', REFRESH_TTL_SECONDS);
  return { raw, sessionId: session!.id };
}

async function lookup(rawToken: string): Promise<(SessionPayload & { hash: string }) | null> {
  const hash = sha256(rawToken);
  const data = await redis.get(refreshKey(hash));
  if (!data) return null;
  return { hash, ...(JSON.parse(data) as SessionPayload) };
}

/** Rotate a refresh token: invalidate the old, issue a new one. Returns null if invalid. */
export async function rotateRefreshSession(
  rawToken: string,
): Promise<{ raw: string; userId: string; householdId: string | null; sessionId: string } | null> {
  const existing = await lookup(rawToken);
  if (!existing) return null;

  await redis.del(refreshKey(existing.hash));

  const raw = generateToken(32);
  const hash = sha256(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

  await db
    .update(userSessions)
    .set({ refreshTokenHash: hash, lastUsedAt: new Date(), expiresAt })
    .where(eq(userSessions.id, existing.sessionId));

  const payload: SessionPayload = {
    userId: existing.userId,
    householdId: existing.householdId,
    sessionId: existing.sessionId,
  };
  await redis.set(refreshKey(hash), JSON.stringify(payload), 'EX', REFRESH_TTL_SECONDS);
  return {
    raw,
    userId: existing.userId,
    householdId: existing.householdId,
    sessionId: existing.sessionId,
  };
}

/** Revoke a single session by its raw token (idempotent). */
export async function revokeRefreshSession(
  rawToken: string,
): Promise<{ userId: string; householdId: string | null } | null> {
  const existing = await lookup(rawToken);
  if (!existing) return null;
  await redis.del(refreshKey(existing.hash));
  await db.delete(userSessions).where(eq(userSessions.id, existing.sessionId));
  return { userId: existing.userId, householdId: existing.householdId };
}

/** Revoke every session for a user (used on password reset). */
export async function revokeAllSessions(userId: string): Promise<void> {
  const sessions = await db
    .select({ hash: userSessions.refreshTokenHash })
    .from(userSessions)
    .where(eq(userSessions.userId, userId));
  for (const s of sessions) {
    await redis.del(refreshKey(s.hash));
  }
  await db.delete(userSessions).where(eq(userSessions.userId, userId));
}

export async function listSessions(userId: string) {
  return db
    .select({
      id: userSessions.id,
      deviceLabel: userSessions.deviceLabel,
      createdAt: userSessions.createdAt,
      lastUsedAt: userSessions.lastUsedAt,
      expiresAt: userSessions.expiresAt,
    })
    .from(userSessions)
    .where(eq(userSessions.userId, userId));
}

export async function revokeSessionById(userId: string, sessionId: string): Promise<boolean> {
  const [session] = await db
    .select({ hash: userSessions.refreshTokenHash })
    .from(userSessions)
    .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId)))
    .limit(1);
  if (!session) return false;
  await redis.del(refreshKey(session.hash));
  await db.delete(userSessions).where(eq(userSessions.id, sessionId));
  return true;
}
