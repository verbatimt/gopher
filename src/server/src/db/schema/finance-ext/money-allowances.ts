// Money allowances (EP-0036): a recurring monetary grant per member (distinct from EP-0028
// points allowances). The granter worker records one expense per due date on the cadence,
// advancing last_granted_at like the EP-0022 boundary. numeric(12,2).

import { numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../../_shared.ts';
import { householdMembers, households } from '../households.ts';

export const moneyAllowances = pgTable('money_allowances', {
  ...baseColumns,
  householdId: uuid()
    .notNull()
    .references(() => households.id),
  memberId: uuid()
    .notNull()
    .references(() => householdMembers.id),
  name: text(),
  amount: numeric({ precision: 12, scale: 2 }).notNull(),
  rrule: text().notNull(),
  lastGrantedAt: timestamp({ withTimezone: true }),
});
