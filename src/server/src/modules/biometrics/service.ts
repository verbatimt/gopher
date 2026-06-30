// Biometric & vitals business logic (EP-0043). Type catalog (system defaults ∪ household
// custom), role-aware measurement CRUD (supervisors act on any member; everyone else only
// on themselves), dual-value + range-sanity validation, history filtering, server-side trend
// aggregation with target adherence, and per-member targets. numeric is kept as string at
// the DB boundary; aggregates are computed in JS over the pulled series (MVP volumes).

import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { recordValueChanges } from '../../audit/value-change.ts';
import { effectiveRole, vitalsScope } from '../../auth/visibility.ts';
import { db, withTransaction } from '../../db/index.ts';
import {
  biometricMeasurements,
  householdMembers,
  measurementTargets,
  measurementTypes,
} from '../../db/schema/index.ts';
import { ForbiddenError, InvalidError, NotFoundError } from '../../http/errors.ts';

export interface ActorContext {
  userId: string;
  householdId: string;
  memberId: string | null;
  roles: string[];
}

type TypeRow = typeof measurementTypes.$inferSelect;
type MeasurementRow = typeof biometricMeasurements.$inferSelect;
type TargetRow = typeof measurementTargets.$inferSelect;

const PAGE_SIZE = 50;

// Range-sanity caps per known type key (NOT a medical judgment — just rejecting
// physiologically impossible values). Custom types fall back to a generous universal cap.
const SANITY_MAX: Record<string, number> = {
  weight: 2000,
  blood_pressure: 400,
  heart_rate: 400,
  blood_glucose: 2000,
  body_temperature: 250,
  spo2: 100,
};
const DEFAULT_SANITY_MAX = 1_000_000;

function isSupervisor(roles: string[]): boolean {
  const role = effectiveRole(roles);
  return role === 'supervising' || role === 'system';
}

function assertSupervisor(roles: string[]): void {
  if (!isSupervisor(roles)) {
    throw new ForbiddenError('Only supervisors can manage measurement types.');
  }
}

/** Confirm the member exists in the household (active). */
async function loadMember(householdId: string, memberId: string): Promise<void> {
  const [row] = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.id, memberId),
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.isActive, true),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Member not found.');
}

/** Read access to a member's data: supervisors → any member; others → only their own. */
function assertReadAccess(ctx: ActorContext, memberId: string): void {
  if (vitalsScope(ctx.roles) === 'self' && memberId !== ctx.memberId) {
    // Hide existence from non-supervisors (mirror the medications posture).
    throw new NotFoundError('Member not found.');
  }
}

/** Record access: self for anyone with vitals:write; recording for ANOTHER member is
 *  supervisor-gated. */
function assertRecordAccess(ctx: ActorContext, memberId: string): void {
  if (memberId === ctx.memberId) return;
  if (!isSupervisor(ctx.roles)) {
    throw new ForbiddenError('Only supervisors can record measurements for another member.');
  }
}

// --- Measurement types ---

function typeDto(t: TypeRow) {
  return {
    id: t.id,
    householdId: t.householdId,
    key: t.key,
    displayName: t.displayName,
    valueShape: t.valueShape,
    unitDefault: t.unitDefault,
    precision: t.precision,
    minNormal: t.minNormal,
    maxNormal: t.maxNormal,
    isSystemDefault: t.householdId === null,
    isActive: t.isActive,
  };
}

/** Defaults ∪ household-custom, deduped by key (household-custom shadows a same-key default). */
export async function listTypes(ctx: ActorContext) {
  const rows = await db
    .select()
    .from(measurementTypes)
    .where(
      and(
        eq(measurementTypes.isActive, true),
        or(isNull(measurementTypes.householdId), eq(measurementTypes.householdId, ctx.householdId)),
      ),
    )
    .orderBy(asc(measurementTypes.key));
  const byKey = new Map<string, TypeRow>();
  for (const row of rows) {
    const existing = byKey.get(row.key);
    // Prefer the household-custom row over a same-key system default.
    if (!existing || (existing.householdId === null && row.householdId !== null)) {
      byKey.set(row.key, row);
    }
  }
  return [...byKey.values()].map(typeDto);
}

