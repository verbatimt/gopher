// Login identities. One row per credentialed account. Managed/dependent profiles (no
// login) live in household_members with a null user_id (EP-0013), not here.

import { pgTable, text } from 'drizzle-orm/pg-core';
import { baseColumns } from '../_shared.ts';

export const users = pgTable('users', {
  ...baseColumns,
  email: text().notNull().unique(),
  passwordHash: text().notNull(),
  displayName: text().notNull(),
  avatarUrl: text(),
  // User preferences (editable via PATCH /me, EP-0011).
  timezone: text().notNull().default('UTC'),
  currency: text().notNull().default('USD'),
});
