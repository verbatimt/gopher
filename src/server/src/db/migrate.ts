// Migration runner: applies all pending Drizzle migrations to DATABASE_URL, then exits.
// Forward-only and idempotent (drizzle tracks applied migrations in its journal table).
// Invoked via `bun run db:migrate`.

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from './client.ts';
import { db } from './index.ts';

const migrationsFolder = `${import.meta.dir}/migrations`;

try {
  await migrate(db, { migrationsFolder });
  console.log(`[migrate] applied migrations from ${migrationsFolder}`);
} catch (error) {
  console.error('[migrate] failed:', error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
