// Integration tests for the Meals API (EP-0030). Runs in-process on the embedded DB. Covers
// the unique-week constraint, copy (incl. 409), entry replace-per-slot, and grocery check-off.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';

const PORT = 3201;
const app = createApp();

const ownerEmail = 'meals-owner@x.test';
const kidEmail = 'meals-kid@x.test';
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
      await db.execute(
        sql`DELETE FROM grocery_items WHERE grocery_list_id IN (SELECT id FROM grocery_lists WHERE household_id IN (${hh}))`,
      );
      await db.execute(sql`DELETE FROM grocery_lists WHERE household_id IN (${hh})`);
      await db.execute(
        sql`DELETE FROM meal_plan_entries WHERE meal_plan_id IN (SELECT id FROM meal_plans WHERE household_id IN (${hh}))`,
      );
      await db.execute(sql`DELETE FROM meal_plans WHERE household_id IN (${hh})`);
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

const base = () => `/api/v1/households/${householdId}`;

describe('meal plans', () => {
  it('enforces one plan per household per week', async () => {
    const first = await call('POST', `${base()}/meal-plans`, {
      token: ownerToken,
      body: { weekStartDate: '2024-06-02' },
    });
    expect(first.status).toBe(201);
    const dup = await call('POST', `${base()}/meal-plans`, {
      token: ownerToken,
      body: { weekStartDate: '2024-06-02' },
    });
    expect(dup.status).toBe(409);
  });

  it('a supervised user cannot write meals (no meals:write) but the module is supervisor/independent only', async () => {
    const res = await call('POST', `${base()}/meal-plans`, {
      token: kidToken,
      body: { weekStartDate: '2024-06-09' },
    });
    expect(res.status).toBe(403);
  });

  it('replaces (not duplicates) an entry assigned to the same slot', async () => {
    const plan = await call('POST', `${base()}/meal-plans`, {
      token: ownerToken,
      body: { weekStartDate: '2024-06-16' },
    });
    const planId = plan.body.result.plan.id;

    await call('POST', `${base()}/meal-plans/${planId}/entries`, {
      token: ownerToken,
      body: { dayOfWeek: 2, mealType: 'dinner', mealName: 'Tacos' },
    });
    await call('POST', `${base()}/meal-plans/${planId}/entries`, {
      token: ownerToken,
      body: { dayOfWeek: 2, mealType: 'dinner', mealName: 'Pasta' },
    });

    const got = await call('GET', `${base()}/meal-plans/${planId}`, { token: ownerToken });
    const dinners = (
      got.body.result.entries as Array<{ dayOfWeek: number; mealType: string; mealName: string }>
    ).filter((e) => e.dayOfWeek === 2 && e.mealType === 'dinner');
    expect(dinners.length).toBe(1);
    expect(dinners[0]!.mealName).toBe('Pasta');
  });

  it('copies a plan to a new week and rejects copying onto an existing week', async () => {
    const plan = await call('POST', `${base()}/meal-plans`, {
      token: ownerToken,
      body: { weekStartDate: '2024-06-23' },
    });
    const planId = plan.body.result.plan.id;
    await call('POST', `${base()}/meal-plans/${planId}/entries`, {
      token: ownerToken,
      body: { dayOfWeek: 0, mealType: 'breakfast', mealName: 'Pancakes' },
    });

    const copy = await call('POST', `${base()}/meal-plans/${planId}/copy`, {
      token: ownerToken,
      body: { targetWeekStart: '2024-06-30' },
    });
    expect(copy.status).toBe(201);
    const target = await call('GET', `${base()}/meal-plans/${copy.body.result.plan.id}`, {
      token: ownerToken,
    });
    expect(target.body.result.entries.length).toBe(1);

    const copyAgain = await call('POST', `${base()}/meal-plans/${planId}/copy`, {
      token: ownerToken,
      body: { targetWeekStart: '2024-06-30' },
    });
    expect(copyAgain.status).toBe(409);
  });
});

describe('grocery list', () => {
  it('adds, checks off, and removes items', async () => {
    const add = await call('POST', `${base()}/grocery/items`, {
      token: ownerToken,
      body: { name: 'Milk', quantity: '2' },
    });
    expect(add.status).toBe(201);
    const itemId = add.body.result.item.id;

    const check = await call('PATCH', `${base()}/grocery/items/${itemId}`, {
      token: ownerToken,
      body: { isChecked: true },
    });
    expect(check.body.result.item.isChecked).toBe(true);

    await call('DELETE', `${base()}/grocery/items/${itemId}`, { token: ownerToken });
    const list = await call('GET', `${base()}/grocery`, { token: ownerToken });
    const names = (list.body.result.items as Array<{ name: string }>).map((i) => i.name);
    expect(names).not.toContain('Milk');
  });
});
