// Integration tests for the Audit Read API (EP-0051). Runs on the embedded DB. Covers role
// gating (owner/supervising allowed; unsupervised/supervised 403), action-log filtering +
// enrichment (actor name, friendly label), and value-change redaction (sensitive fields masked
// for a non-owner supervising viewer, shown for the owner). Distinct x-forwarded-for.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';

const PORT = 3211;
const FWD = '203.0.113.51';
const app = createApp();

const ownerEmail = 'audit-owner@x.test';
const sup2Email = 'audit-sup2@x.test';
const teenEmail = 'audit-teen@x.test';
const kidEmail = 'audit-kid@x.test';
let ownerToken = '';
let sup2Token = '';
let teenToken = '';
let kidToken = '';
let householdId = '';
let ownerMemberId = '';

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
  for (const email of [ownerEmail, sup2Email, teenEmail, kidEmail]) {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    for (const u of rows) {
      const hh = sql`SELECT id FROM households WHERE created_by = ${u.id}`;
      await db.execute(sql`DELETE FROM biometric_measurements WHERE household_id IN (${hh})`);
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
  ownerMemberId = (await call('GET', '/api/v1/auth/me', { token: ownerToken })).body.result.user
    .memberId as string;

  for (const [email, role, name] of [
    [sup2Email, 'supervising_user', 'Sup2'],
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
    if (email === sup2Email) sup2Token = accept.body.result.accessToken;
    else if (email === teenEmail) teenToken = accept.body.result.accessToken;
    else kidToken = accept.body.result.accessToken;
  }

  // Produce a sensitive value-change: record then update a weight measurement.
  const m = await call(
    'POST',
    `/api/v1/households/${householdId}/members/${ownerMemberId}/measurements`,
    { token: ownerToken, body: { typeKey: 'weight', valueNumeric: 80 } },
  );
  const measurementId = m.body.result.measurement.id;
  await call(
    'PATCH',
    `/api/v1/households/${householdId}/members/${ownerMemberId}/measurements/${measurementId}`,
    { token: ownerToken, body: { valueNumeric: 82 } },
  );
});

afterAll(async () => {
  await cleanup();
});

describe('access control', () => {
  it('owner and a supervising user can read; unsupervised + supervised get 403', async () => {
    expect(
      (await call('GET', `/api/v1/households/${householdId}/audit-logs`, { token: ownerToken }))
        .status,
    ).toBe(200);
    expect(
      (await call('GET', `/api/v1/households/${householdId}/audit-logs`, { token: sup2Token }))
        .status,
    ).toBe(200);
    expect(
      (await call('GET', `/api/v1/households/${householdId}/audit-logs`, { token: teenToken }))
        .status,
    ).toBe(403);
    expect(
      (await call('GET', `/api/v1/households/${householdId}/audit-logs`, { token: kidToken }))
        .status,
    ).toBe(403);
  });

  it('system-logs require a system role (household user 403)', async () => {
    const res = await call('GET', '/api/v1/audit/system-logs', { token: ownerToken });
    expect(res.status).toBe(403);
  });
});

describe('action log filtering + enrichment', () => {
  it('filters by action and enriches with actor name + friendly label', async () => {
    const res = await call(
      'GET',
      `/api/v1/households/${householdId}/audit-logs?action=household.invite_created`,
      { token: ownerToken },
    );
    expect(res.status).toBe(200);
    const logs = res.body.result.logs as Array<{
      action: string;
      actionLabel: string;
      actorName: string | null;
    }>;
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.action === 'household.invite_created')).toBe(true);
    expect(logs[0]!.actionLabel).toContain('invite created');
    expect(logs[0]!.actorName).toBe('Owner');
  });
});

describe('value-change redaction', () => {
  it('masks sensitive fields for a non-owner supervising viewer but shows them to the owner', async () => {
    const asOwner = await call(
      'GET',
      `/api/v1/households/${householdId}/value-change-history?entityType=biometric_measurement&field=valueNumeric`,
      { token: ownerToken },
    );
    expect(asOwner.status).toBe(200);
    const ownerRows = asOwner.body.result.changes as Array<{ newValue: string; redacted: boolean }>;
    expect(ownerRows.length).toBeGreaterThan(0);
    expect(ownerRows[0]!.redacted).toBe(false);
    expect(Number(ownerRows[0]!.newValue)).toBe(82);

    const asSup2 = await call(
      'GET',
      `/api/v1/households/${householdId}/value-change-history?entityType=biometric_measurement&field=valueNumeric`,
      { token: sup2Token },
    );
    const sup2Rows = asSup2.body.result.changes as Array<{ newValue: string; redacted: boolean }>;
    expect(sup2Rows[0]!.redacted).toBe(true);
    expect(sup2Rows[0]!.newValue).toBe('<hidden>');
  });
});
