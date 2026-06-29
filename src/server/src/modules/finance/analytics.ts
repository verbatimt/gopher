// Finance forecast analytics (EP-0034). Computes per-account / per-transaction / per-category
// summaries plus a forecast headline (earned/spent/saved/invested/payments/interest, start/end
// cash/credit/net worth + change, and a net-worth-over-time series) from the generated ledger
// entries and daily balances. Shares EP-0033's sign convention (origin −/debit, destination
// +/credit) and the EP-0032 asset/liability groupings. See docs/finance-analytics.md.

import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { CATEGORY_GROUPS, isAsset, isLiability } from '../../db/schema/finance/enums.ts';
import {
  forecastAccountBalances,
  forecastAccounts,
  forecastLedgerEntries,
  forecasts,
  forecastTransactions,
} from '../../db/schema/index.ts';
import { NotFoundError } from '../../http/errors.ts';
import type { ActorContext } from './service.ts';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: string | number | null): number => Number(v ?? 0);

type Ledger = typeof forecastLedgerEntries.$inferSelect;

export interface Metrics {
  key: string;
  count: number;
  credit: number;
  debit: number;
  opening: number;
  closing: number;
  min: number;
  max: number;
  startDate: string | null;
  endDate: string | null;
}

/** The shared metric set over a (date/sequence-ordered) list of ledger entries. */
function metricsFor(key: string, entries: Ledger[]): Metrics {
  let credit = 0;
  let debit = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const e of entries) {
    const amount = num(e.amount);
    if (e.origin) debit += amount;
    else credit += amount;
    const s = num(e.startingBalance);
    const en = num(e.endingBalance);
    min = Math.min(min, s, en);
    max = Math.max(max, s, en);
  }
  const first = entries[0];
  const last = entries[entries.length - 1];
  return {
    key,
    count: entries.length,
    credit: round2(credit),
    debit: round2(debit),
    opening: first ? num(first.startingBalance) : 0,
    closing: last ? num(last.endingBalance) : 0,
    min: entries.length ? round2(min) : 0,
    max: entries.length ? round2(max) : 0,
    startDate: first?.date ?? null,
    endDate: last?.date ?? null,
  };
}

function groupBy(entries: Ledger[], keyOf: (e: Ledger) => string): Map<string, Ledger[]> {
  const map = new Map<string, Ledger[]>();
  for (const e of entries) {
    const k = keyOf(e);
    const arr = map.get(k) ?? [];
    arr.push(e);
    map.set(k, arr);
  }
  return map;
}

const inGroup = (group: string, category: string): boolean =>
  (CATEGORY_GROUPS[group] ?? []).includes(category);

/** Sum credited (destination) amounts whose category is in [group]. */
const creditedInGroup = (entries: Ledger[], group: string): number =>
  round2(
    entries
      .filter((e) => !e.origin && inGroup(group, e.category))
      .reduce((s, e) => s + num(e.amount), 0),
  );

export async function computeForecastSummary(ctx: ActorContext, forecastId: string) {
  const [forecast] = await db
    .select()
    .from(forecasts)
    .where(and(eq(forecasts.id, forecastId), eq(forecasts.householdId, ctx.householdId)))
    .limit(1);
  if (!forecast) throw new NotFoundError('Forecast not found.');

  const [ledger, snapAccounts, snapTransactions, balances] = await Promise.all([
    db
      .select()
      .from(forecastLedgerEntries)
      .where(eq(forecastLedgerEntries.forecastId, forecastId))
      .orderBy(asc(forecastLedgerEntries.sequence)),
    db.select().from(forecastAccounts).where(eq(forecastAccounts.forecastId, forecastId)),
    db.select().from(forecastTransactions).where(eq(forecastTransactions.forecastId, forecastId)),
    db
      .select()
      .from(forecastAccountBalances)
      .where(eq(forecastAccountBalances.forecastId, forecastId))
      .orderBy(asc(forecastAccountBalances.date)),
  ]);

  // Per-account / per-transaction / per-category summaries.
  const nameByAccount = new Map(snapAccounts.map((a) => [a.accountId, a.name]));
  const accountSummaries = [...groupBy(ledger, (e) => e.accountId)].map(([id, entries]) => ({
    ...metricsFor(id, entries),
    accountName: nameByAccount.get(id) ?? '',
  }));
  const transactionSummaries = [...groupBy(ledger, (e) => e.transactionId)].map(([id, entries]) =>
    metricsFor(id, entries),
  );
  const categorySummaries = [...groupBy(ledger, (e) => e.category)].map(([cat, entries]) =>
    metricsFor(cat, entries),
  );

  // Cash (assets) + credit (liabilities) from the snapshot accounts.
  const startingCash = round2(
    snapAccounts.filter((a) => isAsset(a.type)).reduce((s, a) => s + num(a.startingBalance), 0),
  );
  const endingCash = round2(
    snapAccounts.filter((a) => isAsset(a.type)).reduce((s, a) => s + num(a.endingBalance), 0),
  );
  const startingCredit = round2(
    snapAccounts.filter((a) => isLiability(a.type)).reduce((s, a) => s + num(a.startingBalance), 0),
  );
  const endingCredit = round2(
    snapAccounts.filter((a) => isLiability(a.type)).reduce((s, a) => s + num(a.endingBalance), 0),
  );
  const startingNetWorth = round2(startingCash + startingCredit);
  const endingNetWorth = round2(endingCash + endingCredit);

  // Net-worth-over-time series: one point per snapshot date (the per-day `total`).
  const seriesMap = new Map<string, number>();
  for (const b of balances) seriesMap.set(b.date, num(b.total));
  const series = [...seriesMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, netWorth]) => ({ date, netWorth: round2(netWorth) }));

  // Spent = debited entries in Spending categories (negative); the rest are credited groups.
  const spent = round2(
    ledger
      .filter((e) => e.origin && inGroup('Spending', e.category))
      .reduce((s, e) => s + num(e.amount), 0),
  );

  const summary = {
    range: `${forecast.startDate} to ${forecast.endDate}`,
    description: forecast.description,
    totals: {
      accounts: snapAccounts.length,
      transactions: snapTransactions.length,
      ledgerEntries: ledger.length,
    },
    earned: creditedInGroup(ledger, 'Earnings'),
    spent,
    saved: creditedInGroup(ledger, 'Savings'),
    invested: creditedInGroup(ledger, 'Investment'),
    creditLoanPayments: creditedInGroup(ledger, 'CreditLoanPayments'),
    interest: creditedInGroup(ledger, 'Interest'),
    startingCash,
    endingCash,
    startingCredit,
    endingCredit,
    startingNetWorth,
    endingNetWorth,
    netWorthChange: round2(endingNetWorth - startingNetWorth),
    series,
  };

  return { summary, accountSummaries, transactionSummaries, categorySummaries };
}
