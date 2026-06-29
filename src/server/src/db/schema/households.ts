// Tenancy root (households) and its membership (household_members). A member's user_id is
// nullable: NULL ⇒ a managed/dependent profile with no login. Exactly one owner per
// household, enforced by a partial unique index; the owner cannot be removed (EP-0014).

import { sql } from 'drizzle-orm';
import { boolean, date, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../_shared.ts';
import { roles } from './roles.ts';
import { users } from './users.ts';

/** Default gateable feature modules for a new household (dashboard is always-on). */
export const DEFAULT_ACTIVE_MODULES = [
  'calendar',
  'tasks',
  'medications',
  'rewards',
  'finance',
  'meals',
] as const;

export const households = pgTable('households', {
  ...baseColumns,
  name: text().notNull(),
  timezone: text().notNull().default('UTC'),
  locale: text().notNull().default('en-US'),
  activeModules: text('active_modules')
    .array()
    .notNull()
    .default(sql`'{calendar,tasks,medications,rewards,finance,meals}'::text[]`),
  rewardCurrencyName: text().notNull().default('Points'),
  createdBy: uuid(),
});

export const householdMembers = pgTable(
  'household_members',
  {
    ...baseColumns,
    householdId: uuid()
      .notNull()
      .references(() => households.id),
    userId: uuid().references(() => users.id), // NULL ⇒ managed/dependent profile
    displayName: text().notNull(),
    avatarUrl: text(),
    dateOfBirth: date(),
    isManaged: boolean().notNull().default(false),
    isOwner: boolean().notNull().default(false),
    roleId: uuid()
      .notNull()
      .references(() => roles.id),
  },
  (t) => [
    // At most one owner per household.
    uniqueIndex('household_members_one_owner_uq').on(t.householdId).where(sql`${t.isOwner} = true`),
  ],
);
