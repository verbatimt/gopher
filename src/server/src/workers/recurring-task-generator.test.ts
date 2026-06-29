// Integration tests for the recurring-task generation worker (EP-0022). Runs fully in-process on the
// embedded DB (pglite + ioredis-mock); the worker uses the shared app database.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { asc, eq, sql } from 'drizzle-orm';
import { Roles } from '../auth/permissions.ts';
import { db } from '../db/index.ts';
import * as schema from '../db/schema/index.ts';
import { seedRoles } from '../db/seeds/roles.ts';
import { toRRuleString } from '../recurrence/rrule.ts';
import { acquireLock, generateRecurringTasks, releaseLock } from './recurring-task-generator.ts';

const { households, householdMembers, roles, recurringTasks, scheduledItems, tasks } = schema;

const markerA = 'gen-worker-A';
const markerB = 'gen-worker-B';
const start = new Date('2024-06-01T00:00:00.000Z');

let householdA = '';
let householdB = '';
let memberX = '';
let memberY = '';
let memberZ = '';
let poolRecurringId = '';
let fixedRecurringId = '';

async function cleanup(): Promise<void> {
  for (const marker of [markerA, markerB]) {
    await db.execute(
      sql`DELETE FROM tasks WHERE scheduled_item_id IN (SELECT id FROM scheduled_items WHERE household_id IN (SELECT id FROM households WHERE name = ${marker}))`,
    );
    await db.execute(
      sql`DELETE FROM recurring_tasks WHERE scheduled_item_id IN (SELECT id FROM scheduled_items WHERE household_id IN (SELECT id FROM households WHERE name = ${marker}))`,
    );
    await db.execute(
      sql`DELETE FROM scheduled_items WHERE household_id IN (SELECT id FROM households WHERE name = ${marker})`,
    );
    await db.execute(
      sql`DELETE FROM household_members WHERE household_id IN (SELECT id FROM households WHERE name = ${marker})`,
    );
    await db.execute(sql`DELETE FROM households WHERE name = ${marker}`);
  }
}

async function makeMember(householdId: string, name: string, roleId: string): Promise<string> {
  const [m] = await db
    .insert(householdMembers)
    .values({ householdId, displayName: name, isManaged: true, roleId })
    .returning();
  return m!.id;
}

async function makeRecurring(
  householdId: string,
  opts: { pool?: string[]; assignedTo?: string; aheadDays: number },
): Promise<string> {
  const [item] = await db
    .insert(scheduledItems)
    .values({
      householdId,
      type: 'recurring_task',
      title: 'Chore',
      startsAt: start,
      allDay: true,
      rrule: toRRuleString({ frequency: 'daily' }, start),
      assigneeMemberId: opts.assignedTo ?? null,
    })
    .returning();
  const [recurring] = await db
    .insert(recurringTasks)
    .values({
      scheduledItemId: item!.id,
      rotationPool: opts.pool ?? null,
      generateAheadDays: opts.aheadDays,
    })
    .returning();
  return recurring!.id;
}

async function generatedFor(recurringId: string) {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.recurringTaskId, recurringId))
    .orderBy(asc(tasks.occurrenceDate));
}

beforeAll(async () => {
  await seedRoles(db);
  await cleanup();
  const [roleRow] = await db.select().from(roles).where(eq(roles.name, Roles.supervisedUser));
  const roleId = roleRow!.id;

  const [hA] = await db.insert(households).values({ name: markerA }).returning();
  householdA = hA!.id;
  memberX = await makeMember(householdA, 'X', roleId);
  memberY = await makeMember(householdA, 'Y', roleId);
  poolRecurringId = await makeRecurring(householdA, { pool: [memberX, memberY], aheadDays: 7 });

  const [hB] = await db.insert(households).values({ name: markerB }).returning();
  householdB = hB!.id;
  memberZ = await makeMember(householdB, 'Z', roleId);
  fixedRecurringId = await makeRecurring(householdB, { assignedTo: memberZ, aheadDays: 7 });
});

afterAll(async () => {
  await cleanup();
});

describe('generation', () => {
  it('generates the horizon window with alternating rotation assignees', async () => {
    const metrics = await generateRecurringTasks({ now: start, householdId: householdA });
    expect(metrics.generated).toBeGreaterThanOrEqual(7);

    const generated = await generatedFor(poolRecurringId);
    // Assignees alternate X, Y, X, Y, …
    for (let i = 0; i < generated.length; i++) {
      expect(generated[i]!.assignedTo).toBe(i % 2 === 0 ? memberX : memberY);
    }
    // last_generated_at advanced to the horizon.
    const [recurring] = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.id, poolRecurringId));
    expect(recurring!.lastGeneratedAt).not.toBeNull();
  });

  it('is idempotent: an immediate re-run generates nothing', async () => {
    const before = (await generatedFor(poolRecurringId)).length;
    const metrics = await generateRecurringTasks({ now: start, householdId: householdA });
    expect(metrics.generated).toBe(0);
    const after = (await generatedFor(poolRecurringId)).length;
    expect(after).toBe(before);
  });

  it('generates exactly the new occurrences when the clock advances', async () => {
    const before = await generatedFor(poolRecurringId);
    const lastAssignee = before.at(-1)!.assignedTo;
    const nextDay = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const metrics = await generateRecurringTasks({ now: nextDay, householdId: householdA });
    expect(metrics.generated).toBe(1);

    const after = await generatedFor(poolRecurringId);
    expect(after.length).toBe(before.length + 1);
    // Rotation continued (the new assignee differs from the previous one).
    expect(after.at(-1)!.assignedTo).not.toBe(lastAssignee);
  });
});

describe('fixed assignment (null pool)', () => {
  it('assigns every instance to the fixed assignee', async () => {
    await generateRecurringTasks({ now: start, householdId: householdB });
    const generated = await generatedFor(fixedRecurringId);
    expect(generated.length).toBeGreaterThanOrEqual(7);
    expect(generated.every((t) => t.assignedTo === memberZ)).toBe(true);
  });
});

describe('distributed lock', () => {
  it('prevents concurrent runs', async () => {
    const key = 'lock:gen-test';
    await releaseLock(key);
    expect(await acquireLock(key, 5)).toBe(true);
    expect(await acquireLock(key, 5)).toBe(false); // already held
    await releaseLock(key);
    expect(await acquireLock(key, 5)).toBe(true);
    await releaseLock(key);
  });
});
