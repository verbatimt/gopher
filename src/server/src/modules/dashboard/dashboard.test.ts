// Integration tests for the Dashboard aggregator (EP-0031). Verifies sections are included
// only when the module is active and the caller's role allows, and that the response stays
// resilient (200 with sections) across roles.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';

const PORT = 3202;
const app = createApp();

const ownerEmail = 'dash-owner@x.test';
const kidEmail = 'dash-kid@x.test';
let ownerToken = '';
let kidToken = '';
let householdId = '';

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
  for (const email of [ownerEmail, kidEmail]) {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    for (const u of rows) {
      const hh = sql`SELECT id FROM households WHERE created_by = ${u.id}`;
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

  const invite = await call('POST', `/api/v1/households/${householdId}/invites`, {
    token: ownerToken,
    body: { email: kidEmail, role: 'supervised_user' },
  });
  const accept = await call('POST', '/api/v1/auth/accept-invite', {
    body: { token: invite.body.result.token, password: 'password123', displayName: 'Kid' },
  });
  kidToken = accept.body.result.accessToken;
});

afterAll(async () => {
  await cleanup();
});

describe('dashboard aggregation', () => {
  it('includes all module sections for a supervisor with every module active', async () => {
    const res = await call('GET', '/api/v1/dashboard', { token: ownerToken });
    expect(res.status).toBe(200);
    const s = res.body.result.sections;
    for (const key of [
      'notifications',
      'calendar',
      'tasks',
      'medications',
      'rewards',
      'meals',
      'finance',
    ]) {
      expect(s).toHaveProperty(key);
    }
  });

  it('omits the finance section for a supervised user (role gate) but keeps tasks/rewards', async () => {
    const res = await call('GET', '/api/v1/dashboard', { token: kidToken });
    expect(res.status).toBe(200);
    const s = res.body.result.sections;
    expect(s).not.toHaveProperty('finance'); // supervised lacks finance:read
    expect(s).toHaveProperty('tasks');
    expect(s).toHaveProperty('rewards');
    expect(s).toHaveProperty('notifications');
  });

  it('omits a section when its module is removed from active_modules', async () => {
    await call('PATCH', `/api/v1/households/${householdId}`, {
      token: ownerToken,
      body: { activeModules: ['calendar', 'tasks', 'medications', 'meals'] },
    });
    const res = await call('GET', '/api/v1/dashboard', { token: ownerToken });
    const s = res.body.result.sections;
    expect(s).not.toHaveProperty('rewards');
    expect(s).not.toHaveProperty('finance');
    expect(s).toHaveProperty('calendar');
    expect(s).toHaveProperty('tasks');
  });
});
