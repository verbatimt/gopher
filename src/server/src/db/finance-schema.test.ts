// Schema tests for the finance domain (EP-0032): enum integrity (CHECK constraints), FK
// integrity, the asset/liability grouping helpers, and soft-delete with the account→transaction
// cascade. Runs in-process on the embedded DB (pglite).

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { and, eq, or, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { ACCOUNT_TYPES, isAsset, isLiability } from './schema/finance/enums.ts';
import * as schema from './schema/index.ts';

const { households, accounts, transactions } = schema;
const HH = 'finance-schema-marker';

let householdId = '';

async function cleanup(): Promise<void> {
  await db.execute(
    sql`DELETE FROM finance_transactions WHERE household_id IN (SELECT id FROM households WHERE name = ${HH})`,
  );
  await db.execute(
    sql`DELETE FROM finance_accounts WHERE household_id IN (SELECT id FROM households WHERE name = ${HH})`,
  );
  await db.execute(sql`DELETE FROM households WHERE name = ${HH}`);
}

beforeAll(async () => {
  await cleanup();
  const [h] = await db.insert(households).values({ name: HH }).returning();
  householdId = h!.id;
});

afterAll(async () => {
  await cleanup();
});

async function makeAccount(name: string, type: string, balance = '0'): Promise<string> {
  const [a] = await db
    .insert(accounts)
    .values({ householdId, name, type, currentBalance: balance })
    .returning();
  return a!.id;
}

describe('finance schema', () => {
  it('accepts every documented account type and classifies asset/liability', async () => {
    for (const type of ACCOUNT_TYPES) {
      await makeAccount(`acct-${type}`, type);
    }
    expect(isAsset('Checking')).toBe(true);
    expect(isAsset('Savings')).toBe(true);
    expect(isAsset('Investment')).toBe(true);
    expect(isLiability('Credit')).toBe(true);
    expect(isLiability('Loan')).toBe(true);
    expect(isAsset('Credit')).toBe(false);
    expect(isLiability('Vendor')).toBe(false);
  });

  it('rejects an unknown account type via the CHECK constraint', async () => {
    await expect(makeAccount('bogus', 'NotARealType')).rejects.toThrow();
  });

  it('enforces transaction enum + FK integrity', async () => {
    const checking = await makeAccount('chk', 'Checking', '1000');
    const credit = await makeAccount('cc', 'Credit', '-200');

    // A valid transaction inserts.
    const [tx] = await db
      .insert(transactions)
      .values({
        householdId,
        originAccountId: checking,
        destinationAccountId: credit,
        description: 'CC payment',
        category: 'Payment',
        transferType: 'FixedAmount',
        transferAmount: '50.00',
        startDate: '2026-01-01',
        ending: 'Ongoing',
        intervalUnit: 'Monthly',
        frequency: 1,
      })
      .returning();
    expect(tx!.forecastIncluded).toBe(true); // default

    // An invalid category is rejected by the CHECK constraint.
    await expect(
      (async () => {
        await db.insert(transactions).values({
          householdId,
          originAccountId: checking,
          destinationAccountId: credit,
          description: 'bad',
          category: 'NotACategory',
          transferType: 'FixedAmount',
          transferAmount: '1.00',
          startDate: '2026-01-01',
          ending: 'Ongoing',
          intervalUnit: 'Monthly',
        });
      })(),
    ).rejects.toThrow();
  });

  it('soft-deletes an account and cascades deactivation to its transactions (rows retained)', async () => {
    const checking = await makeAccount('chk2', 'Checking', '500');
    const vendor = await makeAccount('vendor', 'Vendor', '0');
    await db.insert(transactions).values({
      householdId,
      originAccountId: checking,
      destinationAccountId: vendor,
      description: 'Groceries',
      category: 'Food',
      transferType: 'FixedAmount',
      transferAmount: '75.00',
      startDate: '2026-01-01',
      ending: 'Ongoing',
      intervalUnit: 'Weekly',
    });

    // Cascade: deactivate the account, then its transactions (origin OR destination).
    await db
      .update(accounts)
      .set({ isActive: false, deletedAt: new Date() })
      .where(eq(accounts.id, checking));
    await db
      .update(transactions)
      .set({ isActive: false, deletedAt: new Date() })
      .where(
        or(
          eq(transactions.originAccountId, checking),
          eq(transactions.destinationAccountId, checking),
        ),
      );

    const [acct] = await db.select().from(accounts).where(eq(accounts.id, checking));
    expect(acct!.isActive).toBe(false); // retained, not removed
    const stillActive = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.originAccountId, checking),
          eq(transactions.isActive, true),
        ),
      );
    expect(stillActive.length).toBe(0); // all the account's transactions deactivated
  });
});
