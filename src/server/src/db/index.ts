// Drizzle client. In production it wraps the shared postgres.js connection (db/client.ts);
// under NODE_ENV=test it uses an embedded in-process Postgres (pglite, WASM) so integration
// tests run with real Postgres semantics — constraints, transactions, migrations — without
// any standalone engine, port, or localhost service. The query API is identical either way,
// so the rest of the codebase is unaware of which driver is active. `casing: 'snake_case'`
// matches drizzle.config.ts so generated SQL and runtime queries agree.

import { sql as rawSql } from 'drizzle-orm';
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { config } from '../config.ts';
import * as schema from './schema/index.ts';

export type Database = PostgresJsDatabase<typeof schema>;

// Held only in test mode so closeDatabase() can release the embedded instance.
let embeddedClient: { close: () => Promise<void> } | null = null;

async function createDatabase(): Promise<Database> {
  if (config.nodeEnv === 'test') {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const client = new PGlite();
    embeddedClient = client;
    // The pglite driver exposes the same query builder; cast to the shared Database type.
    return drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database;
  }
  const { sql } = await import('./client.ts');
  return drizzlePostgres(sql, { schema, casing: 'snake_case' });
}

export const db = await createDatabase();

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Run [fn] inside a transaction; rolls back on throw. */
export function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

/** Apply all migrations to the active database (driver-aware). Used by the prod migrate
 *  script and the test bootstrap. */
export async function applyMigrations(migrationsFolder: string): Promise<void> {
  if (config.nodeEnv === 'test') {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    // biome-ignore lint/suspicious/noExplicitAny: migrator types are driver-specific.
    await migrate(db as any, { migrationsFolder });
    return;
  }
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  // biome-ignore lint/suspicious/noExplicitAny: migrator types are driver-specific.
  await migrate(db as any, { migrationsFolder });
}

/** Liveness probe for /health (driver-agnostic). Resolves false within ~3s; never throws. */
export async function pingDatabase(): Promise<boolean> {
  const query = db
    .execute(rawSql`SELECT 1`)
    .then(() => true)
    .catch(() => false);
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000));
  return Promise.race([query, timeout]);
}

/** Release the embedded test database (no-op in production). */
export async function closeDatabase(): Promise<void> {
  await embeddedClient?.close().catch(() => {});
}
