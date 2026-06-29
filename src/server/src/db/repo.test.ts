// Integration tests for the generic repository primitives. Runs fully in-process on the embedded DB
// (pglite). Uses the shared app database, migrated once by the test bootstrap.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { createRepository } from './repo.ts';
import * as schema from './schema/index.ts';

const { demoWidgets } = schema;
const repo = createRepository(demoWidgets, db);

// Dedicated household id so cleanup never affects other suites.
const household = '00000000-0000-4000-8000-000000000007';

beforeAll(async () => {
  await db.execute(sql`DELETE FROM demo_widgets WHERE household_id = ${household}`);
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM demo_widgets WHERE household_id = ${household}`);
});

describe('repository primitives (integration)', () => {
  it('create assigns a UUID and active state', async () => {
    const created = await repo.create({ householdId: household, name: 'Widget A' });
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(created.isActive).toBe(true);
    expect(created.deletedAt).toBeNull();
  });

  it('retrieve and listActive return active rows', async () => {
    const created = await repo.create({ householdId: household, name: 'Widget B' });
    expect((await repo.retrieve(created.id))?.name).toBe('Widget B');
    const active = await repo.listActive();
    expect(active.some((w) => w.id === created.id)).toBe(true);
  });

  it('softDelete hides from active reads but retains the data', async () => {
    const created = await repo.create({ householdId: household, name: 'Widget C' });

    expect(await repo.softDelete(created.id)).toBe(true);
    expect(await repo.retrieve(created.id)).toBeNull();

    // Direct query still finds the row (hidden, not erased).
    const raw = await db.select().from(demoWidgets).where(eq(demoWidgets.id, created.id));
    expect(raw.length).toBe(1);
    expect(raw[0]?.isActive).toBe(false);
    expect(raw[0]?.deletedAt).not.toBeNull();

    // Restore un-hides it.
    expect(await repo.restore(created.id)).toBe(true);
    expect(await repo.retrieve(created.id)).not.toBeNull();
  });

  it('update patches fields and bumps updated_at', async () => {
    const created = await repo.create({ householdId: household, name: 'Widget D' });
    const updated = await repo.update(created.id, { name: 'Widget D2' });
    expect(updated?.name).toBe('Widget D2');
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });
});
