// Role definitions (reference data). Seeded idempotently by db/seeds/roles.ts. Realizes
// the context §4 abstraction (supervising/unsupervised/supervised) plus system roles.

import { pgTable, text } from 'drizzle-orm/pg-core';
import { baseColumns } from '../_shared.ts';

export const roles = pgTable('roles', {
  ...baseColumns,
  name: text().notNull().unique(),
  description: text(),
});
