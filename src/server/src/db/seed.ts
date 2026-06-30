// Idempotent seed runner scaffold. Re-running must not duplicate data — each seed step
// checks for existing rows (or uses upserts) before inserting. Domain EPs add their own
// seed steps here. Invoked manually (e.g. `bun run src/db/seed.ts`).

import { sql } from './client.ts';
import { seedMeasurementTypes } from './seeds/measurement-types.ts';
import { seedRoles } from './seeds/roles.ts';

interface SeedStep {
  name: string;
  run: () => Promise<void>;
}

// Domain EPs append steps to this list (each idempotent).
const steps: SeedStep[] = [
  { name: 'roles & permissions', run: () => seedRoles() },
  { name: 'measurement types', run: () => seedMeasurementTypes() },
];

async function seed(): Promise<void> {
  if (steps.length === 0) {
    console.log('[seed] no seed steps registered yet.');
    return;
  }
  for (const step of steps) {
    console.log(`[seed] ${step.name}`);
    await step.run();
  }
  console.log('[seed] done.');
}

if (import.meta.main) {
  try {
    await seed();
  } catch (error) {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

export { type SeedStep, seed };
