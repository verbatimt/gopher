// Integration tests for the medication reminder/compliance scan (EP-0025). Runs fully
// in-process on the embedded DB (pglite + ioredis-mock). Covers reminder dedupe, missed-dose
// transition, refill-needed-on-log, and compliance math. Schedules are scoped to a dedicated
// household so the scan's metrics are deterministic.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { db } from '../db/index.ts';
import { medicationDoses, notifications, users } from '../db/schema/index.ts';
import { seedRoles } from '../db/seeds/roles.ts';
import { NotificationTypes } from '../modules/notifications/types.ts';
import { scanMedications } from './medication-reminders.ts';

const PORT = 3198;
const app = createApp();

const ownerEmail = 'medscan-owner@x.test';
let ownerToken = '';
let householdId = '';
let ownerMemberId = '';

const TWICE_DAILY = 'FREQ=DAILY;BYHOUR=8,20;BYMINUTE=0;BYSECOND=0';

function decodeJwt(tok: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(tok.split('.')[1] ?? '', 'base64url').toString());
}

async function call(method: string, path: string, opts: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await app.handle(
    new Request(`http://localhost:${PORT}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function createSchedule(body: Record<string, unknown>): Promise<string> {
  const created = await call('POST', `/api/v1/households/${householdId}/medications`, {
    token: ownerToken,
    body: { memberId: ownerMemberId, rrule: TWICE_DAILY, startDate: '2024-06-01', ...body },
  });
  return created.body.result.schedule.id;
}

async function cleanup(): Promise<void> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail));
  for (const u of rows) {
    const hh = sql`SELECT id FROM households WHERE created_by = ${u.id}`;
    const sched = sql`SELECT id FROM medication_schedules WHERE household_id IN (${hh})`;
    await db.execute(sql`DELETE FROM medication_refills WHERE schedule_id IN (${sched})`);
    await db.execute(sql`DELETE FROM medication_doses WHERE schedule_id IN (${sched})`);
    await db.execute(sql`DELETE FROM medication_schedules WHERE household_id IN (${hh})`);
    await db.execute(sql`DELETE FROM value_change_history WHERE household_id IN (${hh})`);
    await db.execute(sql`DELETE FROM notifications WHERE household_id IN (${hh})`);
    await db.execute(sql`DELETE FROM time_windows WHERE household_id IN (${hh})`);
    await db.execute(sql`DELETE FROM household_invites WHERE household_id IN (${hh})`);
    await db.execute(sql`DELETE FROM user_sessions WHERE user_id = ${u.id}`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${u.id}`);
    await db.execute(
      sql`DELETE FROM household_members WHERE household_id IN (${hh}) OR user_id = ${u.id}`,
    );
    await db.execute(sql`DELETE FROM households WHERE created_by = ${u.id}`);
    await db.execute(sql`DELETE FROM audit_logs WHERE actor_user_id = ${u.id}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${u.id}`);
  }
}

beforeAll(async () => {
  await seedRoles();
  await cleanup();
  const reg = await call('POST', '/api/v1/auth/register', {
    body: { email: ownerEmail, password: 'password123', displayName: 'Owner' },
  });
  ownerToken = reg.body.result.accessToken;
  householdId = decodeJwt(ownerToken).householdId as string;
  const members = await call('GET', `/api/v1/households/${householdId}/members`, {
    token: ownerToken,
  });
  ownerMemberId = (members.body.result.members as Array<{ id: string; isOwner: boolean }>).find(
    (m) => m.isOwner,
  )!.id;
});

afterAll(async () => {
  await cleanup();
});

describe('reminder scan + dedupe + missed transition', () => {
  it('creates pending doses with one reminder each, dedupes on re-run, and marks missed', async () => {
    const schedId = await createSchedule({
      medicationName: 'Levo',
      dosageAmount: 1,
      dosageUnit: 'tab',
    });

    // First scan at 07:00 → two upcoming doses (08:00, 20:00) + one reminder each.
    const first = await scanMedications({ now: new Date('2024-06-10T07:00:00.000Z'), householdId });
    expect(first.pendingCreated).toBe(2);
    expect(first.remindersSent).toBe(2);

    // Re-run at the same instant → the (schedule, scheduled_at) rows already exist: no repeats.
    const second = await scanMedications({
      now: new Date('2024-06-10T07:00:00.000Z'),
      householdId,
    });
    expect(second.pendingCreated).toBe(0);
    expect(second.remindersSent).toBe(0);

    const reminders = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.sourceEntityId, schedId),
          eq(notifications.type, NotificationTypes.medicationReminder),
        ),
      );
    expect(reminders.length).toBe(2);

    // Advance past the 08:00 dose window (120 min) → that pending dose becomes missed.
    const third = await scanMedications({
      now: new Date('2024-06-10T11:00:00.000Z'),
      householdId,
    });
    expect(third.missed).toBeGreaterThanOrEqual(1);

    const [eight] = await db
      .select()
      .from(medicationDoses)
      .where(
        and(
          eq(medicationDoses.scheduleId, schedId),
          eq(medicationDoses.scheduledAt, new Date('2024-06-10T08:00:00.000Z')),
        ),
      );
    expect(eight!.status).toBe('missed');
  });
});

describe('refill-needed on dose logging', () => {
  it('crossing the threshold on a taken dose raises a refill-needed notification', async () => {
    const schedId = await createSchedule({
      medicationName: 'Iron',
      dosageAmount: 2,
      dosageUnit: 'tab',
      stockQuantity: 6,
      refillThreshold: 5,
    });

    const dose = await call(
      'POST',
      `/api/v1/households/${householdId}/medications/${schedId}/doses`,
      { token: ownerToken, body: { takenAt: '2024-06-10T08:30:00.000Z', status: 'taken' } },
    );
    expect(dose.status).toBe(201);

    const fetched = await call('GET', `/api/v1/households/${householdId}/medications/${schedId}`, {
      token: ownerToken,
    });
    expect(Number(fetched.body.result.schedule.stockQuantity)).toBe(4);

    const alerts = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.sourceEntityId, schedId),
          eq(notifications.type, NotificationTypes.medicationRefillNeeded),
        ),
      );
    expect(alerts.length).toBe(1);
  });
});

describe('compliance math', () => {
  it('aggregates dose statuses and computes adherence %', async () => {
    const schedId = await createSchedule({
      medicationName: 'Stat',
      dosageAmount: 1,
      dosageUnit: 'mg',
    });

    // 3 taken, 1 skipped, 1 missed, 1 pending → adherence = 3 / (3+1+1) = 60.0%.
    const statuses = ['taken', 'taken', 'taken', 'skipped', 'missed', 'pending'];
    for (let i = 0; i < statuses.length; i++) {
      await db.insert(medicationDoses).values({
        scheduleId: schedId,
        scheduledAt: new Date(`2024-07-0${i + 1}T08:00:00.000Z`),
        status: statuses[i]!,
      });
    }

    const res = await call(
      'GET',
      `/api/v1/households/${householdId}/medications/${schedId}/compliance?from=2024-07-01T00:00:00.000Z&to=2024-07-08T00:00:00.000Z`,
      { token: ownerToken },
    );
    expect(res.status).toBe(200);
    const c = res.body.result.compliance;
    expect(c.counts).toEqual({ taken: 3, skipped: 1, missed: 1, pending: 1 });
    expect(c.adherencePct).toBe(60);
    expect(c.total).toBe(6);
  });
});
