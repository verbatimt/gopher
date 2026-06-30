// Global test bootstrap + teardown (preloaded via bunfig.toml). Under NODE_ENV=test the data
// layer is fully embedded (pglite + ioredis-mock), so here we migrate + seed the shared
// in-process database ONCE before any test file runs, and release the singletons after the
// whole run. Test files share this one embedded database and clean up their own rows.

import { afterAll } from 'bun:test';
import { applyMigrations, closeDatabase } from './db/index.ts';
import { seedMeasurementTypes } from './db/seeds/measurement-types.ts';
import { seedRoles } from './db/seeds/roles.ts';
import { redis } from './redis/client.ts';

await applyMigrations(`${import.meta.dir}/db/migrations`);
await seedRoles();
await seedMeasurementTypes();

afterAll(async () => {
  await redis.quit().catch(() => {});
  await closeDatabase();
});
