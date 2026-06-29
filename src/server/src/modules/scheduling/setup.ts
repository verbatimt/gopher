// Per-household scheduling setup: seed the default time-of-day windows. Idempotent (unique
// on household+name). Called from the registration bootstrap (EP-0011).

import { type Database, db as defaultDb, type Tx } from '../../db/index.ts';
import { timeWindows } from '../../db/schema/index.ts';

const DEFAULT_WINDOWS = [
  { name: 'Morning', startMinute: 6 * 60, endMinute: 12 * 60 },
  { name: 'Afternoon', startMinute: 12 * 60, endMinute: 18 * 60 },
  { name: 'Evening', startMinute: 18 * 60, endMinute: 23 * 60 },
];

export async function seedDefaultTimeWindows(
  householdId: string,
  database: Database | Tx = defaultDb,
): Promise<void> {
  for (const window of DEFAULT_WINDOWS) {
    await database
      .insert(timeWindows)
      .values({ householdId, ...window })
      .onConflictDoNothing({ target: [timeWindows.householdId, timeWindows.name] });
  }
}
