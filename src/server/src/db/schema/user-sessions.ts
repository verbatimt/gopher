// Refresh-token sessions for device tracking. Stores only the SHA-256 HASH of the refresh
// token (never the raw token). One row per active session; rotation replaces the hash.
// `push_endpoint` is an optional self-hosted UnifiedPush endpoint for EP-0042.

import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

export const userSessions = pgTable('user_sessions', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .references(() => users.id),
  refreshTokenHash: text().notNull().unique(),
  deviceLabel: text(),
  pushEndpoint: text(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  lastUsedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
