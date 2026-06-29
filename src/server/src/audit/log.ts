// auditLog(event): write one append-only row to audit_logs. Accepts a transaction handle
// so it can participate in the same transaction where integrity matters (e.g. a role
// change + its history). On the happy path callers may fire-and-forget (await optional).

import { type Database, db as defaultDb, type Tx } from '../db/index.ts';
import { auditLogs } from '../db/schema/index.ts';

export interface AuditEvent {
  /** An `AuditActions.*` constant (never a literal). */
  action: string;
  householdId?: string | null;
  actorUserId?: string | null;
  actorMemberId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function auditLog(
  event: AuditEvent,
  database: Database | Tx = defaultDb,
): Promise<void> {
  await database.insert(auditLogs).values({
    action: event.action,
    householdId: event.householdId ?? null,
    actorUserId: event.actorUserId ?? null,
    actorMemberId: event.actorMemberId ?? null,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    metadata: event.metadata ?? {},
    ipAddress: event.ipAddress ?? null,
    userAgent: event.userAgent ?? null,
  });
}
