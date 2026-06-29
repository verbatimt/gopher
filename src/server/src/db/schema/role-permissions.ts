// Permission grants per role (`resource:action` strings, e.g. `tasks:write`). Unique per
// (role, permission). Hard-deleted (junction-like) — no soft-delete columns.

import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { roles } from './roles.ts';

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid().primaryKey().defaultRandom(),
    roleId: uuid()
      .notNull()
      .references(() => roles.id),
    permission: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('role_permissions_role_permission_uq').on(t.roleId, t.permission)],
);
