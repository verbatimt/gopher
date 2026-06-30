// Integration tests for the Biometrics/Vitals API (EP-0043). Runs fully in-process on the
// embedded DB (pglite + ioredis-mock). Covers default-type seeding, custom types, dual-value
// validation, range sanity, history filtering, trend aggregation (incl. empty range), target
// adherence, and role-scoped access. Uses a distinct x-forwarded-for so the shared auth
// rate-limit bucket is not affected by other test files.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/index.ts';
import { seedMeasurementTypes } from '../../db/seeds/measurement-types.ts';
import { seedRoles } from '../../db/seeds/roles.ts';

const PORT = 3203;
const FWD = '203.0.113.43'; // distinct per-file IP for the shared rate-limit bucket
const app = createApp();

const ownerEmail = 'vitals-owner@x.test';
const teenEmail = 'vitals-teen@x.test';
const kidEmail = 'vitals-kid@x.test';
let ownerToken = '';
let teenToken = '';
let kidToken = '';
let householdId = '';
let ownerMemberId = '';
let teenMemberId = '';
let kidMemberId = '';

function decodeJwt(tok: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(tok.split('.')[1] ?? '', 'base64url').toString());
}

async function call(method: string, path: string, opts: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': FWD };
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
      await db.execute(sql`DELETE FROM biometric_measurements WHERE household_id IN (${hh})`);
      await db.execute(sql`DELETE FROM measurement_targets WHERE household_id IN (${hh})`);
      await db.execute(sql`DELETE FROM measurement_types WHERE household_id IN (${hh})`);
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
  await seedMeasurementTypes();
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
  kidMemberId = list.find((m) => m.displayName === 'Kid')!.id;
});

afterAll(async () => {
  await cleanup();
});

describe('measurement types catalog', () => {
  it('lists the six system defaults', async () => {
    const res = await call('GET', `/api/v1/households/${householdId}/measurement-types`, {
      token: ownerToken,
    });
    expect(res.status).toBe(200);
    const keys = (res.body.result.types as Array<{ key: string; isSystemDefault: boolean }>).map(
      (t) => t.key,
    );
    for (const k of [
      'weight',
      'blood_pressure',
      'heart_rate',
      'blood_glucose',
      'body_temperature',
      'spo2',
    ]) {
      expect(keys).toContain(k);
    }
    const bp = (res.body.result.types as Array<{ key: string; valueShape: string }>).find(
      (t) => t.key === 'blood_pressure',
    );
    expect(bp!.valueShape).toBe('dual');
  });

  it('supervisor creates a custom type; it appears only for that household', async () => {
    const created = await call('POST', `/api/v1/households/${householdId}/measurement-types`, {
      token: ownerToken,
      body: { key: 'waist', displayName: 'Waist', unitDefault: 'cm', precision: 1 },
    });
    expect(created.status).toBe(201);
    expect(created.body.result.type.isSystemDefault).toBe(false);

    const list = await call('GET', `/api/v1/households/${householdId}/measurement-types`, {
      token: ownerToken,
    });
    const keys = (list.body.result.types as Array<{ key: string }>).map((t) => t.key);
    expect(keys).toContain('waist');
  });

  it('rejects a non-supervisor creating a type (unsupervised) with 403', async () => {
    const res = await call('POST', `/api/v1/households/${householdId}/measurement-types`, {
      token: teenToken,
      body: { key: 'steps', displayName: 'Steps', unitDefault: 'count' },
    });
    expect(res.status).toBe(403);
  });

  it('cannot edit/delete a system default (403)', async () => {
    const list = await call('GET', `/api/v1/households/${householdId}/measurement-types`, {
      token: ownerToken,
    });
    const weight = (list.body.result.types as Array<{ id: string; key: string }>).find(
      (t) => t.key === 'weight',
    )!;
    const del = await call(
      'DELETE',
      `/api/v1/households/${householdId}/measurement-types/${weight.id}`,
      { token: ownerToken },
    );
    expect(del.status).toBe(403);
  });
});

describe('recording measurements', () => {
  it('records a weight (single) and a blood pressure (dual)', async () => {
    const w = await call(
      'POST',
      `/api/v1/households/${householdId}/members/${ownerMemberId}/measurements`,
      {
        token: ownerToken,
        body: { typeKey: 'weight', valueNumeric: 80.5, measuredAt: '2024-06-01T08:00:00.000Z' },
      },
    );
    expect(w.status).toBe(201);
    expect(Number(w.body.result.measurement.valueNumeric)).toBe(80.5);
    expect(w.body.result.measurement.unit).toBe('kg');
    expect(w.body.result.measurement.recordedBy).toBe(ownerMemberId);

    const bp = await call(
      'POST',
      `/api/v1/households/${householdId}/members/${ownerMemberId}/measurements`,
      {
        token: ownerToken,
        body: {
          typeKey: 'blood_pressure',
          valueNumeric: 120,
          valueSecondary: 80,
          measuredAt: '2024-06-01T08:05:00.000Z',
        },
      },
    );
    expect(bp.status).toBe(201);
    expect(Number(bp.body.result.measurement.valueSecondary)).toBe(80);
  });

  it('rejects a dual measurement missing the second component (422)', async () => {
    const res = await call(
      'POST',
      `/api/v1/households/${householdId}/members/${ownerMemberId}/measurements`,
      { token: ownerToken, body: { typeKey: 'blood_pressure', valueNumeric: 120 } },
    );
    expect(res.status).toBe(422);
  });

  it('rejects a physiologically impossible value (422)', async () => {
    const negative = await call(
      'POST',
      `/api/v1/households/${householdId}/members/${ownerMemberId}/measurements`,
      { token: ownerToken, body: { typeKey: 'weight', valueNumeric: -5 } },
    );
    expect(negative.status).toBe(422);

    const tooHigh = await call(
      'POST',
      `/api/v1/households/${householdId}/members/${ownerMemberId}/measurements`,
      { token: ownerToken, body: { typeKey: 'heart_rate', valueNumeric: 900 } },
    );
    expect(tooHigh.status).toBe(422);
  });
});

