// Integration tests for the Finance engine (EP-0033). Runs in-process on the embedded DB.
// Includes a DETERMINISTIC forecast whose expected ledger pairs, ending balances, daily
// snapshots, net-worth series, and the liability overpay clamp are computed by hand from the
// EP-0033 §3 algorithm (not from any prior project).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';

const PORT = 3203;
const app = createApp();

const ownerEmail = 'finance-owner@x.test';
const kidEmail = 'finance-kid@x.test';
let ownerToken = '';
let kidToken = '';
let householdId = '';

function decodeJwt(tok: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(tok.split('.')[1] ?? '', 'base64url').toString());
}

async function call(method: string, path: string, opts: { body?: unknown; token?: string } = {}) {
  // A distinct client IP so this file's registrations don't share the per-IP auth
  // rate-limit bucket with other test files (mock Redis is shared across the run).
  const headers: Record<string, string> = { 'x-forwarded-for': '10.30.0.33' };
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

async function clearFinance(): Promise<void> {
  const hh = sql`SELECT id FROM households WHERE created_by IN (SELECT id FROM users WHERE email = ${ownerEmail})`;
  const fc = sql`SELECT id FROM finance_forecasts WHERE household_id IN (${hh})`;
  // Forecast child tables resolve household via forecast_id (no household_id column).
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
}

async function cleanup(): Promise<void> {
  await clearFinance();
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

const base = () => `/api/v1/households/${householdId}/finance`;

async function makeAccount(name: string, type: string, balance: number): Promise<string> {
  const r = await call('POST', `${base()}/accounts`, {
    token: ownerToken,
    body: { name, type, currentBalance: balance },
  });
  return r.body.result.account.id;
}

async function makeTx(body: Record<string, unknown>): Promise<string> {
  const r = await call('POST', `${base()}/transactions`, { token: ownerToken, body });
  return r.body.result.transaction.id;
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

beforeEach(async () => {
  await clearFinance();
});

afterAll(async () => {
  await cleanup();
});

describe('accounts & transactions CRUD', () => {
  it('guards duplicate active account names', async () => {
    await makeAccount('Checking', 'Checking', 100);
    const dup = await call('POST', `${base()}/accounts`, {
      token: ownerToken,
      body: { name: 'Checking', type: 'Savings', currentBalance: 0 },
    });
    expect(dup.status).toBe(422);
  });

  it('toggles forecast_included and cascades soft-delete from account to transactions', async () => {
    const chk = await makeAccount('Chk', 'Checking', 1000);
    const sav = await makeAccount('Sav', 'Savings', 0);
    const txId = await makeTx({
      originAccountId: chk,
      destinationAccountId: sav,
      description: 'Save',
      category: 'Savings',
      transferType: 'FixedAmount',
      transferAmount: 100,
      startDate: '2026-01-01',
      ending: 'Ongoing',
      intervalUnit: 'Monthly',
    });

    const toggled = await call('PATCH', `${base()}/transactions/${txId}/included`, {
      token: ownerToken,
      body: { included: false },
    });
    expect(toggled.body.result.transaction.forecastIncluded).toBe(false);

    await call('DELETE', `${base()}/accounts/${chk}`, { token: ownerToken });
    const txs = await call('GET', `${base()}/transactions`, { token: ownerToken });
    expect(txs.body.result.transactions.length).toBe(0); // cascade deactivated it
  });

  it('rejects invalid transactions and empty-state forecasts', async () => {
    const chk = await makeAccount('C', 'Checking', 100);
    const same = await call('POST', `${base()}/transactions`, {
      token: ownerToken,
      body: {
        originAccountId: chk,
        destinationAccountId: chk,
        description: 'x',
        category: 'Food',
        transferType: 'FixedAmount',
        transferAmount: 10,
        startDate: '2026-01-01',
        ending: 'Ongoing',
        intervalUnit: 'Monthly',
      },
    });
    expect(same.status).toBe(422); // origin === destination

    // accounts exist but none are included → no_active_transactions
    const noTx = await call('POST', `${base()}/forecasts`, {
      token: ownerToken,
      body: { startDate: '2026-01-01', endDate: '2026-01-10', description: 'f' },
    });
    expect(noTx.status).toBe(422);
  });

  it('denies a supervised user (no finance permission) with 403', async () => {
    const res = await call('GET', `${base()}/accounts`, { token: kidToken });
    expect(res.status).toBe(403);
  });
});

describe('deterministic forecast', () => {
  it('produces the hand-computed ledger, balances, clamp, and net-worth series', async () => {
    const checking = await makeAccount('Checking', 'Checking', 1000);
    const credit = await makeAccount('Credit', 'Credit', -100);
    const payroll = await makeAccount('Payroll', 'Payroll', 0);

    // T1: Payroll → Checking, +500 daily. T2: Checking → Credit, 50 daily payment.
    await makeTx({
      originAccountId: payroll,
      destinationAccountId: checking,
      description: 'Salary',
      category: 'Pay',
      transferType: 'FixedAmount',
      transferAmount: 500,
      startDate: '2026-01-01',
      ending: 'Ongoing',
      intervalUnit: 'Daily',
    });
    await makeTx({
      originAccountId: checking,
      destinationAccountId: credit,
      description: 'CC payment',
      category: 'Payment',
      transferType: 'FixedAmount',
      transferAmount: 50,
      startDate: '2026-01-01',
      ending: 'Ongoing',
      intervalUnit: 'Daily',
    });

    const res = await call('POST', `${base()}/forecasts`, {
      token: ownerToken,
      body: { startDate: '2026-01-01', endDate: '2026-01-03', description: 'Jan' },
    });
    expect(res.status).toBe(201);
    const r = res.body.result;

    // Ending balances: Checking 2400, Credit 0 (paid off, clamped), Payroll -1500.
    const fa = (name: string) =>
      (r.accounts as Array<{ name: string; endingBalance: string }>).find((a) => a.name === name);
    expect(Number(fa('Checking')!.endingBalance)).toBe(2400);
    expect(Number(fa('Credit')!.endingBalance)).toBe(0);
    expect(Number(fa('Payroll')!.endingBalance)).toBe(-1500);

    // 3 days × 2 transactions × 2 entries = 12 ledger entries.
    expect(r.ledger.length).toBe(12);

    // Liability overpay clamp: the Jan-3 Credit credit-entry is clamped to 0.
    const jan3CreditCredit = (r.ledger as Array<Record<string, string | boolean>>).find(
      (e) => e.date === '2026-01-03' && e.type === 'Credit' && e.origin === false,
    );
    expect(Number(jan3CreditCredit!.amount)).toBe(0);

    // Net-worth series (the `total` on each day's snapshot): 1400, 1900, 2400.
    const totalsByDate = new Map<string, number>();
    for (const b of r.balances as Array<{ date: string; total: string }>) {
      totalsByDate.set(b.date, Number(b.total));
    }
    expect(totalsByDate.get('2026-01-01')).toBe(1400);
    expect(totalsByDate.get('2026-01-02')).toBe(1900);
    expect(totalsByDate.get('2026-01-03')).toBe(2400);

    // 3 days × 2 tracked accounts (Checking, Credit) = 6 daily balance rows.
    expect(r.balances.length).toBe(6);
  });

  it('computes OriginPercentage against the running balance', async () => {
    const checking = await makeAccount('Checking', 'Checking', 1000);
    const savings = await makeAccount('Savings', 'Savings', 0);
    await makeTx({
      originAccountId: checking,
      destinationAccountId: savings,
      description: '10% to savings',
      category: 'Savings',
      transferType: 'OriginPercentage',
      transferAmount: 0.1,
      startDate: '2026-01-01',
      ending: 'AfterOccurrences',
      recurrenceCount: 1,
      intervalUnit: 'Once',
    });
    const res = await call('POST', `${base()}/forecasts`, {
      token: ownerToken,
      body: { startDate: '2026-01-01', endDate: '2026-01-05', description: 'pct' },
    });
    const r = res.body.result;
    const fa = (name: string) =>
      (r.accounts as Array<{ name: string; endingBalance: string }>).find((a) => a.name === name);
    // 10% of 1000 = 100 → Checking 900, Savings 100.
    expect(Number(fa('Checking')!.endingBalance)).toBe(900);
    expect(Number(fa('Savings')!.endingBalance)).toBe(100);
  });
});
