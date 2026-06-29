// Reward rules (EP-0027): a named point value awarded for completing a task. Referenced by
// `recurring_tasks.reward_rule_id` / `tasks.reward_rule_id` (plain uuid, no FK) so a rule
// can be soft-deactivated while referencing tasks keep resolving its id.

import { integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../_shared.ts';
import { households } from './households.ts';

export const rewardRules = pgTable('reward_rules', {
  ...baseColumns,
  householdId: uuid()
    .notNull()
    .references(() => households.id),
  name: text().notNull(),
  points: integer().notNull().default(0),
});
