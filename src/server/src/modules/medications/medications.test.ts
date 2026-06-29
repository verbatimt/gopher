// Integration tests for the Medications API (EP-0024). Runs fully in-process on the
// embedded DB (pglite + ioredis-mock). Covers role gating (supervisor vs own), value-change
// capture on dosage, RRULE dose-window validation, and atomic refill stock increment.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { users, valueChangeHistory } from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';

const PORT = 3197;
const app = createApp();

const ownerEmail = 'meds-owner@x.test';
const teenEmail = 'meds-teen@x.test';
const kidEmail = 'meds-kid@x.test';
let ownerToken = '';
let teenToken = '';
let kidToken = '';
let householdId = '';
let ownerMemberId = '';
let teenMemberId = '';

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

async function cleanup(): Promise<void> {
  for (const email of [ownerEmail, teenEmail, kidEmail]) {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
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
}

beforeAll(async () => {
  await seedRoles();
  await cleanup();

  const reg = await call('POST', '/api/v1/auth/register', {
    body: { email: ownerEmail, password: 'password123', displayName: 'Owner' },
  });
  ownerToken = reg.body.result.accessToken;
  householdId = decodeJwt(ownerToken).householdId as string;

  for (const [email, role, name] of [
    [teenEmail, 'unsupervised_user', 'Teen'],
    [kidEmail, 'supervised_user', 'Kid'],
  ] as const) {
    const invite = await call('POST', `/api/v1/households/${householdId}/invites`, {
      token: ownerToken,
      body: { email, role },
    });
    const accept = await call('POST', '/api/v1/auth/accept-invite', {
      body: { token: invite.body.result.token, password: 'password123', displayName: name },
    });
    if (email === teenEmail) teenToken = accept.body.result.accessToken;
    else kidToken = accept.body.result.accessToken;
  }

  const members = await call('GET', `/api/v1/households/${householdId}/members`, {
    token: ownerToken,
  });
  const list = members.body.result.members as Array<{
    id: string;
    isOwner: boolean;
    displayName: string;
  }>;
  ownerMemberId = list.find((m) => m.isOwner)!.id;
  teenMemberId = list.find((m) => m.displayName === 'Teen')!.id;
});

afterAll(async () => {
  await cleanup();
});

const TWICE_DAILY = 'FREQ=DAILY;BYHOUR=8,20;BYMINUTE=0;BYSECOND=0';

describe('schedule create access control', () => {
  it('supervisor creates a twice-daily schedule with stock + threshold', async () => {
    const created = await call('POST', `/api/v1/households/${householdId}/medications`, {
      token: ownerToken,
      body: {
        memberId: ownerMemberId,
        medicationName: 'Vitamin D',
        dosageAmount: 5,
        dosageUnit: 'mg',
        rrule: TWICE_DAILY,
        startDate: '2024-06-01',
        stockQuantity: 30,
        refillThreshold: 5,
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.result.schedule.rrule).toContain('BYHOUR=8,20');
    expect(Number(created.body.result.schedule.stockQuantity)).toBe(30);
  });

  it('rejects a supervised user (no medications:write) with 403', async () => {
    const res = await call('POST', `/api/v1/households/${householdId}/medications`, {
      token: kidToken,
      body: {
        memberId: teenMemberId,
        medicationName: 'X',
        dosageAmount: 1,
        dosageUnit: 'mg',
        rrule: TWICE_DAILY,
        startDate: '2024-06-01',
      },
    });
    expect(res.status).toBe(403);
  });

  it('rejects an unsupervised user (has write, not supervisor) with 403', async () => {
    const res = await call('POST', `/api/v1/households/${householdId}/medications`, {
      token: teenToken,
      body: {
        memberId: teenMemberId,
        medicationName: 'X',
        dosageAmount: 1,
        dosageUnit: 'mg',
        rrule: TWICE_DAILY,
        startDate: '2024-06-01',
      },
    });
    expect(res.status).toBe(403);
  });
});

describe('dosage value-change capture', () => {
  it('writes a value_change_history row on dosage update', async () => {
    const created = await call('POST', `/api/v1/households/${householdId}/medications`, {
      token: ownerToken,
      body: {
        memberId: ownerMemberId,
        medicationName: 'Amox',
        dosageAmount: 5,
        dosageUnit: 'mg',
        rrule: TWICE_DAILY,
        startDate: '2024-06-01',
      },
    });
    const schedId = created.body.result.schedule.id;

    const updated = await call(
      'PATCH',
      `/api/v1/households/${householdId}/medications/${schedId}`,
      {
        token: ownerToken,
        body: { dosageAmount: 10 },
      },
    );
    expect(updated.status).toBe(200);
    expect(Number(updated.body.result.schedule.dosageAmount)).toBe(10);

    const changes = await db
      .select()
      .from(valueChangeHistory)
      .where(
        and(
          eq(valueChangeHistory.entityId, schedId),
          eq(valueChangeHistory.fieldName, 'dosageAmount'),
        ),
      );
    expect(changes.length).toBe(1);
    expect(Number(changes[0]!.oldValue)).toBe(5);
    expect(Number(changes[0]!.newValue)).toBe(10);
  });
});

describe('dose-window validation', () => {
  it('accepts a dose inside the window and rejects one far outside', async () => {
    const created = await call('POST', `/api/v1/households/${householdId}/medications`, {
      token: ownerToken,
      body: {
        memberId: ownerMemberId,
        medicationName: 'Inhaler',
        dosageAmount: 1,
        dosageUnit: 'puff',
        rrule: TWICE_DAILY,
        startDate: '2024-06-01',
        doseWindowMinutes: 120,
      },
    });
    const schedId = created.body.result.schedule.id;

    // 08:30 is 30 min after the 08:00 occurrence → within the 120-min window.
    const inWindow = await call(
      'POST',
      `/api/v1/households/${householdId}/medications/${schedId}/doses`,
      { token: ownerToken, body: { takenAt: '2024-06-01T08:30:00.000Z', status: 'taken' } },
    );
    expect(inWindow.status).toBe(201);
    expect(inWindow.body.result.dose.status).toBe('taken');
    expect(new Date(inWindow.body.result.dose.scheduledAt).toISOString()).toBe(
      '2024-06-01T08:00:00.000Z',
    );

    // 13:00 is 5h from 08:00 and 7h from 20:00 → outside any dose window.
    const outOfWindow = await call(
      'POST',
      `/api/v1/households/${householdId}/medications/${schedId}/doses`,
      { token: ownerToken, body: { takenAt: '2024-06-01T13:00:00.000Z', status: 'taken' } },
    );
    expect(outOfWindow.status).toBe(422);

    const history = await call(
      'GET',
      `/api/v1/households/${householdId}/medications/${schedId}/doses`,
      { token: ownerToken },
    );
    expect(history.body.result.doses.length).toBe(1);
  });
});

describe('refill increments stock atomically', () => {
  it('adds quantity_added to stock_quantity', async () => {
    const created = await call('POST', `/api/v1/households/${householdId}/medications`, {
      token: ownerToken,
      body: {
        memberId: ownerMemberId,
        medicationName: 'Iron',
        dosageAmount: 1,
        dosageUnit: 'tab',
        rrule: TWICE_DAILY,
        startDate: '2024-06-01',
        stockQuantity: 30,
      },
    });
    const schedId = created.body.result.schedule.id;

    const refill = await call(
      'POST',
      `/api/v1/households/${householdId}/medications/${schedId}/refills`,
      { token: ownerToken, body: { quantityAdded: 60 } },
    );
    expect(refill.status).toBe(201);
    expect(Number(refill.body.result.schedule.stockQuantity)).toBe(90);

    const fetched = await call('GET', `/api/v1/households/${householdId}/medications/${schedId}`, {
      token: ownerToken,
    });
    expect(Number(fetched.body.result.schedule.stockQuantity)).toBe(90);
  });
});

describe('role-scoped listing', () => {
  it('an unsupervised user lists only their own schedules', async () => {
    await call('POST', `/api/v1/households/${householdId}/medications`, {
      token: ownerToken,
      body: {
        memberId: teenMemberId,
        medicationName: 'TeenMed',
        dosageAmount: 1,
        dosageUnit: 'mg',
        rrule: TWICE_DAILY,
        startDate: '2024-06-01',
      },
    });
    const teenList = await call('GET', `/api/v1/households/${householdId}/medications`, {
      token: teenToken,
    });
    const names = (teenList.body.result.schedules as Array<{ medicationName: string }>).map(
      (s) => s.medicationName,
    );
    expect(names).toContain('TeenMed');
    expect(names).not.toContain('Vitamin D');
  });
});
