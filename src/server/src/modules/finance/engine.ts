// Finance forecast generation engine (EP-0033), Gopher's clean-slate design. Snapshots active
// accounts/transactions, expands each transaction's recurrence (EP-0018), and projects balances
// forward day by day — producing paired origin(−)/destination(+) ledger entries and daily
// per-account balance snapshots. Sign convention and step order are fixed here so analytics
// (EP-0034) stay correct. Money is numeric(14,2); every computed amount/balance is rounded to
// 2 decimals (docs/finance-domain.md).

import { and, asc, eq } from 'drizzle-orm';
import type { Tx } from '../../db/index.ts';
import { isAsset, isLiability } from '../../db/schema/finance/enums.ts';
import {
  accounts,
  forecastAccountBalances,
  forecastAccounts,
  forecastLedgerEntries,
  forecasts,
  forecastTransactions,
  transactions,
} from '../../db/schema/index.ts';
import type { RecurrenceSpec } from '../../recurrence/rrule.ts';
import { expandRecurrence } from '../../recurrence/rrule.ts';
import { FinanceError } from './errors.ts';

const num = (v: string | number): number => Number(v);
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number): string => round2(n).toFixed(2);
const dateUTC = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

interface FA {
  id: string;
  accountId: string;
  name: string;
  type: string;
  starting: number;
  ending: number;
}

interface FT {
  id: string;
  transactionId: string;
  originAccountId: string;
  destinationAccountId: string;
  description: string;
  category: string;
  transferType: string;
  transferAmount: number;
  occurrences: Set<string>;
}

function specOf(t: typeof forecastTransactions.$inferSelect): RecurrenceSpec {
  const frequency = t.intervalUnit.toLowerCase() as RecurrenceSpec['frequency'];
  const spec: RecurrenceSpec = { frequency, interval: t.frequency };
  if (t.ending === 'AfterOccurrences' && t.recurrenceCount) {
    spec.end = { kind: 'count', count: t.recurrenceCount };
  } else if (t.ending === 'OnDate' && t.endDate) {
    spec.end = { kind: 'until', until: dateUTC(t.endDate) };
  } else {
    spec.end = { kind: 'ongoing' };
  }
  return spec;
}

export interface GenerateInput {
  startDate: string;
  endDate: string;
  description: string;
}

/** Run the forecast generation algorithm inside the caller's transaction. Returns the new
 *  forecast's id. */
