// recordValueChange / recordValueChanges: write append-only from→to history rows for
// sensitive/critical fields. Values are serialized to text. SECRETS ARE NEVER STORED —
// for secret fields (e.g. password_hash) record presence-of-change with REDACTED.

import { type Database, db as defaultDb, type Tx } from '../db/index.ts';
import { valueChangeHistory } from '../db/schema/index.ts';

/** Marker used in place of a secret value (records that it changed, not what it became). */
export const REDACTED = '<redacted>';

export interface ValueChange {
  entityType: string;
  entityId: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy?: string | null;
  householdId?: string | null;
}

/** Serialize an arbitrary value to the text form stored in history. */
export function serializeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/** Write a single value-change row. */
export async function recordValueChange(
  change: ValueChange,
  database: Database | Tx = defaultDb,
): Promise<void> {
  await database.insert(valueChangeHistory).values({
    entityType: change.entityType,
    entityId: change.entityId,
    fieldName: change.fieldName,
    oldValue: change.oldValue,
    newValue: change.newValue,
    changedBy: change.changedBy ?? null,
    householdId: change.householdId ?? null,
  });
}

export interface FieldDiffParams {
  entityType: string;
  entityId: string;
  changedBy?: string | null;
  householdId?: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** Sensitive field names to capture (only changed ones are written). */
  fields: string[];
  /** Field names whose values are secret — recorded as REDACTED, never raw. */
  secretFields?: string[];
}

/** Diff `before`/`after` over `fields`; write one row per changed field. Returns count. */
export async function recordValueChanges(
  params: FieldDiffParams,
  database: Database | Tx = defaultDb,
): Promise<number> {
  const secrets = new Set(params.secretFields ?? []);
  const rows: Array<typeof valueChangeHistory.$inferInsert> = [];

  for (const field of params.fields) {
    const before = params.before[field];
    const after = params.after[field];
    if (Object.is(before, after)) continue;
    const isSecret = secrets.has(field);
    rows.push({
      entityType: params.entityType,
      entityId: params.entityId,
      fieldName: field,
      oldValue: isSecret ? (before === undefined ? null : REDACTED) : serializeValue(before),
      newValue: isSecret ? REDACTED : serializeValue(after),
      changedBy: params.changedBy ?? null,
      householdId: params.householdId ?? null,
    });
  }

  if (rows.length === 0) return 0;
  await database.insert(valueChangeHistory).values(rows);
  return rows.length;
}