describe('history filtering & pagination', () => {
  it('filters by typeKey and date range, newest first', async () => {
    // Three glucose readings across dates for the teen (self-recorded).
    for (const [day, val] of [
      ['2024-05-01', 100],
      ['2024-05-10', 110],
      ['2024-05-20', 90],
    ] as const) {
      await call('POST', `/api/v1/households/${householdId}/members/${teenMemberId}/measurements`, {
        token: teenToken,
        body: { typeKey: 'blood_glucose', valueNumeric: val, measuredAt: `${day}T09:00:00.000Z` },
      });
    }
    const list = await call(
      'GET',
      `/api/v1/households/${householdId}/members/${teenMemberId}/measurements?typeKey=blood_glucose&from=2024-05-05T00:00:00.000Z&to=2024-05-31T00:00:00.000Z`,
      { token: teenToken },
    );
    const rows = list.body.result.measurements as Array<{
      valueNumeric: string;
      measuredAt: string;
    }>;
    expect(rows.length).toBe(2); // 05-10 and 05-20 only
    // newest first
    expect(new Date(rows[0]!.measuredAt) > new Date(rows[1]!.measuredAt)).toBe(true);
  });
});

describe('trends aggregation', () => {
  it('computes latest/min/max/avg/count and an ordered series', async () => {
    const trends = await call(
      'GET',
      `/api/v1/households/${householdId}/members/${teenMemberId}/measurements/trends?typeKey=blood_glucose`,
      { token: teenToken },
    );
    expect(trends.status).toBe(200);
    const t = trends.body.result.trends;
    expect(t.count).toBe(3);
    expect(t.min).toBe(90);
    expect(t.max).toBe(110);
    expect(t.avg).toBe(100); // (100+110+90)/3
    expect(t.latest.value).toBe(90); // last by measured_at (05-20)
    // series ascending by measured_at
    const series = t.series as Array<{ measuredAt: string }>;
    expect(new Date(series[0]!.measuredAt) < new Date(series[2]!.measuredAt)).toBe(true);
  });

  it('returns zeros / empty series for an empty range without error', async () => {
    const trends = await call(
      'GET',
      `/api/v1/households/${householdId}/members/${teenMemberId}/measurements/trends?typeKey=blood_glucose&from=2030-01-01T00:00:00.000Z&to=2030-02-01T00:00:00.000Z`,
      { token: teenToken },
    );
    expect(trends.status).toBe(200);
    expect(trends.body.result.trends.count).toBe(0);
    expect(trends.body.result.trends.latest).toBeNull();
    expect(trends.body.result.trends.series.length).toBe(0);
  });
});

describe('targets & adherence', () => {
  it('upserts a target and adherence reflects in/out-of-range values', async () => {
    // Target heart rate 60–100 for the owner.
    const put = await call(
      'PUT',
      `/api/v1/households/${householdId}/members/${ownerMemberId}/measurement-targets/heart_rate`,
      { token: ownerToken, body: { minTarget: 60, maxTarget: 100 } },
    );
    expect(put.status).toBe(200);

    // Two in-range, one out-of-range.
    for (const v of [70, 90, 150]) {
      await call(
        'POST',
        `/api/v1/households/${householdId}/members/${ownerMemberId}/measurements`,
        { token: ownerToken, body: { typeKey: 'heart_rate', valueNumeric: v } },
      );
    }
    const trends = await call(
      'GET',
      `/api/v1/households/${householdId}/members/${ownerMemberId}/measurements/trends?typeKey=heart_rate`,
      { token: ownerToken },
    );
    // 2 of 3 within [60,100] ⇒ 66.7%
    expect(trends.body.result.trends.adherencePct).toBeCloseTo(66.7, 1);
  });
});

describe('role-scoped access', () => {
  it('a supervised user cannot read another member; can read own', async () => {
    // Kid records own weight (supervised users may record their own).
    const own = await call(
      'POST',
      `/api/v1/households/${householdId}/members/${kidMemberId}/measurements`,
      { token: kidToken, body: { typeKey: 'weight', valueNumeric: 40 } },
    );
    expect(own.status).toBe(201);

    // Kid reading the owner's measurements → hidden (404).
    const other = await call(
      'GET',
      `/api/v1/households/${householdId}/members/${ownerMemberId}/measurements`,
      { token: kidToken },
    );
    expect(other.status).toBe(404);

    // Kid reading own → returned.
    const mine = await call(
      'GET',
      `/api/v1/households/${householdId}/members/${kidMemberId}/measurements`,
      { token: kidToken },
    );
    expect(mine.status).toBe(200);
    expect((mine.body.result.measurements as unknown[]).length).toBeGreaterThan(0);
  });

  it('a supervised user cannot record for another member (403)', async () => {
    const res = await call(
      'POST',
      `/api/v1/households/${householdId}/members/${ownerMemberId}/measurements`,
      { token: kidToken, body: { typeKey: 'weight', valueNumeric: 50 } },
    );
    expect(res.status).toBe(403);
  });

  it('a supervisor can record for any member', async () => {
    const res = await call(
      'POST',
      `/api/v1/households/${householdId}/members/${kidMemberId}/measurements`,
      { token: ownerToken, body: { typeKey: 'body_temperature', valueNumeric: 37.0 } },
    );
    expect(res.status).toBe(201);
  });
});