export async function generateForecast(
  tx: Tx,
  householdId: string,
  input: GenerateInput,
): Promise<string> {
  // 1. Load active accounts + included active transactions.
  const activeAccounts = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.isActive, true)));
  if (activeAccounts.length === 0) throw new FinanceError('no_active_accounts');

  const activeTransactions = await tx
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.isActive, true),
        eq(transactions.forecastIncluded, true),
      ),
    )
    .orderBy(asc(transactions.createdAt), asc(transactions.id));
  if (activeTransactions.length === 0) throw new FinanceError('no_active_transactions');

  // 2. Create the forecast.
  const [forecast] = await tx
    .insert(forecasts)
    .values({
      householdId,
      startDate: input.startDate,
      endDate: input.endDate,
      description: input.description,
      generatedAt: new Date(),
    })
    .returning();
  const forecastId = forecast!.id;

  // 3. Snapshot accounts (starting = ending = current balance).
  const faByAccount = new Map<string, FA>();
  for (const a of activeAccounts) {
    const bal = num(a.currentBalance);
    const [row] = await tx
      .insert(forecastAccounts)
      .values({
        forecastId,
        accountId: a.id,
        name: a.name,
        type: a.type,
        startingBalance: money(bal),
        endingBalance: money(bal),
      })
      .returning();
    faByAccount.set(a.id, {
      id: row!.id,
      accountId: a.id,
      name: a.name,
      type: a.type,
      starting: round2(bal),
      ending: round2(bal),
    });
  }

  // 4. Snapshot transactions + 5. expand recurrence into per-day occurrences.
  const start = dateUTC(input.startDate);
  const end = dateUTC(input.endDate);
  const fts: FT[] = [];
  for (const t of activeTransactions) {
    const [row] = await tx
      .insert(forecastTransactions)
      .values({
        forecastId,
        transactionId: t.id,
        originAccountId: t.originAccountId,
        destinationAccountId: t.destinationAccountId,
        description: t.description,
        category: t.category,
        transferType: t.transferType,
        transferAmount: t.transferAmount,
        startDate: t.startDate,
        ending: t.ending,
        endDate: t.endDate,
        recurrenceCount: t.recurrenceCount,
        intervalUnit: t.intervalUnit,
        frequency: t.frequency,
      })
      .returning();
    const occ = expandRecurrence(specOf(row!), dateUTC(t.startDate), start, end);
    fts.push({
      id: row!.id,
      transactionId: t.id,
      originAccountId: t.originAccountId,
      destinationAccountId: t.destinationAccountId,
      description: t.description,
      category: t.category,
      transferType: t.transferType,
      transferAmount: num(t.transferAmount),
      occurrences: new Set(occ.map(isoDay)),
    });
  }

  // 6/7/8. Walk the inclusive day list; apply each day's transactions; snapshot balances.
  const ledgerRows: Array<typeof forecastLedgerEntries.$inferInsert> = [];
  const balanceRows: Array<typeof forecastAccountBalances.$inferInsert> = [];
  let seq = 0;

  for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = isoDay(day);
    for (const ft of fts) {
      if (!ft.occurrences.has(date)) continue;
      const origin = faByAccount.get(ft.originAccountId);
      const dest = faByAccount.get(ft.destinationAccountId);
      if (!origin || !dest) continue;

      // Compute the transfer amount per transfer type.
      let amount: number;
      if (ft.transferType === 'OriginPercentage') amount = origin.ending * ft.transferAmount;
      else if (ft.transferType === 'DestinationPercentage')
        amount = dest.ending * ft.transferAmount;
      else amount = ft.transferAmount;
      amount = Math.abs(amount);

      // Liability overpay guard: a payment cannot drive an owed (negative) balance above zero.
      if (isLiability(dest.type) && dest.ending + amount > 0) amount = Math.abs(dest.ending);
      amount = round2(amount);

      const originStart = origin.ending;
      origin.ending = round2(originStart - amount);
      const destStart = dest.ending;
      dest.ending = round2(destStart + amount);

      ledgerRows.push({
        forecastId,
        sequence: seq++,
        forecastTransactionId: ft.id,
        forecastAccountId: origin.id,
        accountId: origin.accountId,
        name: origin.name,
        startingBalance: money(originStart),
        endingBalance: money(origin.ending),
        type: origin.type,
        origin: true,
        transactionId: ft.transactionId,
        amount: money(-amount),
        date,
        description: ft.description,
        category: ft.category,
      });
      ledgerRows.push({
        forecastId,
        sequence: seq++,
        forecastTransactionId: ft.id,
        forecastAccountId: dest.id,
        accountId: dest.accountId,
        name: dest.name,
        startingBalance: money(destStart),
        endingBalance: money(dest.ending),
        type: dest.type,
        origin: false,
        transactionId: ft.transactionId,
        amount: money(amount),
        date,
        description: ft.description,
        category: ft.category,
      });
    }

    // End of day: snapshot asset + liability accounts. `total` = the day's net worth.
    const tracked = [...faByAccount.values()].filter(
      (fa) => isAsset(fa.type) || isLiability(fa.type),
    );
    const netWorth = round2(tracked.reduce((sum, fa) => sum + fa.ending, 0));
    for (const fa of tracked) {
      balanceRows.push({
        forecastId,
        forecastAccountId: fa.id,
        accountId: fa.accountId,
        type: fa.type,
        runningBalance: money(fa.ending),
        total: money(netWorth),
        date,
      });
    }
  }

  // 9. Persist final ending balances + ledger + daily balances.
  for (const fa of faByAccount.values()) {
    await tx
      .update(forecastAccounts)
      .set({ endingBalance: money(fa.ending) })
      .where(eq(forecastAccounts.id, fa.id));
  }
  if (ledgerRows.length > 0) await tx.insert(forecastLedgerEntries).values(ledgerRows);
  if (balanceRows.length > 0) await tx.insert(forecastAccountBalances).values(balanceRows);

  return forecastId;
}