/** Resolve a type for this household by key: household-custom first, then system default. */
async function resolveType(householdId: string, typeKey: string): Promise<TypeRow> {
  const [custom] = await db
    .select()
    .from(measurementTypes)
    .where(
      and(
        eq(measurementTypes.key, typeKey),
        eq(measurementTypes.householdId, householdId),
        eq(measurementTypes.isActive, true),
      ),
    )
    .limit(1);
  if (custom) return custom;
  const [def] = await db
    .select()
    .from(measurementTypes)
    .where(
      and(
        eq(measurementTypes.key, typeKey),
        isNull(measurementTypes.householdId),
        eq(measurementTypes.isActive, true),
      ),
    )
    .limit(1);
  if (def) return def;
  throw new NotFoundError('Measurement type not found.');
}

/** Load a household-custom type by id for management (defaults are not editable here). */
async function loadCustomType(householdId: string, typeId: string): Promise<TypeRow> {
  const [row] = await db
    .select()
    .from(measurementTypes)
    .where(and(eq(measurementTypes.id, typeId), eq(measurementTypes.isActive, true)))
    .limit(1);
  if (!row) throw new NotFoundError('Measurement type not found.');
  if (row.householdId === null) {
    throw new ForbiddenError('System default measurement types are read-only.');
  }
  if (row.householdId !== householdId) throw new NotFoundError('Measurement type not found.');
  return row;
}

export interface CreateTypeInput {
  key: string;
  displayName: string;
  valueShape?: 'single' | 'dual';
  unitDefault: string;
  precision?: number;
  minNormal?: number | null;
  maxNormal?: number | null;
}

export async function createType(ctx: ActorContext, input: CreateTypeInput) {
  assertSupervisor(ctx.roles);
  // Reject a key that collides with an existing household-custom type.
  const [dupe] = await db
    .select({ id: measurementTypes.id })
    .from(measurementTypes)
    .where(
      and(
        eq(measurementTypes.key, input.key),
        eq(measurementTypes.householdId, ctx.householdId),
        eq(measurementTypes.isActive, true),
      ),
    )
    .limit(1);
  if (dupe) throw new InvalidError('A measurement type with that key already exists.');

  const [row] = await db
    .insert(measurementTypes)
    .values({
      householdId: ctx.householdId,
      key: input.key,
      displayName: input.displayName,
      valueShape: input.valueShape ?? 'single',
      unitDefault: input.unitDefault,
      precision: input.precision ?? 1,
      minNormal: input.minNormal != null ? String(input.minNormal) : null,
      maxNormal: input.maxNormal != null ? String(input.maxNormal) : null,
    })
    .returning();
  return typeDto(row!);
}

export interface UpdateTypeInput {
  displayName?: string;
  unitDefault?: string;
  precision?: number;
  minNormal?: number | null;
  maxNormal?: number | null;
}

export async function updateType(ctx: ActorContext, typeId: string, patch: UpdateTypeInput) {
  assertSupervisor(ctx.roles);
  await loadCustomType(ctx.householdId, typeId);
  const updates: Partial<typeof measurementTypes.$inferInsert> = { updatedAt: new Date() };
  if (patch.displayName !== undefined) updates.displayName = patch.displayName;
  if (patch.unitDefault !== undefined) updates.unitDefault = patch.unitDefault;
  if (patch.precision !== undefined) updates.precision = patch.precision;
  if (patch.minNormal !== undefined)
    updates.minNormal = patch.minNormal != null ? String(patch.minNormal) : null;
  if (patch.maxNormal !== undefined)
    updates.maxNormal = patch.maxNormal != null ? String(patch.maxNormal) : null;
  const [row] = await db
    .update(measurementTypes)
    .set(updates)
    .where(eq(measurementTypes.id, typeId))
    .returning();
  return typeDto(row!);
}

export async function deactivateType(ctx: ActorContext, typeId: string) {
  assertSupervisor(ctx.roles);
  await loadCustomType(ctx.householdId, typeId);
  await db
    .update(measurementTypes)
    .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(measurementTypes.id, typeId));
  return { deleted: true };
}

// --- Measurements ---

function measurementDto(m: MeasurementRow, typeKey?: string) {
  return {
    id: m.id,
    householdId: m.householdId,
    memberId: m.memberId,
    typeId: m.typeId,
    typeKey: typeKey ?? null,
    valueNumeric: m.valueNumeric,
    valueSecondary: m.valueSecondary,
    unit: m.unit,
    measuredAt: m.measuredAt,
    notes: m.notes,
    recordedBy: m.recordedBy,
    isActive: m.isActive,
  };
}

