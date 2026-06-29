// Medication tracking business logic (EP-0024): schedule CRUD (supervisor-gated writes,
// value-change capture on dosage), role-aware listing (supervisors see all; others see
// only their own schedules), dose logging with RRULE-derived dose-window validation, and
// refills that atomically increment stock. Reminder generation / refill-needed triggers /
// missed transitions / compliance live in EP-0025.

import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { recordValueChanges } from '../../audit/value-change.ts';
import { effectiveRole, medicationScope } from '../../auth/visibility.ts';
import { db, withTransaction } from '../../db/index.ts';
import { medicationDoses, medicationRefills, medicationSchedules } from '../../db/schema/index.ts';
import { ForbiddenError, InvalidError, NotFoundError } from '../../http/errors.ts';
import { expandRRuleString, withDtstart } from '../../recurrence/rrule.ts';
import { notifyRefillNeeded } from '../../workers/medication-reminders.ts';

export interface ActorContext {
  userId: string;
  householdId: string;
  memberId: string | null;
  roles: string[];
}

type ScheduleRow = typeof medicationSchedules.$inferSelect;

const PAGE_SIZE = 50;

/** Writes (create/update schedule) are supervisor-only (system bypasses). */
function assertSupervisor(roles: string[]): void {
  const role = effectiveRole(roles);
  if (role !== 'supervising' && role !== 'system') {
    throw new ForbiddenError('Only supervisors can manage medication schedules.');
  }
}

/** Validate + normalize a dosing RRULE pattern anchored at the schedule start date. */
function normalizeRrule(rrule: string, startDate: string): string {
  const anchor = new Date(`${startDate}T00:00:00.000Z`);
  if (Number.isNaN(anchor.getTime())) throw new InvalidError('Invalid start date.');
  try {
    return withDtstart(rrule, anchor);
  } catch {
    throw new InvalidError('Invalid dosing schedule (RRULE).');
  }
}

function scheduleDto(s: ScheduleRow) {
  return {
    id: s.id,
    householdId: s.householdId,
    memberId: s.memberId,
    medicationName: s.medicationName,
    dosageAmount: s.dosageAmount,
    dosageUnit: s.dosageUnit,
    rrule: s.rrule,
    startDate: s.startDate,
    endDate: s.endDate,
    stockQuantity: s.stockQuantity,
    refillThreshold: s.refillThreshold,
    doseWindowMinutes: s.doseWindowMinutes,
    notes: s.notes,
    isActive: s.isActive,
  };
}

export interface CreateScheduleInput {
  memberId: string;
  medicationName: string;
  dosageAmount: number;
  dosageUnit: string;
  rrule: string;
  startDate: string;
  endDate?: string;
  stockQuantity?: number;
  refillThreshold?: number;
  doseWindowMinutes?: number;
  notes?: string;
}

export async function createSchedule(ctx: ActorContext, input: CreateScheduleInput) {
  assertSupervisor(ctx.roles);
  const rrule = normalizeRrule(input.rrule, input.startDate);
  const [row] = await db
    .insert(medicationSchedules)
    .values({
      householdId: ctx.householdId,
      memberId: input.memberId,
      medicationName: input.medicationName,
      dosageAmount: String(input.dosageAmount),
      dosageUnit: input.dosageUnit,
      rrule,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      stockQuantity: String(input.stockQuantity ?? 0),
      refillThreshold: String(input.refillThreshold ?? 0),
      doseWindowMinutes: input.doseWindowMinutes ?? 120,
      notes: input.notes ?? null,
    })
    .returning();
  return scheduleDto(row!);
}

