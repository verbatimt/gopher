// Biometric & vitals tracking (EP-0043, Tier 8 net-new health domain). A catalog of
// measurement types (system defaults + household-custom), a time-series of recorded readings
// per member, and optional per-member goal ranges. numeric (never float) is used for all
// measured values so quantities are exact (EP-0007). measured_at is timestamptz UTC,
// rendered in the household timezone at the boundary.

import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns } from '../_shared.ts';
import { householdMembers, households } from './households.ts';

// Catalog of measurement types. household_id NULL ⇒ a system/global default (read-only);
// non-NULL ⇒ a household-custom type. value_shape is `single` (one component, e.g. weight)
// or `dual` (two components, e.g. systolic/diastolic blood pressure). min_normal/max_normal
// are for display banding only — they are NOT used for validation (range sanity is separate).
export const measurementTypes = pgTable(
  'measurement_types',
  {
    ...baseColumns,
    householdId: uuid().references(() => households.id), // NULL ⇒ system default
    key: text().notNull(), // slug, e.g. 'weight', 'blood_pressure'
    displayName: text().notNull(),
    valueShape: text().notNull().default('single'),
    unitDefault: text().notNull(),
    precision: integer().notNull().default(1),
    minNormal: numeric(),
    maxNormal: numeric(),
  },
  (t) => [
    check('measurement_types_value_shape_chk', sql`${t.valueShape} in ('single','dual')`),
    check('measurement_types_precision_chk', sql`${t.precision} >= 0 and ${t.precision} <= 6`),
    // System defaults are unique by key (one global 'weight', etc.).
    uniqueIndex('measurement_types_default_key_uq').on(t.key).where(sql`household_id is null`),
    // Household-custom types are unique by key within their household.
    uniqueIndex('measurement_types_household_key_uq')
      .on(t.householdId, t.key)
      .where(sql`household_id is not null`),
  ],
);

// A single recorded reading. value_numeric is the primary component (e.g. weight, systolic);
// value_secondary is the second component for `dual` types (e.g. diastolic). unit is stored
// per reading as entered (no automatic conversion in MVP).
export const biometricMeasurements = pgTable('biometric_measurements', {
  ...baseColumns,
  householdId: uuid()
    .notNull()
    .references(() => households.id),
  memberId: uuid()
    .notNull()
    .references(() => householdMembers.id),
  typeId: uuid()
    .notNull()
    .references(() => measurementTypes.id),
  valueNumeric: numeric({ precision: 10, scale: 2 }).notNull(),
  valueSecondary: numeric({ precision: 10, scale: 2 }),
  unit: text().notNull(),
  measuredAt: timestamp({ withTimezone: true }).notNull(),
  notes: text(),
  recordedBy: uuid().references(() => householdMembers.id),
});

// Optional per-member goal range for a measurement type. Feeds trend adherence. Unique per
// (member, type) so a PUT upserts.
export const measurementTargets = pgTable(
  'measurement_targets',
  {
    ...baseColumns,
    householdId: uuid()
      .notNull()
      .references(() => households.id),
    memberId: uuid()
      .notNull()
      .references(() => householdMembers.id),
    typeId: uuid()
      .notNull()
      .references(() => measurementTypes.id),
    minTarget: numeric(),
    maxTarget: numeric(),
    goalValue: numeric(),
  },
  (t) => [unique('measurement_targets_member_type_uq').on(t.memberId, t.typeId)],
);
