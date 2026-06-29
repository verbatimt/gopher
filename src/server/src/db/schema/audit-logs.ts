// Append-only action log (audit tier 1). One row per audited action: who did what to
// which entity, with request context. Nullable actor/household support system-level
// events. No soft-delete/updated_at — audit rows are immutable.

import { index, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid(), // null for system-level (cross-tenant) actions
    actorUserId: uuid(),
    actorMemberId: uuid(),
    action: text().notNull(),
    entityType: text(),
    entityId: uuid(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: inet(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_household_created_idx').on(t.householdId, t.createdAt),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
  ],
);
