// In-app notifications (context §5 Foundation). Recipient-scoped (one member). Polymorphic
// source columns link back to the originating entity. `is_read`/`read_at` track read state.

import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { householdMembers, households } from './households.ts';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id),
    recipientMemberId: uuid()
      .notNull()
      .references(() => householdMembers.id),
    type: text().notNull(),
    title: text().notNull(),
    body: text(),
    isRead: boolean().notNull().default(false),
    readAt: timestamp({ withTimezone: true }),
    sourceEntityType: text(),
    sourceEntityId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_recipient_created_idx').on(t.recipientMemberId, t.createdAt),
    index('notifications_recipient_read_idx').on(t.recipientMemberId, t.isRead),
  ],
);