async function loadSchedule(householdId: string, scheduleId: string): Promise<ScheduleRow | null> {
  const [row] = await db
    .select()
    .from(medicationSchedules)
    .where(
      and(
        eq(medicationSchedules.id, scheduleId),
        eq(medicationSchedules.householdId, householdId),
        eq(medicationSchedules.isActive, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Load a schedule enforcing role scope: non-supervisors may only touch their own. */
async function loadScheduleScoped(ctx: ActorContext, scheduleId: string): Promise<ScheduleRow> {
  const row = await loadSchedule(ctx.householdId, scheduleId);
  if (!row) throw new NotFoundError('Medication schedule not found.');
  if (medicationScope(ctx.roles) === 'self' && row.memberId !== ctx.memberId) {
    throw new NotFoundError('Medication schedule not found.');
  }
  return row;
}

export async function listSchedules(ctx: ActorContext) {
  const conditions = [
    eq(medicationSchedules.householdId, ctx.householdId),
    eq(medicationSchedules.isActive, true),
  ];
  // Supervisors see the whole household; everyone else only their own schedules.
  if (medicationScope(ctx.roles) === 'self') {
    conditions.push(
      eq(medicationSchedules.memberId, ctx.memberId ?? '00000000-0000-0000-0000-000000000000'),
    );
  }
  const rows = await db
    .select()
    .from(medicationSchedules)
    .where(and(...conditions))
    .orderBy(desc(medicationSchedules.createdAt));
  return rows.map(scheduleDto);
}

export async function getSchedule(ctx: ActorContext, scheduleId: string) {
  return scheduleDto(await loadScheduleScoped(ctx, scheduleId));
}

export interface UpdateScheduleInput {
  medicationName?: string;
  dosageAmount?: number;
  dosageUnit?: string;
  rrule?: string;
  startDate?: string;
  endDate?: string | null;
  stockQuantity?: number;
  refillThreshold?: number;
  doseWindowMinutes?: number;
  notes?: string;
}

export async function updateSchedule(
  ctx: ActorContext,
  scheduleId: string,
  patch: UpdateScheduleInput,
) {
  assertSupervisor(ctx.roles);
  const existing = await loadSchedule(ctx.householdId, scheduleId);
  if (!existing) throw new NotFoundError('Medication schedule not found.');

  const updates: Partial<typeof medicationSchedules.$inferInsert> = { updatedAt: new Date() };
  if (patch.medicationName !== undefined) updates.medicationName = patch.medicationName;
  if (patch.dosageAmount !== undefined) updates.dosageAmount = String(patch.dosageAmount);
  if (patch.dosageUnit !== undefined) updates.dosageUnit = patch.dosageUnit;
  if (patch.startDate !== undefined) updates.startDate = patch.startDate;
  if (patch.endDate !== undefined) updates.endDate = patch.endDate;
  if (patch.stockQuantity !== undefined) updates.stockQuantity = String(patch.stockQuantity);
  if (patch.refillThreshold !== undefined) updates.refillThreshold = String(patch.refillThreshold);
  if (patch.doseWindowMinutes !== undefined) updates.doseWindowMinutes = patch.doseWindowMinutes;
  if (patch.notes !== undefined) updates.notes = patch.notes;
  // Re-anchor the dosing RRULE if the pattern or the start date changed.
  if (patch.rrule !== undefined || patch.startDate !== undefined) {
    updates.rrule = normalizeRrule(
      patch.rrule ?? existing.rrule,
      patch.startDate ?? existing.startDate,
    );
  }

  return withTransaction(async (tx) => {
    const [updated] = await tx
      .update(medicationSchedules)
      .set(updates)
      .where(eq(medicationSchedules.id, scheduleId))
      .returning();

    // Dosage is sensitive: capture from→to on dosage_amount / dosage_unit (EP-0009).
    await recordValueChanges(
      {
        entityType: 'medication_schedule',
        entityId: scheduleId,
        changedBy: ctx.userId,
        householdId: ctx.householdId,
        before: { dosageAmount: existing.dosageAmount, dosageUnit: existing.dosageUnit },
        after: { dosageAmount: updated!.dosageAmount, dosageUnit: updated!.dosageUnit },
        fields: ['dosageAmount', 'dosageUnit'],
      },
      tx,
    );
    return scheduleDto(updated!);
  });
}

export async function deactivateSchedule(ctx: ActorContext, scheduleId: string) {
  assertSupervisor(ctx.roles);
  const existing = await loadSchedule(ctx.householdId, scheduleId);
  if (!existing) throw new NotFoundError('Medication schedule not found.');
  await db
    .update(medicationSchedules)
    .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(medicationSchedules.id, scheduleId));
  return { deleted: true };
}

// --- Doses ---

function doseDto(d: typeof medicationDoses.$inferSelect) {
  return {
    id: d.id,
    scheduleId: d.scheduleId,
    scheduledAt: d.scheduledAt,
    status: d.status,
    loggedAt: d.loggedAt,
    loggedBy: d.loggedBy,
    notes: d.notes,
  };
}

export interface LogDoseInput {
  takenAt?: string;
  status?: 'taken' | 'skipped';
  notes?: string;
}

/**
 * Log a dose. The dose must align with a scheduled occurrence within the schedule's
 * `dose_window_minutes`; the nearest occurrence from the RRULE becomes the dose's
 * `scheduled_at`. Logging upserts onto the (schedule, scheduled_at) row so a `pending` dose
 * pre-created by the reminder job (EP-0025) is updated rather than duplicated.
 */
export async function logDose(ctx: ActorContext, scheduleId: string, input: LogDoseInput) {
  const schedule = await loadScheduleScoped(ctx, scheduleId);

  const ref = input.takenAt ? new Date(input.takenAt) : new Date();
  if (Number.isNaN(ref.getTime())) throw new InvalidError('Invalid dose time.');

  const windowMs = schedule.doseWindowMinutes * 60_000;
  const candidates = expandRRuleString(
    schedule.rrule,
    new Date(ref.getTime() - windowMs),
    new Date(ref.getTime() + windowMs),
  );
  let scheduledAt: Date | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const occ of candidates) {
    const diff = Math.abs(occ.getTime() - ref.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      scheduledAt = occ;
    }
  }
  if (!scheduledAt || bestDiff > windowMs) {
    throw new InvalidError('No scheduled dose within the allowed window.');
  }

  const status = input.status ?? 'taken';
  return withTransaction(async (tx) => {
    const [row] = await tx
      .insert(medicationDoses)
      .values({
        scheduleId,
        scheduledAt,
        status,
        loggedAt: ref,
        loggedBy: ctx.memberId,
        notes: input.notes ?? null,
      })
      .onConflictDoUpdate({
        target: [medicationDoses.scheduleId, medicationDoses.scheduledAt],
        set: {
          status,
          loggedAt: ref,
          loggedBy: ctx.memberId,
          notes: input.notes ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    // EP-0025 refill hook: a taken dose consumes stock (floored at 0); if that crosses the
    // refill threshold, raise a refill-needed notification (once per crossing).
    if (status === 'taken') {
      const dosage = Number(schedule.dosageAmount);
      const before = Number(schedule.stockQuantity);
      const after = Math.max(before - dosage, 0);
      const [updated] = await tx
        .update(medicationSchedules)
        .set({
          stockQuantity: sql`GREATEST(${medicationSchedules.stockQuantity} - ${String(dosage)}::numeric, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(medicationSchedules.id, scheduleId))
        .returning();
      const threshold = Number(schedule.refillThreshold);
      if (before > threshold && after <= threshold) {
        await notifyRefillNeeded(updated!, tx);
      }
    }
    return doseDto(row!);
  });
}

export async function listDoses(ctx: ActorContext, scheduleId: string, page: number) {
  await loadScheduleScoped(ctx, scheduleId);
  const rows = await db
    .select()
    .from(medicationDoses)
    .where(eq(medicationDoses.scheduleId, scheduleId))
    .orderBy(desc(medicationDoses.scheduledAt))
    .limit(PAGE_SIZE)
    .offset((Math.max(1, page) - 1) * PAGE_SIZE);
  return rows.map(doseDto);
}

// --- Refills ---

function refillDto(r: typeof medicationRefills.$inferSelect) {
  return {
    id: r.id,
    scheduleId: r.scheduleId,
    refillDate: r.refillDate,
    quantityAdded: r.quantityAdded,
    loggedBy: r.loggedBy,
    notes: r.notes,
  };
}

export interface LogRefillInput {
  quantityAdded: number;
  refillDate?: string;
  notes?: string;
}

/** Record a refill and atomically increase the schedule's stock by quantity_added. */
export async function logRefill(ctx: ActorContext, scheduleId: string, input: LogRefillInput) {
  const schedule = await loadScheduleScoped(ctx, scheduleId);
  return withTransaction(async (tx) => {
    const [refill] = await tx
      .insert(medicationRefills)
      .values({
        scheduleId,
        refillDate: input.refillDate ?? undefined,
        quantityAdded: String(input.quantityAdded),
        loggedBy: ctx.memberId ?? schedule.memberId,
        notes: input.notes ?? null,
      })
      .returning();
    // Atomic in-DB increment (read-modify-write happens in Postgres, not the app).
    const [updated] = await tx
      .update(medicationSchedules)
      .set({
        stockQuantity: sql`${medicationSchedules.stockQuantity} + ${String(input.quantityAdded)}::numeric`,
        updatedAt: new Date(),
      })
      .where(eq(medicationSchedules.id, scheduleId))
      .returning();
    return { refill: refillDto(refill!), schedule: scheduleDto(updated!) };
  });
}

export async function listRefills(ctx: ActorContext, scheduleId: string, page: number) {
  await loadScheduleScoped(ctx, scheduleId);
  const rows = await db
    .select()
    .from(medicationRefills)
    .where(eq(medicationRefills.scheduleId, scheduleId))
    .orderBy(desc(medicationRefills.refillDate))
    .limit(PAGE_SIZE)
    .offset((Math.max(1, page) - 1) * PAGE_SIZE);
  return rows.map(refillDto);
}

// --- Compliance (EP-0025) ---

export interface ComplianceRange {
  from?: string;
  to?: string;
}

/**
 * Per-schedule adherence over an optional [from, to] window: counts by dose status plus the
 * adherence % = taken / (taken + skipped + missed). Pending (not-yet-resolved) doses are
 * excluded from the denominator. Aggregated in-DB grouped by status (EP-0025).
 */
export async function getCompliance(ctx: ActorContext, scheduleId: string, range: ComplianceRange) {
  await loadScheduleScoped(ctx, scheduleId);

  const conditions = [eq(medicationDoses.scheduleId, scheduleId)];
  if (range.from) conditions.push(gte(medicationDoses.scheduledAt, new Date(range.from)));
  if (range.to) conditions.push(lte(medicationDoses.scheduledAt, new Date(range.to)));

  const grouped = await db
    .select({ status: medicationDoses.status, count: count() })
    .from(medicationDoses)
    .where(and(...conditions))
    .groupBy(medicationDoses.status);

  const counts = { taken: 0, skipped: 0, missed: 0, pending: 0 };
  for (const g of grouped) {
    if (g.status in counts) counts[g.status as keyof typeof counts] = Number(g.count);
  }
  const resolved = counts.taken + counts.skipped + counts.missed;
  const adherencePct = resolved > 0 ? Math.round((counts.taken / resolved) * 1000) / 10 : 0;
  return {
    scheduleId,
    from: range.from ?? null,
    to: range.to ?? null,
    counts,
    total: resolved + counts.pending,
    adherencePct,
  };
}