/** Validate value_shape (dual requires both components) and range sanity. */
function validateValues(
  type: TypeRow,
  valuePrimary: number,
  valueSecondary: number | null | undefined,
): void {
  if (type.valueShape === 'dual' && (valueSecondary === null || valueSecondary === undefined)) {
    throw new InvalidError(
      `${type.displayName} requires two values (e.g. systolic and diastolic).`,
    );
  }
  if (type.valueShape === 'single' && valueSecondary != null) {
    throw new InvalidError(`${type.displayName} takes a single value.`);
  }
  const cap = SANITY_MAX[type.key] ?? DEFAULT_SANITY_MAX;
  const check = (v: number) => {
    if (!Number.isFinite(v) || v < 0 || v > cap) {
      throw new InvalidError(`Value out of the acceptable range for ${type.displayName}.`);
    }
  };
  check(valuePrimary);
  if (valueSecondary != null) check(valueSecondary);
}

export interface RecordMeasurementInput {
  typeKey: string;
  valueNumeric: number;
  valueSecondary?: number | null;
  unit?: string;
  measuredAt?: string;
  notes?: string;
}

export async function recordMeasurement(
  ctx: ActorContext,
  memberId: string,
  input: RecordMeasurementInput,
) {
  await loadMember(ctx.householdId, memberId);
  assertRecordAccess(ctx, memberId);
  const type = await resolveType(ctx.householdId, input.typeKey);
  validateValues(type, input.valueNumeric, input.valueSecondary);

  const measuredAt = input.measuredAt ? new Date(input.measuredAt) : new Date();
  if (Number.isNaN(measuredAt.getTime())) throw new InvalidError('Invalid measurement time.');

  const [row] = await db
    .insert(biometricMeasurements)
    .values({
      householdId: ctx.householdId,
      memberId,
      typeId: type.id,
      valueNumeric: String(input.valueNumeric),
      valueSecondary: input.valueSecondary != null ? String(input.valueSecondary) : null,
      unit: input.unit ?? type.unitDefault,
      measuredAt,
      notes: input.notes ?? null,
      recordedBy: ctx.memberId,
    })
    .returning();
  return measurementDto(row!, type.key);
}

export interface MeasurementFilter {
  typeKey?: string;
  from?: string;
  to?: string;
  page?: number;
}

