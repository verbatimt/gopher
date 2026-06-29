// Rewards ledger (EP-0027): per-member balances, a redeemable catalog, and an append-only
// transaction ledger. Every balance mutation writes `balance_after` and is applied inside a
// row-locked transaction so balances never go negative or diverge. `task_id` is a plain uuid
// (no FK) used for the EP-0028 per-task earn idempotency guard.

import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../_shared.ts';
import { householdMembers, households } from './households.ts';

export const rewards = pgTable('rewards', {
  ...baseColumns,
  householdId: uuid()
    .notNull()
    .references(() => households.id),
  memberId: uuid()
    .notNull()
    .unique()
    .references(() => householdMembers.id),
  balance: integer().notNull().default(0),
  lifetimeEarned: integer().notNull().default(0),
  lifetimeRedeemed: integer().notNull().default(0),
});

export const rewardStoreItems = pgTable('reward_store_items', {
  ...baseColumns,
  householdId: uuid()
    .notNull()
    .references(() => households.id),
  name: text().notNull(),
  description: text(),
  pointCost: integer().notNull(),
  redemptionCap: integer(), // null ⇒ unlimited
  redemptionCount: integer().notNull().default(0),
  cooldownMinutes: integer(), // null ⇒ no cooldown
});

export const rewardTransactions = pgTable(
  'reward_transactions',
  {
    ...baseColumns,
    householdId: uuid()
      .notNull()
      .references(() => households.id),
    memberId: uuid()
      .notNull()
      .references(() => householdMembers.id),
    type: text().notNull(), // earn | redeem | adjustment
    amount: integer().notNull(), // +earn/+adj, −redeem
    balanceAfter: integer().notNull(),
    taskId: uuid(), // references tasks (no FK — preserves id across rule lifecycle)
    storeItemId: uuid().references(() => rewardStoreItems.id),
    status: text().notNull().default('approved'), // pending | approved | rejected
    notes: text(),
    createdBy: uuid(),
  },
  (t) => [
    check('reward_transactions_type_chk', sql`${t.type} in ('earn','redeem','adjustment')`),
    check('reward_transactions_status_chk', sql`${t.status} in ('pending','approved','rejected')`),
    index('reward_transactions_member_idx').on(t.memberId, t.createdAt),
    index('reward_transactions_task_idx').on(t.taskId),
  ],
);

// Recurring point allowances (EP-0028): a scheduled point grant per member. The granter
// worker expands `rrule` and grants one `earn` per occurrence in the half-open window
// (last_granted_at, now], advancing `last_granted_at` like the EP-0022 generation boundary.
export const rewardAllowances = pgTable('reward_allowances', {
  ...baseColumns,
  householdId: uuid()
    .notNull()
    .references(() => households.id),
  memberId: uuid()
    .notNull()
    .references(() => householdMembers.id),
  name: text(),
  points: integer().notNull(),
  rrule: text().notNull(), // cadence (RRULE incl. DTSTART), expanded by EP-0018
  lastGrantedAt: timestamp({ withTimezone: true }),
});
