// Allowance granter worker (EP-0028). Grants recurring point allowances: for each active
// allowance it expands the cadence over the half-open window (last_granted_at, now], credits
// one `earn` per occurrence via the EP-0027 ledger primitive, and advances last_granted_at —
// so a re-run grants nothing (idempotent), exactly like the EP-0022 generation boundary. A
// Redis lock keeps a single replica granting at a time.

import { and, eq } from 'drizzle-orm';
import { db, withTransaction } from '../db/index.ts';
import { rewardAllowances } from '../db/schema/index.ts';
import { recordTransaction } from '../modules/rewards/service.ts';
import { logger } from '../observability/logger.ts';
import { recordWorkerRun } from '../observability/metrics.ts';
import { broadcast } from '../realtime/bus.ts';
import { RealtimeEvents, userChannel } from '../realtime/events.ts';
import { expandRRuleString } from '../recurrence/rrule.ts';
import { acquireLock, releaseLock } from './recurring-task-generator.ts';

const LOCK_KEY = 'lock:allowance-granter';
const LOCK_TTL_SECONDS = 120;

export interface GrantOptions {
  now?: Date;
  /** Restrict to a single household (tests). */
  householdId?: string;
}

export interface GrantMetrics {
  skipped: boolean;
  allowances: number;
  granted: number;
}

async function grantForOne(
  allowance: typeof rewardAllowances.$inferSelect,
  now: Date,
): Promise<number> {
  // Half-open window: never re-grant at or before the last grant boundary.
  const from = allowance.lastGrantedAt
    ? new Date(allowance.lastGrantedAt.getTime() + 1)
    : allowance.createdAt;
  if (from > now) return 0;

  const dates = expandRRuleString(allowance.rrule, from, now);
  let granted = 0;
  for (const _occurrence of dates) {
    await withTransaction((tx) =>
      recordTransaction(tx, {
        householdId: allowance.householdId,
        memberId: allowance.memberId,
        type: 'earn',
        amount: allowance.points,
        status: 'approved',
        notes: allowance.name ?? 'Allowance',
        createdBy: null,
      }),
    );
    granted += 1;
  }

  // Advance the boundary regardless (idempotent high-water mark).
  await db
    .update(rewardAllowances)
    .set({ lastGrantedAt: now, updatedAt: new Date() })
    .where(eq(rewardAllowances.id, allowance.id));

  if (granted > 0) {
    await broadcast(userChannel(allowance.memberId), {
      type: RealtimeEvents.rewardUpdated,
      payload: { memberId: allowance.memberId },
    });
  }
  return granted;
}

export async function grantAllowances(options: GrantOptions = {}): Promise<GrantMetrics> {
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const acquired = await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
  if (!acquired) {
    logger.info('allowance grant skipped (lock held)');
    return { skipped: true, allowances: 0, granted: 0 };
  }
  try {
    const conditions = [eq(rewardAllowances.isActive, true)];
    if (options.householdId) conditions.push(eq(rewardAllowances.householdId, options.householdId));
    const allowances = await db
      .select()
      .from(rewardAllowances)
      .where(and(...conditions));

    let granted = 0;
    for (const allowance of allowances) {
      try {
        granted += await grantForOne(allowance, now);
      } catch (error) {
        logger.error('allowance grant error', { allowanceId: allowance.id, error: String(error) });
      }
    }
    logger.info('allowance grant', { allowances: allowances.length, granted });
    const metrics = { skipped: false, allowances: allowances.length, granted };
    recordWorkerRun('allowance-granter', Date.now() - startedAt, metrics);
    return metrics;
  } finally {
    await releaseLock(LOCK_KEY);
  }
}

/** Register the periodic granter (hourly). Returns a stop function. */
export function registerAllowanceScheduler(intervalMs = 60 * 60 * 1000): () => void {
  const timer = setInterval(() => {
    grantAllowances().catch((error) =>
      logger.error('scheduled allowance grant failed', { error: String(error) }),
    );
  }, intervalMs);
  return () => clearInterval(timer);
}
