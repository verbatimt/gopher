// Integration tests for invitation-to-member linking (EP-0050). Runs on the embedded DB.
// Covers claiming an existing managed member (id preserved, is_managed=false, history intact,
// no duplicate member), double-claim → 409, non-managed target rejected, and the NULL path
// still creating a fresh member. Distinct x-forwarded-for for the shared rate-limit bucket.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';

const PORT = 3210;
const FWD = '203.0.113.50';
const app = createApp();

const ownerEmail = 'claim-owner@x.test';
const claimerEmail = 'claim-child@x.test';
const plainEmail = 'claim-plain@x.test';
let ownerToken = '';
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
  for (const email of [ownerEmail, claimerEmail, plainEmail, 'twin-claim@x.test']) {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    for (const u of rows) {
      const hh = sql`SELECT id FROM households WHERE created_by = ${u.id}`;
      await db.execute(sql`DELETE FROM biometric_measurements WHERE household_id IN (${hh})`);
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
  const me = await call('GET', '/api/v1/auth/me', { token: ownerToken });
  ownerMemberId = me.body.result.user.memberId as string;
});

afterAll(async () => {
  await cleanup();
});

async function createManagedChild(name: string): Promise<string> {
  const res = await call('POST', `/api/v1/households/${householdId}/members`, {
    token: ownerToken,
    body: { displayName: name },
  });
  return res.body.result.member.id;
}

describe('claim-invite linking', () => {
  it('links a new login to an existing managed member, preserving id + history', async () => {
    const childId = await createManagedChild('Kiddo');
    // Give the managed member some history: a weight measurement recorded by the supervisor.
    const m = await call(
      'POST',
      `/api/v1/households/${householdId}/members/${childId}/measurements`,
      { token: ownerToken, body: { typeKey: 'weight', valueNumeric: 30 } },
    );
    expect(m.status).toBe(201);

    // Member should be claimable.
    const before = await call('GET', `/api/v1/households/${householdId}/members/${childId}`, {
      token: ownerToken,
    });
    expect(before.body.result.member.claimable).toBe(true);

    // Create a claim invite for the existing member.
    const invite = await call('POST', `/api/v1/households/${householdId}/invites`, {
      token: ownerToken,
      body: { email: claimerEmail, role: 'supervised_user', memberId: childId },
    });
    expect(invite.status).toBe(201);
    expect(invite.body.result.invite.memberId).toBe(childId);

    // Count members before accept.
    const membersBefore = await call('GET', `/api/v1/households/${householdId}/members`, {
      token: ownerToken,
    });
    const countBefore = (membersBefore.body.result.members as unknown[]).length;

    // Accept by creating a new account.
    const accept = await call('POST', '/api/v1/auth/accept-invite', {
      body: { token: invite.body.result.token, password: 'password123', displayName: 'Claimer' },
    });
    expect(accept.status).toBe(201);

    // Same member id now has a login, is no longer managed; no new member created.
    const after = await call('GET', `/api/v1/households/${householdId}/members/${childId}`, {
      token: ownerToken,
    });
    expect(after.body.result.member.hasLogin).toBe(true);
    expect(after.body.result.member.isManaged).toBe(false);
    expect(after.body.result.member.displayName).toBe('Kiddo'); // name preserved

    const membersAfter = await call('GET', `/api/v1/households/${householdId}/members`, {
      token: ownerToken,
    });
    expect((membersAfter.body.result.members as unknown[]).length).toBe(countBefore);

    // History intact: the measurement still belongs to the same member id.
    const claimerToken = accept.body.result.accessToken;
    const meas = await call(
      'GET',
      `/api/v1/households/${householdId}/members/${childId}/measurements`,
      { token: claimerToken },
    );
    expect((meas.body.result.measurements as unknown[]).length).toBe(1);
  });

  it('rejects a second claim for an already-linked member (409)', async () => {
    const childId = await createManagedChild('Twin');
    const first = await call('POST', `/api/v1/households/${householdId}/invites`, {
      token: ownerToken,
      body: { email: 'twin-claim@x.test', role: 'supervised_user', memberId: childId },
    });
    await call('POST', '/api/v1/auth/accept-invite', {
      body: { token: first.body.result.token, password: 'password123', displayName: 'Twin' },
    });
    // Now linked → a new claim must be rejected.
    const second = await call('POST', `/api/v1/households/${householdId}/invites`, {
      token: ownerToken,
      body: { email: 'twin-claim2@x.test', role: 'supervised_user', memberId: childId },
    });
    expect(second.status).toBe(409);
  });

  it('rejects a duplicate pending claim for the same member (409)', async () => {
    const childId = await createManagedChild('Dup');
    const a = await call('POST', `/api/v1/households/${householdId}/invites`, {
      token: ownerToken,
      body: { email: 'dup-a@x.test', role: 'supervised_user', memberId: childId },
    });
    expect(a.status).toBe(201);
    const b = await call('POST', `/api/v1/households/${householdId}/invites`, {
      token: ownerToken,
      body: { email: 'dup-b@x.test', role: 'supervised_user', memberId: childId },
    });
    expect(b.status).toBe(409);
  });

  it('rejects claiming a non-managed (owner) member (409)', async () => {
    const res = await call('POST', `/api/v1/households/${householdId}/invites`, {
      token: ownerToken,
      body: { email: 'bad-claim@x.test', role: 'supervised_user', memberId: ownerMemberId },
    });
    expect(res.status).toBe(409);
  });

  it('the email-only (NULL) path still creates a fresh member', async () => {
    const before = await call('GET', `/api/v1/households/${householdId}/members`, {
      token: ownerToken,
    });
    const countBefore = (before.body.result.members as unknown[]).length;
    const invite = await call('POST', `/api/v1/households/${householdId}/invites`, {
      token: ownerToken,
      body: { email: plainEmail, role: 'unsupervised_user' },
    });
    expect(invite.body.result.invite.memberId).toBeNull();
    await call('POST', '/api/v1/auth/accept-invite', {
      body: { token: invite.body.result.token, password: 'password123', displayName: 'Plain' },
    });
    const after = await call('GET', `/api/v1/households/${householdId}/members`, {
      token: ownerToken,
    });
    expect((after.body.result.members as unknown[]).length).toBe(countBefore + 1);
  });
});
