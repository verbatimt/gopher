// Medication reminder + compliance scan worker (EP-0025). Every run (default 15 min) it:
//   1. transitions pending doses whose dose window has fully elapsed → `missed`;
//   2. materializes `pending` dose rows for occurrences in the next 24h and sends exactly
//      one `medication.reminder` (notification + WS) per dose window — deduped by the unique
//      (schedule, scheduled_at) row, so re-runs never repeat a reminder;
//   3. raises a `medication.refill_needed` notification when stock has fallen to/below the
//      refill threshold (deduped against an existing unread refill-needed for the schedule).
// A Redis lock ensures only one replica scans at a time (like EP-0022).

import { and, eq, lt } from 'drizzle-orm';
import { type Database, db, type Tx } from '../db/index.ts';
import { medicationDoses, medicationSchedules, notifications } from '../db/schema/index.ts';
import { notify } from '../modules/notifications/notify.ts';
import { NotificationTypes } from '../modules/notifications/types.ts';
import { logger } from '../observability/logger.ts';
import { recordWorkerRun } from '../observability/metrics.ts';
import { broadcast } from '../realtime/bus.ts';
import { RealtimeEvents, userChannel } from '../realtime/events.ts';
import { expandRRuleString } from '../recurrence/rrule.ts';
import { acquireLock, releaseLock } from './recurring-task-generator.ts';

const LOCK_KEY = 'lock:medication-reminders';
const LOCK_TTL_SECONDS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ScanOptions {
  now?: Date;
  /** Restrict to a single household (tests). */
  householdId?: string;
}

export interface ScanMetrics {
  skipped: boolean;
  schedules: number;
  pendingCreated: number;
  remindersSent: number;
  missed: number;
  refillNeeded: number;
}

type ScheduleRow = typeof medicationSchedules.$inferSelect;

/** End-of-day UTC bound for an inclusive `endDate`, or null when open-ended. */
function endLimit(schedule: ScheduleRow): Date | null {
  return schedule.endDate ? new Date(`${schedule.endDate}T23:59:59.999Z`) : null;
}

/** Mark pending doses whose window has fully elapsed (now > scheduled_at + window) missed. */
async function transitionMissed(schedule: ScheduleRow, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - schedule.doseWindowMinutes * 60_000);
  const rows = await db
    .update(medicationDoses)
    .set({ status: 'missed', updatedAt: new Date() })
    .where(
      and(
        eq(medicationDoses.scheduleId, schedule.id),
        eq(medicationDoses.status, 'pending'),
        lt(medicationDoses.scheduledAt, cutoff),
      ),
    )
    .returning({ id: medicationDoses.id });
  return rows.length;
}

/** Create pending doses for the next 24h and send one reminder per newly-created dose. */
async function scanReminders(
  schedule: ScheduleRow,
  now: Date,
): Promise<{ created: number; reminders: number }> {
  const horizonEnd = new Date(now.getTime() + DAY_MS);
  const cap = endLimit(schedule);
  const to = cap && cap < horizonEnd ? cap : horizonEnd;
  if (to < now) return { created: 0, reminders: 0 };

  const occurrences = expandRRuleString(schedule.rrule, now, to);
  let created = 0;
  let reminders = 0;
  for (const scheduledAt of occurrences) {
    // onConflictDoNothing makes the unique (schedule, scheduled_at) row the dedupe key:
    // the first scan that materializes the dose returns a row (and reminds); later scans
    // find it already present and return nothing.
    const inserted = await db
      .insert(medicationDoses)
      .values({ scheduleId: schedule.id, scheduledAt, status: 'pending' })
      .onConflictDoNothing({
        target: [medicationDoses.scheduleId, medicationDoses.scheduledAt],
      })
      .returning({ id: medicationDoses.id });
    if (inserted.length === 0) continue;
    created += 1;

    await notify({
      householdId: schedule.householdId,
      recipientMemberId: schedule.memberId,
      type: NotificationTypes.medicationReminder,
      title: 'Medication reminder',
      body: `${schedule.medicationName} — ${schedule.dosageAmount}${schedule.dosageUnit}`,
      sourceEntityType: 'medication_schedule',
      sourceEntityId: schedule.id,
    });
    await broadcast(userChannel(schedule.memberId), {
      type: RealtimeEvents.medicationReminder,
      payload: {
        scheduleId: schedule.id,
        scheduledAt,
        medicationName: schedule.medicationName,
      },
    });
    reminders += 1;
  }
  return { created, reminders };
}

/** Raise a refill-needed notification when stock ≤ threshold and none is already pending. */
async function scanRefill(schedule: ScheduleRow): Promise<number> {
  if (Number(schedule.stockQuantity) > Number(schedule.refillThreshold)) return 0;
  const existing = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.sourceEntityId, schedule.id),
        eq(notifications.type, NotificationTypes.medicationRefillNeeded),
        eq(notifications.isRead, false),
      ),
    )
    .limit(1);
  if (existing.length > 0) return 0;
  await notifyRefillNeeded(schedule);
  return 1;
}

/** Shared refill-needed emission (used by the scan and the dose-logging hook). */
export async function notifyRefillNeeded(
  schedule: ScheduleRow,
  database: Database | Tx = db,
): Promise<void> {
  await notify(
    {
      householdId: schedule.householdId,
      recipientMemberId: schedule.memberId,
      type: NotificationTypes.medicationRefillNeeded,
      title: 'Refill needed',
      body: `${schedule.medicationName} is low (${schedule.stockQuantity} left).`,
      sourceEntityType: 'medication_schedule',
      sourceEntityId: schedule.id,
    },
    database,
  );
}

export async function scanMedications(options: ScanOptions = {}): Promise<ScanMetrics> {
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const acquired = await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
  if (!acquired) {
    logger.info('medication scan skipped (lock held)');
    return {
      skipped: true,
      schedules: 0,
      pendingCreated: 0,
      remindersSent: 0,
      missed: 0,
      refillNeeded: 0,
    };
  }

  try {
    const conditions = [eq(medicationSchedules.isActive, true)];
    if (options.householdId)
      conditions.push(eq(medicationSchedules.householdId, options.householdId));
    const schedules = await db
      .select()
      .from(medicationSchedules)
      .where(and(...conditions));

    let pendingCreated = 0;
    let remindersSent = 0;
    let missed = 0;
    let refillNeeded = 0;
    for (const schedule of schedules) {
      try {
        missed += await transitionMissed(schedule, now);
        const r = await scanReminders(schedule, now);
        pendingCreated += r.created;
        remindersSent += r.reminders;
        refillNeeded += await scanRefill(schedule);
      } catch (error) {
        logger.error('medication scan error', { scheduleId: schedule.id, error: String(error) });
      }
    }
    logger.info('medication scan', {
      schedules: schedules.length,
      pendingCreated,
      remindersSent,
      missed,
      refillNeeded,
    });
    const metrics = {
      skipped: false,
      schedules: schedules.length,
      pendingCreated,
      remindersSent,
      missed,
      refillNeeded,
    };
    recordWorkerRun('medication-reminders', Date.now() - startedAt, metrics);
    return metrics;
  } finally {
    await releaseLock(LOCK_KEY);
  }
}

/** Register the periodic scan (every 15 min). Returns a stop function. */
export function registerMedicationScanScheduler(intervalMs = 15 * 60 * 1000): () => void {
  const timer = setInterval(() => {
    scanMedications().catch((error) =>
      logger.error('scheduled medication scan failed', { error: String(error) }),
    );
  }, intervalMs);
  return () => clearInterval(timer);
}
