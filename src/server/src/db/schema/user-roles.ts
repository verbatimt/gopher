// Role grants to users. `household_id = NULL` denotes a SYSTEM-LEVEL grant (platform
// admin/support); a non-null value scopes the grant to one household. Unique per
// (user, role, household) so a user can hold one system grant and per-household grants.

import { pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { roles } from './roles.ts';
import { users } from './users.ts';

export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    roleId: uuid()
      .notNull()
      .references(() => roles.id),
    householdId: uuid(), // NULL ⇒ system-level
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid(),
  },
  (t) => [unique('user_roles_user_role_household_uq').on(t.userId, t.roleId, t.householdId)],
);
