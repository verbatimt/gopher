// Email invitations to join a household. Single-use, hashed token, 7-day validity
// (applied at creation, EP-0014). State is derived from accepted_at / revoked_at /
// expires_at. A partial unique index prevents duplicate PENDING invites per (household,
// email) while still allowing a fresh invite after a prior one resolves.

import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { householdMembers, households } from './households.ts';
import { roles } from './roles.ts';
import { users } from './users.ts';

export const householdInvites = pgTable(
  'household_invites',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id),
    invitedBy: uuid().references(() => users.id),
    email: text().notNull(),
    tokenHash: text().notNull().unique(),
    roleId: uuid()
      .notNull()
      .references(() => roles.id),
    // EP-0050: when set, accepting links the new login to this existing managed member instead
    // of creating a fresh one (NULL ⇒ original create-new-member behavior).
    memberId: uuid().references(() => householdMembers.id),
    acceptedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // No duplicate *pending* invite for the same household+email.
    uniqueIndex('household_invites_pending_uq')
      .on(t.householdId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
  ],
);
