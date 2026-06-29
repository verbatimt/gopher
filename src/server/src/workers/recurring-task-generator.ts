// Recurring-task generation worker (EP-0022). Materializes future task instances from
// recurring tasks within the generate-ahead horizon, advances rotation pools, and respects
// generation boundaries so no duplicates spawn (context §5). A Redis lock ensures only one
// instance generates at a time; the unique (recurring_task_id, occurrence_date) constraint
// is the duplicate backstop.

import { and, eq } from 'drizzle-orm';
import { db, withTransaction } from '../db/index.ts';
import { recurringTasks, scheduledItems, tasks } from '../db/schema/index.ts';
import { logger } from '../observability/logger.ts';
import { recordWorkerRun } from '../observability/metrics.ts';
import { broadcast } from '../realtime/bus.ts';
import { householdChannel, RealtimeEvents } from '../realtime/events.ts';
import { expandRRuleString } from '../recurrence/rrule.ts';
import { redis } from '../redis/client.ts';

const LOCK_KEY = 'lock:recurring-task-generation';
const LOCK_TTL_SECONDS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
  const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}

export async function releaseLock(key: string): Promise<void> {
  await redis.del(key);
}

export interface GenerationOptions {
  now?: Date;
  /** Restrict to a single household (tests). */
  householdId?: string;
}

export interface GenerationMetrics {
  skipped: boolean;
  recurringTasks: number;
  generated: number;
  errors: number;
}

type ActiveRow = {
  recurring: typeof recurringTasks.$inferSelect;
  item: typeof scheduledItems.$inferSelect;
};

async function generateForOne(row: ActiveRow, now: Date): Promise<number> {
  const { recurring, item } = row;
  if (!item.rrule) return 0;

  const horizon = new Date(now.getTime() + recurring.generateAheadDays * DAY_MS);
  // Half-open window: never regenerate at or before last_generated_at.
  const from = recurring.lastGeneratedAt
    ? new Date(recurring.lastGeneratedAt.getTime() + 1)
    : item.startsAt;
  if (from > horizon) return 0;

  const dates = expandRRuleString(item.rrule, from, horizon);
  const pool = recurring.rotationPool ?? null;
  let rotationIndex = recurring.rotationIndex;
  let created = 0;

  for (const date of dates) {
    const occurrenceDate = date.toISOString().slice(0, 10);
    const assignedTo =
      pool && pool.length > 0 ? (pool[rotationIndex % pool.length] ?? null) : item.assigneeMemberId;

    const didCreate = await withTransaction(async (tx) => {
      const existing = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(eq(tasks.recurringTaskId, recurring.id), eq(tasks.occurrenceDate, occurrenceDate)),
        )
        .limit(1);
      if (existing.length > 0) return false;

      const [si] = await tx
        .insert(scheduledItems)
        .values({
          householdId: item.householdId,
          type: 'task',
          title: item.title,
          description: item.description,
          startsAt: date,
          allDay: true,
          unskippable: item.unskippable,
          assigneeMemberId: assignedTo,
          createdBy: item.createdBy,
        })
        .returning();
      await tx.insert(tasks).values({
        scheduledItemId: si!.id,
        recurringTaskId: recurring.id,
        occurrenceDate,
        assignedTo,
      });
      // Advance + persist rotation inside the same transaction (fairness under retries).
      if (pool && pool.length > 0) {
        await tx
          .update(recurringTasks)
          .set({ rotationIndex: rotationIndex + 1 })
          .where(eq(recurringTasks.id, recurring.id));
      }
      return true;
    }).catch((error) => {
      // Unique (recurring_task_id, occurrence_date) backstop — treat as already generated.
      logger.warn('generation conflict', {
        recurringTaskId: recurring.id,
        occurrenceDate,
        error: String(error),
      });
      return false;
    });

    if (didCreate) {
      created += 1;
      if (pool && pool.length > 0) rotationIndex += 1;
    }
  }

  // Advance the high-water mark regardless (idempotent boundary).
  await db
    .update(recurringTasks)
    .set({ lastGeneratedAt: horizon })
    .where(eq(recurringTasks.id, recurring.id));

  if (created > 0) {
    await broadcast(householdChannel(item.householdId), {
      type: RealtimeEvents.calendarChanged,
      payload: { recurringTaskId: recurring.id, generated: created },
    });
  }
  return created;
}

export async function generateRecurringTasks(
  options: GenerationOptions = {},
): Promise<GenerationMetrics> {
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const acquired = await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
  if (!acquired) {
    logger.info('recurring-task generation skipped (lock held)');
    return { skipped: true, recurringTasks: 0, generated: 0, errors: 0 };
  }

  try {
    const conditions = [eq(recurringTasks.isActive, true), eq(scheduledItems.isActive, true)];
    if (options.householdId) conditions.push(eq(scheduledItems.householdId, options.householdId));

    const actives = await db
      .select({ recurring: recurringTasks, item: scheduledItems })
      .from(recurringTasks)
      .innerJoin(scheduledItems, eq(scheduledItems.id, recurringTasks.scheduledItemId))
      .where(and(...conditions));

    let generated = 0;
    let errors = 0;
    for (const row of actives) {
      try {
        generated += await generateForOne(row, now);
      } catch (error) {
        errors += 1;
        logger.error('recurring-task generation error', {
          recurringTaskId: row.recurring.id,
          error: String(error),
        });
      }
    }
    logger.info('recurring-task generation', { recurringTasks: actives.length, generated, errors });
    const metrics = { skipped: false, recurringTasks: actives.length, generated, errors };
    recordWorkerRun('recurring-task-generator', Date.now() - startedAt, metrics);
    return metrics;
  } finally {
    await releaseLock(LOCK_KEY);
  }
}

/** Register the periodic scheduler (hourly). Returns a stop function. */
export function registerGenerationScheduler(intervalMs = 60 * 60 * 1000): () => void {
  const timer = setInterval(() => {
    generateRecurringTasks().catch((error) =>
      logger.error('scheduled generation failed', { error: String(error) }),
    );
  }, intervalMs);
  return () => clearInterval(timer);
}
