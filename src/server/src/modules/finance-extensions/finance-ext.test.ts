// Integration tests for the household finance extensions (EP-0036). SupervisedUser 403,
// budget summary (incl. empty category), shared-expense split math, expense filtering, and the
// money-allowance grant cadence. Runs in-process on the embedded DB.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';
import { grantMoneyAllowances } from '../../workers/money-allowance-granter.ts';

const PORT = 3205;
const app = createApp();
const ownerEmail = 'finext-owner@x.test';
const teenEmail = 'finext-teen@x.test';
const kidEmail = 'finext-kid@x.test';
let ownerToken = '';
let kidToken = '';
let householdId = '';
let ownerMemberId = '';
let teenMemberId = '';
let kidMemberId = '';

function decodeJwt(tok: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(tok.split('.')[1] ?? '', 'base64url').toString());
}

async function call(method: string, path: string, opts: { body?: unknown; token?: string } = {}) {
  // Distinct client IP → its own auth rate-limit bucket (shared mock Redis across the run).
  const headers: Record<string, string> = { 'x-forwarded-for': '10.30.0.36' };
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

async function clearExt(): Promise<void> {
  const hh = sql`SELECT id FROM households WHERE created_by IN (SELECT id FROM users WHERE email = ${ownerEmail})`;
  const bg = sql`SELECT id FROM budgets WHERE household_id IN (${hh})`;
  await db.execute(
    sql`DELETE FROM expense_shares WHERE expense_id IN (SELECT id FROM expenses WHERE household_id IN (${hh}))`,
  );
  await db.execute(sql`DELETE FROM expenses WHERE household_id IN (${hh})`);
  await db.execute(sql`DELETE FROM budget_categories WHERE budget_id IN (${bg})`);
  await db.execute(sql`DELETE FROM budgets WHERE household_id IN (${hh})`);
  await db.execute(sql`DELETE FROM money_allowances WHERE household_id IN (${hh})`);
}

async function cleanup(): Promise<void> {
  await clearExt();
  for (const email of [ownerEmail, teenEmail, kidEmail]) {
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

const base = () => `/api/v1/households/${householdId}`;

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
    const invite = await call('POST', `${base()}/invites`, {
      token: ownerToken,
      body: { email, role },
    });
    const accept = await call('POST', '/api/v1/auth/accept-invite', {
      body: { token: invite.body.result.token, password: 'password123', displayName: name },
    });
    if (email === kidEmail) kidToken = accept.body.result.accessToken;
  }
  const members = (await call('GET', `${base()}/members`, { token: ownerToken })).body.result
    .members as Array<{ id: string; isOwner: boolean; displayName: string }>;
  ownerMemberId = members.find((m) => m.isOwner)!.id;
  teenMemberId = members.find((m) => m.displayName === 'Teen')!.id;
  kidMemberId = members.find((m) => m.displayName === 'Kid')!.id;
});

beforeEach(async () => {
  await clearExt();
});

afterAll(async () => {
  await cleanup();
});

describe('access control', () => {
  it('denies a supervised user on every finance-ext endpoint (403)', async () => {
    const res = await call('GET', `${base()}/budgets`, { token: kidToken });
    expect(res.status).toBe(403);
    const expensesRes = await call('POST', `${base()}/expenses`, {
      token: kidToken,
      body: { amount: 10, expenseDate: '2026-03-01' },
    });
    expect(expensesRes.status).toBe(403);
  });
});