export async function listMeasurements(
  ctx: ActorContext,
  memberId: string,
  filter: MeasurementFilter,
) {
  await loadMember(ctx.householdId, memberId);
  assertReadAccess(ctx, memberId);

  const conditions = [
    eq(biometricMeasurements.householdId, ctx.householdId),
    eq(biometricMeasurements.memberId, memberId),
    eq(biometricMeasurements.isActive, true),
  ];
  let typeKey: string | undefined;
  if (filter.typeKey) {
    const type = await resolveType(ctx.householdId, filter.typeKey);
    conditions.push(eq(biometricMeasurements.typeId, type.id));
    typeKey = type.key;
  }
  if (filter.from) conditions.push(gte(biometricMeasurements.measuredAt, new Date(filter.from)));
  if (filter.to) conditions.push(lte(biometricMeasurements.measuredAt, new Date(filter.to)));

  const page = Math.max(1, filter.page ?? 1);
  const rows = await db
    .select()
    .from(biometricMeasurements)
    .where(and(...conditions))
    .orderBy(desc(biometricMeasurements.measuredAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return rows.map((r) => measurementDto(r, typeKey));
}

async function loadMeasurement(
  householdId: string,
  memberId: string,
  measurementId: string,
): Promise<MeasurementRow> {
  const [row] = await db
    .select()
    .from(biometricMeasurements)
    .where(
      and(
        eq(biometricMeasurements.id, measurementId),
        eq(biometricMeasurements.householdId, householdId),
        eq(biometricMeasurements.memberId, memberId),
        eq(biometricMeasurements.isActive, true),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Measurement not found.');
  return row;
}

export async function getMeasurement(ctx: ActorContext, memberId: string, measurementId: string) {
  await loadMember(ctx.householdId, memberId);
  assertReadAccess(ctx, memberId);
  return measurementDto(await loadMeasurement(ctx.householdId, memberId, measurementId));
}

export interface UpdateMeasurementInput {
  valueNumeric?: number;
  valueSecondary?: number | null;
  unit?: string;
  measuredAt?: string;
  notes?: string | null;
}

export async function updateMeasurement(
  ctx: ActorContext,
  memberId: string,
  measurementId: string,
  patch: UpdateMeasurementInput,
) {
  await loadMember(ctx.householdId, memberId);
  assertRecordAccess(ctx, memberId);
  const existing = await loadMeasurement(ctx.householdId, memberId, measurementId);
  const [type] = await db
    .select()
    .from(measurementTypes)
    .where(eq(measurementTypes.id, existing.typeId))
    .limit(1);

  const nextPrimary = patch.valueNumeric ?? Number(existing.valueNumeric);
  const nextSecondary =
    patch.valueSecondary !== undefined
      ? patch.valueSecondary
      : existing.valueSecondary != null
        ? Number(existing.valueSecondary)
        : null;
  if (type) validateValues(type, nextPrimary, nextSecondary);

  const updates: Partial<typeof biometricMeasurements.$inferInsert> = { updatedAt: new Date() };
  if (patch.valueNumeric !== undefined) updates.valueNumeric = String(patch.valueNumeric);
  if (patch.valueSecondary !== undefined)
    updates.valueSecondary = patch.valueSecondary != null ? String(patch.valueSecondary) : null;
  if (patch.unit !== undefined) updates.unit = patch.unit;
  if (patch.notes !== undefined) updates.notes = patch.notes;
  if (patch.measuredAt !== undefined) {
    const when = new Date(patch.measuredAt);
    if (Number.isNaN(when.getTime())) throw new InvalidError('Invalid measurement time.');
    updates.measuredAt = when;
  }

  return withTransaction(async (tx) => {
    const [row] = await tx
      .update(biometricMeasurements)
      .set(updates)
      .where(eq(biometricMeasurements.id, measurementId))
      .returning();
    // Measured values are sensitive health data: capture from→to (EP-0009).
    await recordValueChanges(
      {
        entityType: 'biometric_measurement',
        entityId: measurementId,
        changedBy: ctx.userId,
        householdId: ctx.householdId,
        before: { valueNumeric: existing.valueNumeric, valueSecondary: existing.valueSecondary },
        after: { valueNumeric: row!.valueNumeric, valueSecondary: row!.valueSecondary },
        fields: ['valueNumeric', 'valueSecondary'],
      },
      tx,
    );
    return measurementDto(row!, type?.key);
  });
}

export async function deleteMeasurement(
  ctx: ActorContext,
  memberId: string,
  measurementId: string,
) {
  await loadMember(ctx.householdId, memberId);
  assertRecordAccess(ctx, memberId);
  await loadMeasurement(ctx.householdId, memberId, measurementId);
  await db
    .update(biometricMeasurements)
    .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(biometricMeasurements.id, measurementId));
  return { deleted: true };
}

// --- Trends ---

export interface TrendRange {
  typeKey?: string;
  from?: string;
  to?: string;
}

async function loadTarget(memberId: string, typeId: string): Promise<TargetRow | null> {
  const [row] = await db
    .select()
    .from(measurementTargets)
    .where(and(eq(measurementTargets.memberId, memberId), eq(measurementTargets.typeId, typeId)))
    .limit(1);
  return row ?? null;
}

/**
 * Per-type aggregation over [from,to]: latest, min/max/avg, count, target adherence %, and a
 * compact ordered series for charting. Empty range → zeros / empty series, no error.
 */
export async function getTrends(ctx: ActorContext, memberId: string, range: TrendRange) {
  await loadMember(ctx.householdId, memberId);
  assertReadAccess(ctx, memberId);
  if (!range.typeKey) throw new InvalidError('typeKey is required for trends.');
  const type = await resolveType(ctx.householdId, range.typeKey);

  const conditions = [
    eq(biometricMeasurements.householdId, ctx.householdId),
    eq(biometricMeasurements.memberId, memberId),
    eq(biometricMeasurements.typeId, type.id),
    eq(biometricMeasurements.isActive, true),
  ];
  if (range.from) conditions.push(gte(biometricMeasurements.measuredAt, new Date(range.from)));
  if (range.to) conditions.push(lte(biometricMeasurements.measuredAt, new Date(range.to)));

  const rows = await db
    .select()
    .from(biometricMeasurements)
    .where(and(...conditions))
    .orderBy(asc(biometricMeasurements.measuredAt));

  const series = rows.map((r) => ({
    measuredAt: r.measuredAt,
    value: Number(r.valueNumeric),
    valueSecondary: r.valueSecondary != null ? Number(r.valueSecondary) : null,
  }));

  const base = {
    memberId,
    typeKey: type.key,
    from: range.from ?? null,
    to: range.to ?? null,
    count: series.length,
    latest: null as null | (typeof series)[number],
    min: null as number | null,
    max: null as number | null,
    avg: null as number | null,
    adherencePct: 0,
    series,
  };
  if (series.length === 0) return base;

  const values = series.map((s) => s.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const round = (n: number) => Number(n.toFixed(type.precision));
  const avg = round(values.reduce((a, b) => a + b, 0) / values.length);

  // Adherence band: target range if set, else the type's normal band; null bound ⇒ open side.
  const target = await loadTarget(memberId, type.id);
  const lo =
    target?.minTarget != null
      ? Number(target.minTarget)
      : type.minNormal != null
        ? Number(type.minNormal)
        : null;
  const hi =
    target?.maxTarget != null
      ? Number(target.maxTarget)
      : type.maxNormal != null
        ? Number(type.maxNormal)
        : null;
  let adherencePct = 0;
  if (lo != null || hi != null) {
    const within = values.filter((v) => (lo == null || v >= lo) && (hi == null || v <= hi)).length;
    adherencePct = Math.round((within / values.length) * 1000) / 10;
  }

  return {
    ...base,
    latest: series[series.length - 1]!,
    min: round(min),
    max: round(max),
    avg,
    adherencePct,
  };
}

// --- Targets ---

function targetDto(t: TargetRow, typeKey?: string) {
  return {
    id: t.id,
    memberId: t.memberId,
    typeId: t.typeId,
    typeKey: typeKey ?? null,
    minTarget: t.minTarget,
    maxTarget: t.maxTarget,
    goalValue: t.goalValue,
  };
}

export async function listTargets(ctx: ActorContext, memberId: string) {
  await loadMember(ctx.householdId, memberId);
  assertReadAccess(ctx, memberId);
  const rows = await db
    .select({ target: measurementTargets, key: measurementTypes.key })
    .from(measurementTargets)
    .innerJoin(measurementTypes, eq(measurementTypes.id, measurementTargets.typeId))
    .where(
      and(
        eq(measurementTargets.householdId, ctx.householdId),
        eq(measurementTargets.memberId, memberId),
      ),
    );
  return rows.map((r) => targetDto(r.target, r.key));
}

export interface UpsertTargetInput {
  minTarget?: number | null;
  maxTarget?: number | null;
  goalValue?: number | null;
}

/** Upsert a member's target for a type. Supervisor for any member; an unsupervised_user may
 *  set their own (supervised users cannot set targets — supervisor-managed). */
export async function upsertTarget(
  ctx: ActorContext,
  memberId: string,
  typeKey: string,
  input: UpsertTargetInput,
) {
  await loadMember(ctx.householdId, memberId);
  const role = effectiveRole(ctx.roles);
  const selfUnsupervised = role === 'unsupervised' && memberId === ctx.memberId;
  if (!isSupervisor(ctx.roles) && !selfUnsupervised) {
    throw new ForbiddenError('Not allowed to set targets for this member.');
  }
  const type = await resolveType(ctx.householdId, typeKey);

  const values = {
    householdId: ctx.householdId,
    memberId,
    typeId: type.id,
    minTarget: input.minTarget != null ? String(input.minTarget) : null,
    maxTarget: input.maxTarget != null ? String(input.maxTarget) : null,
    goalValue: input.goalValue != null ? String(input.goalValue) : null,
  };
  const [row] = await db
    .insert(measurementTargets)
    .values(values)
    .onConflictDoUpdate({
      target: [measurementTargets.memberId, measurementTargets.typeId],
      set: {
        minTarget: values.minTarget,
        maxTarget: values.maxTarget,
        goalValue: values.goalValue,
        updatedAt: new Date(),
      },
    })
    .returning();
  return targetDto(row!, type.key);
}
