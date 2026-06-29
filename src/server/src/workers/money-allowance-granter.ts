// Money-allowance granter worker (EP-0036). For each active money allowance it expands the
// cadence over the half-open window (last_granted_at, now], records one expense per occurrence
// attributed to the member, and advances last_granted_at — so a re-run grants nothing
// (idempotent), like the EP-0022 boundary. Distinct from the EP-0028 points-allowance granter.

import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { expenses, moneyAllowances } from '../db/schema/index.ts';
import { logger } from '../observability/logger.ts';
import { recordWorkerRun } from '../observability/metrics.ts';
import { expandRRuleString } from '../recurrence/rrule.ts';
import { acquireLock, releaseLock } from './recurring-task-generator.ts';

const LOCK_KEY = 'lock:money-allowance-granter';
const LOCK_TTL_SECONDS = 120;

export interface GrantOptions {
  now?: Date;
  householdId?: string;
}

export interface GrantMetrics {
  skipped: boolean;
  allowances: number;
  granted: number;
}

async function grantForOne(
  allowance: typeof moneyAllowances.$inferSelect,
  now: Date,
): Promise<number> {
  const from = allowance.lastGrantedAt
    ? new Date(allowance.lastGrantedAt.getTime() + 1)
    : allowance.createdAt;
  if (from > now) return 0;

  const dates = expandRRuleString(allowance.rrule, from, now);
  for (const occ of dates) {
    await db.insert(expenses).values({
      householdId: allowance.householdId,
      categoryId: null,
      amount: allowance.amount,
      currencyCode: 'USD',
      expenseDate: occ.toISOString().slice(0, 10),
      description: allowance.name ?? 'Allowance',
      loggedBy: allowance.memberId,
    });
  }
  await db
    .update(moneyAllowances)
    .set({ lastGrantedAt: now, updatedAt: new Date() })
    .where(eq(moneyAllowances.id, allowance.id));
  return dates.length;
}

export async function grantMoneyAllowances(options: GrantOptions = {}): Promise<GrantMetrics> {
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const acquired = await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
  if (!acquired) {
    logger.info('money-allowance grant skipped (lock held)');
    return { skipped: true, allowances: 0, granted: 0 };
  }
  try {
    const conditions = [eq(moneyAllowances.isActive, true)];
    if (options.householdId) conditions.push(eq(moneyAllowances.householdId, options.householdId));
    const allowances = await db
      .select()
      .from(moneyAllowances)
      .where(and(...conditions));

    let granted = 0;
    for (const allowance of allowances) {
      try {
        granted += await grantForOne(allowance, now);
      } catch (error) {
        logger.error('money-allowance grant error', {
          allowanceId: allowance.id,
          error: String(error),
        });
      }
    }
    logger.info('money-allowance grant', { allowances: allowances.length, granted });
    const metrics = { skipped: false, allowances: allowances.length, granted };
    recordWorkerRun('money-allowance-granter', Date.now() - startedAt, metrics);
    return metrics;
  } finally {
    await releaseLock(LOCK_KEY);
  }
}

/** Register the periodic granter (hourly). Returns a stop function. */
export function registerMoneyAllowanceScheduler(intervalMs = 60 * 60 * 1000): () => void {
  const timer = setInterval(() => {
    grantMoneyAllowances().catch((error) =>
      logger.error('scheduled money-allowance grant failed', { error: String(error) }),
    );
  }, intervalMs);
  return () => clearInterval(timer);
}