describe('budget summary', () => {
  it('computes actual vs target per category, with empty categories at zero', async () => {
    const budget = await call('POST', `${base()}/budgets`, {
      token: ownerToken,
      body: { name: 'March', period: 'monthly', startDate: '2026-03-01' },
    });
    const budgetId = budget.body.result.budget.id;
    const food = (
      await call('POST', `${base()}/budgets/${budgetId}/categories`, {
        token: ownerToken,
        body: { name: 'Food', targetAmount: 200 },
      })
    ).body.result.category.id;
    await call('POST', `${base()}/budgets/${budgetId}/categories`, {
      token: ownerToken,
      body: { name: 'Fun', targetAmount: 50 },
    });

    for (const [amount, date] of [
      [60, '2026-03-05'],
      [40, '2026-03-20'],
      [999, '2026-04-05'], // outside the March period → excluded
    ] as const) {
      await call('POST', `${base()}/expenses`, {
        token: ownerToken,
        body: { categoryId: food, amount, expenseDate: date },
      });
    }

    const summary = await call('GET', `${base()}/budgets/${budgetId}/summary`, {
      token: ownerToken,
    });
    const cats = summary.body.result.categories as Array<Record<string, number | string>>;
    const foodRow = cats.find((c) => c.name === 'Food')!;
    const funRow = cats.find((c) => c.name === 'Fun')!;
    expect(foodRow.actual).toBe(100);
    expect(foodRow.remaining).toBe(100);
    expect(funRow.actual).toBe(0); // empty category
    expect(funRow.remaining).toBe(50);
  });
});

describe('shared expenses', () => {
  it('splits evenly and settles up to a zero-sum', async () => {
    await call('POST', `${base()}/expenses`, {
      token: ownerToken,
      body: {
        amount: 100,
        expenseDate: '2026-03-10',
        description: 'Dinner',
        splitMemberIds: [ownerMemberId, teenMemberId, kidMemberId],
      },
    });
    const settle = await call('GET', `${base()}/expenses/settle-up`, { token: ownerToken });
    const members = settle.body.result.members as Array<{ memberId: string; net: number }>;
    const net = (id: string) => members.find((m) => m.memberId === id)!.net;
    expect(net(ownerMemberId)).toBe(66.66); // paid 100, owes 33.34
    expect(net(teenMemberId)).toBe(-33.33);
    expect(net(kidMemberId)).toBe(-33.33);
    expect(members.reduce((s, m) => s + m.net, 0)).toBeCloseTo(0, 2);
  });
});

describe('expense filtering', () => {
  it('filters by date range and category', async () => {
    const budget = await call('POST', `${base()}/budgets`, {
      token: ownerToken,
      body: { name: 'B', period: 'custom', startDate: '2026-01-01', endDate: '2026-12-31' },
    });
    const cat = (
      await call('POST', `${base()}/budgets/${budget.body.result.budget.id}/categories`, {
        token: ownerToken,
        body: { name: 'Auto', targetAmount: 100 },
      })
    ).body.result.category.id;
    await call('POST', `${base()}/expenses`, {
      token: ownerToken,
      body: { categoryId: cat, amount: 10, expenseDate: '2026-02-01' },
    });
    await call('POST', `${base()}/expenses`, {
      token: ownerToken,
      body: { amount: 20, expenseDate: '2026-06-01' },
    });

    const byDate = await call('GET', `${base()}/expenses?from=2026-05-01&to=2026-07-01`, {
      token: ownerToken,
    });
    expect(byDate.body.result.expenses.length).toBe(1);
    const byCat = await call('GET', `${base()}/expenses?categoryId=${cat}`, { token: ownerToken });
    expect(byCat.body.result.expenses.length).toBe(1);
  });
});

describe('money allowances', () => {
  it('grants once per period across the window and is idempotent on re-run', async () => {
    const created = await call('POST', `${base()}/money-allowances`, {
      token: ownerToken,
      body: { memberId: ownerMemberId, amount: 200, rrule: 'FREQ=MONTHLY', name: 'Pocket money' },
    });
    expect(created.status).toBe(201);
    const anchor = new Date(created.body.result.allowance.lastGrantedAt as string);
    const twoMonths = new Date(anchor);
    twoMonths.setUTCMonth(twoMonths.getUTCMonth() + 2);

    const run = await grantMoneyAllowances({ now: twoMonths, householdId });
    expect(run.granted).toBe(2);
    const rerun = await grantMoneyAllowances({ now: twoMonths, householdId });
    expect(rerun.granted).toBe(0);

    const expensesRes = await call('GET', `${base()}/expenses`, { token: ownerToken });
    expect(expensesRes.body.result.expenses.length).toBe(2);
  });
});
