// Integration tests for the scheduling schema (EP-0019). Runs fully in-process on the embedded DB (pglite + ioredis-mock).

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { Roles } from '../../auth/permissions.ts';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';
import { seedDefaultTimeWindows } from './setup.ts';

const {
  households,
  householdMembers,
  roles,
  scheduledItems,
  events,
  schedulingTags,
  scheduledItemTags,
  timeWindows,
  occurrenceOverrides,
} = schema;

let householdId = '';
let memberId = '';
const marker = 'sched-schema-test';

async function cleanup(): Promise<void> {
  await db.execute(
    sql`DELETE FROM occurrence_overrides WHERE scheduled_item_id IN (SELECT id FROM scheduled_items WHERE household_id IN (SELECT id FROM households WHERE name = ${marker}))`,
  );
  await db.execute(
    sql`DELETE FROM scheduled_item_tags WHERE scheduled_item_id IN (SELECT id FROM scheduled_items WHERE household_id IN (SELECT id FROM households WHERE name = ${marker}))`,
  );
  await db.execute(
    sql`DELETE FROM events WHERE scheduled_item_id IN (SELECT id FROM scheduled_items WHERE household_id IN (SELECT id FROM households WHERE name = ${marker}))`,
  );
  await db.execute(
    sql`DELETE FROM scheduled_items WHERE household_id IN (SELECT id FROM households WHERE name = ${marker})`,
  );
  await db.execute(
    sql`DELETE FROM scheduling_tags WHERE household_id IN (SELECT id FROM households WHERE name = ${marker})`,
  );
  await db.execute(
    sql`DELETE FROM time_windows WHERE household_id IN (SELECT id FROM households WHERE name = ${marker})`,
  );
  await db.execute(
    sql`DELETE FROM household_members WHERE household_id IN (SELECT id FROM households WHERE name = ${marker})`,
  );
  await db.execute(sql`DELETE FROM households WHERE name = ${marker}`);
}

beforeAll(async () => {
  await seedRoles(db);
  await cleanup();
  const [household] = await db.insert(households).values({ name: marker }).returning();
  householdId = household!.id;
  const [role] = await db.select().from(roles).where(eq(roles.name, Roles.supervisedUser));
  const [member] = await db
    .insert(householdMembers)
    .values({ householdId, displayName: 'Kid', isManaged: true, roleId: role!.id })
    .returning();
  memberId = member!.id;
  await seedDefaultTimeWindows(householdId, db);
});

afterAll(async () => {
  await cleanup();
});

describe('time windows', () => {
  it('seeds the three default windows and rejects start >= end', async () => {
    const windows = await db
      .select()
      .from(timeWindows)
      .where(eq(timeWindows.householdId, householdId));
    expect(windows.map((w) => w.name).sort()).toEqual(['Afternoon', 'Evening', 'Morning']);

    let threw = false;
    try {
      await db
        .insert(timeWindows)
        .values({ householdId, name: 'Bad', startMinute: 600, endMinute: 600 });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe('events & appointments', () => {
  it('stores an event and an appointment with distinguishable types and participants', async () => {
    const [eventItem] = await db
      .insert(scheduledItems)
      .values({ householdId, type: 'event', title: 'Picnic', startsAt: new Date() })
      .returning();
    await db.insert(events).values({
      scheduledItemId: eventItem!.id,
      participants: [memberId],
      reminderMinutesBefore: 30,
    });

    const [appt] = await db
      .insert(scheduledItems)
      .values({ householdId, type: 'appointment', title: 'Dentist', startsAt: new Date() })
      .returning();
    await db.insert(events).values({ scheduledItemId: appt!.id, participants: [memberId] });

    const items = await db
      .select()
      .from(scheduledItems)
      .where(eq(scheduledItems.householdId, householdId));
    expect(items.some((i) => i.type === 'event')).toBe(true);
    expect(items.some((i) => i.type === 'appointment')).toBe(true);

    const [detail] = await db
      .select()
      .from(events)
      .where(eq(events.scheduledItemId, eventItem!.id));
    expect(detail!.participants).toEqual([memberId]);
  });
});

describe('tags', () => {
  it('replaces the whole tag set and hard-deletes item-tag links while retaining tags', async () => {
    const [item] = await db
      .insert(scheduledItems)
      .values({ householdId, type: 'task', title: 'Tagged', startsAt: new Date() })
      .returning();
    const [tagA] = await db.insert(schedulingTags).values({ householdId, name: 'A' }).returning();
    const [tagB] = await db.insert(schedulingTags).values({ householdId, name: 'B' }).returning();

    // Attach both.
    await db.insert(scheduledItemTags).values([
      { scheduledItemId: item!.id, tagId: tagA!.id },
      { scheduledItemId: item!.id, tagId: tagB!.id },
    ]);
    let links = await db
      .select()
      .from(scheduledItemTags)
      .where(eq(scheduledItemTags.scheduledItemId, item!.id));
    expect(links.length).toBe(2);

    // Replace the whole set with just A.
    await db.delete(scheduledItemTags).where(eq(scheduledItemTags.scheduledItemId, item!.id));
    await db.insert(scheduledItemTags).values({ scheduledItemId: item!.id, tagId: tagA!.id });
    links = await db
      .select()
      .from(scheduledItemTags)
      .where(eq(scheduledItemTags.scheduledItemId, item!.id));
    expect(links.length).toBe(1);
    expect(links[0]!.tagId).toBe(tagA!.id);

    // Delete the item's links (hard delete) — tags themselves survive.
    await db.delete(scheduledItemTags).where(eq(scheduledItemTags.scheduledItemId, item!.id));
    const remainingTags = await db
      .select()
      .from(schedulingTags)
      .where(eq(schedulingTags.householdId, householdId));
    expect(remainingTags.length).toBeGreaterThanOrEqual(2);
  });
});

describe('occurrence overrides', () => {
  it('stores a per-(item, date) override and enforces uniqueness', async () => {
    const [item] = await db
      .insert(scheduledItems)
      .values({ householdId, type: 'task', title: 'Recurring', startsAt: new Date() })
      .returning();

    await db.insert(occurrenceOverrides).values({
      scheduledItemId: item!.id,
      occurrenceDate: '2024-06-01',
      status: 'cancelled',
      note: 'On vacation',
    });
    const [override] = await db
      .select()
      .from(occurrenceOverrides)
      .where(
        and(
          eq(occurrenceOverrides.scheduledItemId, item!.id),
          eq(occurrenceOverrides.occurrenceDate, '2024-06-01'),
        ),
      );
    expect(override!.status).toBe('cancelled');

    let threw = false;
    try {
      await db
        .insert(occurrenceOverrides)
        .values({ scheduledItemId: item!.id, occurrenceDate: '2024-06-01', status: 'pending' });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
