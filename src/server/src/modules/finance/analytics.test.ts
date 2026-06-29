// Deterministic analytics tests (EP-0034): the summary endpoint over the EP-0033 fixed forecast.
// Expected values are derived by hand from the EP-0034 formulas (category groups, credit/debit,
// cash/credit, net worth + series).

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';

const PORT = 3204;
const app = createApp();
const ownerEmail = 'fin-analytics-owner@x.test';
let ownerToken = '';
let householdId = '';

function decodeJwt(tok: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(tok.split('.')[1] ?? '', 'base64url').toString());
}

async function call(method: string, path: string, opts: { body?: unknown; token?: string } = {}) {
  // Distinct client IP → its own auth rate-limit bucket (shared mock Redis across the run).
  const headers: Record<string, string> = { 'x-forwarded-for': '10.30.0.34' };
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
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail));
  for (const u of rows) {
    const hh = sql`SELECT id FROM households WHERE created_by = ${u.id}`;
    const fc = sql`SELECT id FROM finance_forecasts WHERE household_id IN (${hh})`;
    for (const table of [
      'finance_forecast_account_balances',
      'finance_forecast_ledger_entries',
      'finance_forecast_transactions',
      'finance_forecast_accounts',
    ]) {
      await db.execute(sql`DELETE FROM ${sql.raw(table)} WHERE forecast_id IN (${fc})`);
    }
    for (const table of ['finance_forecasts', 'finance_transactions', 'finance_accounts']) {
      await db.execute(sql`DELETE FROM ${sql.raw(table)} WHERE household_id IN (${hh})`);
    }
    await db.execute(sql`DELETE FROM time_windows WHERE household_id IN (${hh})`);
    await db.execute(
      sql`DELETE FROM household_members WHERE household_id IN (${hh}) OR user_id = ${u.id}`,
    );
    await db.execute(sql`DELETE FROM households WHERE created_by = ${u.id}`);
    await db.execute(sql`DELETE FROM user_sessions WHERE user_id = ${u.id}`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${u.id}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${u.id}`);
  }
}

const base = () => `/api/v1/households/${householdId}/finance`;
let forecastId = '';

beforeAll(async () => {
  await seedRoles();
  await cleanup();
  const reg = await call('POST', '/api/v1/auth/register', {
    body: { email: ownerEmail, password: 'password123', displayName: 'Owner' },
  });
  ownerToken = reg.body.result.accessToken;
  householdId = decodeJwt(ownerToken).householdId as string;

  const acct = async (name: string, type: string, currentBalance: number) =>
    (
      await call('POST', `${base()}/accounts`, {
        token: ownerToken,
        body: { name, type, currentBalance },
      })
    ).body.result.account.id;
  const checking = await acct('Checking', 'Checking', 1000);
  const credit = await acct('Credit', 'Credit', -100);
  const payroll = await acct('Payroll', 'Payroll', 0);

  await call('POST', `${base()}/transactions`, {
    token: ownerToken,
    body: {
      originAccountId: payroll,
      destinationAccountId: checking,
      description: 'Salary',
      category: 'Pay',
      transferType: 'FixedAmount',
      transferAmount: 500,
      startDate: '2026-01-01',
      ending: 'Ongoing',
      intervalUnit: 'Daily',
    },
  });
  await call('POST', `${base()}/transactions`, {
    token: ownerToken,
    body: {
      originAccountId: checking,
      destinationAccountId: credit,
      description: 'CC payment',
      category: 'Payment',
      transferType: 'FixedAmount',
      transferAmount: 50,
      startDate: '2026-01-01',
      ending: 'Ongoing',
      intervalUnit: 'Daily',
    },
  });
  const f = await call('POST', `${base()}/forecasts`, {
    token: ownerToken,
    body: { startDate: '2026-01-01', endDate: '2026-01-03', description: 'Jan' },
  });
  forecastId = f.body.result.forecast.id;
});

afterAll(async () => {
  await cleanup();
});

describe('forecast summary', () => {
  it('computes headline totals, cash/credit, net worth, and series', async () => {
    const res = await call('GET', `${base()}/forecasts/${forecastId}/summary`, {
      token: ownerToken,
    });
    expect(res.status).toBe(200);
    const s = res.body.result.summary;

    expect(s.totals).toEqual({ accounts: 3, transactions: 2, ledgerEntries: 12 });
    expect(s.earned).toBe(1500); // Pay → Earnings
    expect(s.creditLoanPayments).toBe(100); // Payment → Credit & Loan Payments (not Spending)
    expect(s.spent).toBe(0);
    expect(s.saved).toBe(0);

    expect(s.startingCash).toBe(1000);
    expect(s.endingCash).toBe(2400);
    expect(s.startingCredit).toBe(-100);
    expect(s.endingCredit).toBe(0);
    expect(s.startingNetWorth).toBe(900);
    expect(s.endingNetWorth).toBe(2400);
    expect(s.netWorthChange).toBe(1500);

    expect(s.series.map((p: { netWorth: number }) => p.netWorth)).toEqual([1400, 1900, 2400]);
  });

  it('computes per-account and per-category summaries with the right credit/debit/opening/closing', async () => {
    const res = await call('GET', `${base()}/forecasts/${forecastId}/summary`, {
      token: ownerToken,
    });
    const r = res.body.result;

    const checking = (r.accountSummaries as Array<Record<string, number | string>>).find(
      (a) => a.accountName === 'Checking',
    )!;
    expect(checking.credit).toBe(1500);
    expect(checking.debit).toBe(-100);
    expect(checking.count).toBe(6);
    expect(checking.opening).toBe(1000);
    expect(checking.closing).toBe(2400);
    expect(checking.min).toBe(1000);
    expect(checking.max).toBe(2400);

    const cat = (key: string) =>
      (r.categorySummaries as Array<Record<string, number | string>>).find((c) => c.key === key)!;
    expect(cat('Pay').credit).toBe(1500);
    expect(cat('Payment').credit).toBe(100);
  });
});
