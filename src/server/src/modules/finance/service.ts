// Finance account/transaction/forecast business logic (EP-0033). All queries are household-
// scoped (EP-0008). Forecast creation runs the engine in one transaction. Validation rejects
// bad input with clear messages and never partially saves.

import { and, asc, eq, or } from 'drizzle-orm';
import { db, withTransaction } from '../../db/index.ts';
import {
  accounts,
  forecastAccountBalances,
  forecastAccounts,
  forecastLedgerEntries,
  forecasts,
  forecastTransactions,
  transactions,
} from '../../db/schema/index.ts';
import { NotFoundError } from '../../http/errors.ts';
import { generateForecast } from './engine.ts';
import { FinanceError } from './errors.ts';

export interface ActorContext {
  userId: string;
  householdId: string;
}

const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;

// --- Accounts ---

export interface AccountInput {
  name: string;
  type: string;
  notes?: string;
  currentBalance?: number;
}

export async function createAccount(ctx: ActorContext, input: AccountInput) {
  const name = input.name.trim();
  if (!name) throw new FinanceError('account_name_required');
  const [dupe] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, ctx.householdId),
        eq(accounts.name, name),
        eq(accounts.isActive, true),
      ),
    )
    .limit(1);
  if (dupe) throw new FinanceError('duplicate_account_name');
  const [row] = await db
    .insert(accounts)
    .values({
      householdId: ctx.householdId,
      name,
      type: input.type,
      notes: input.notes ?? null,
      currentBalance: String(input.currentBalance ?? 0),
    })
    .returning();
  return row!;
}

export async function listAccounts(ctx: ActorContext) {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.householdId, ctx.householdId), eq(accounts.isActive, true)))
    .orderBy(asc(accounts.name));
}

async function loadAccount(householdId: string, id: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.householdId, householdId)))
    .limit(1);
  return row ?? null;
}

export async function getAccount(ctx: ActorContext, id: string) {
  const row = await loadAccount(ctx.householdId, id);
  if (!row) throw new NotFoundError('Account not found.');
  return row;
}

export async function updateAccount(
  ctx: ActorContext,
  id: string,
  patch: { name?: string; type?: string; notes?: string; currentBalance?: number },
) {
  const existing = await loadAccount(ctx.householdId, id);
  if (!existing) throw new NotFoundError('Account not found.');
  const updates: Partial<typeof accounts.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new FinanceError('account_name_required');
    updates.name = name;
  }
  if (patch.type !== undefined) updates.type = patch.type;
  if (patch.notes !== undefined) updates.notes = patch.notes;
  if (patch.currentBalance !== undefined) updates.currentBalance = String(patch.currentBalance);
  const [row] = await db.update(accounts).set(updates).where(eq(accounts.id, id)).returning();
  return row!;
}

/** Soft-delete an account, cascading deactivation to its transactions (origin or destination). */
export async function deactivateAccount(ctx: ActorContext, id: string) {
  const existing = await loadAccount(ctx.householdId, id);
  if (!existing) throw new NotFoundError('Account not found.');
  await withTransaction(async (tx) => {
    await tx
      .update(accounts)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(accounts.id, id));
    await tx
      .update(transactions)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(transactions.householdId, ctx.householdId),
          or(eq(transactions.originAccountId, id), eq(transactions.destinationAccountId, id)),
        ),
      );
  });
  return { deleted: true };
}

// --- Transactions ---

export interface TransactionInput {
  originAccountId: string;
  destinationAccountId: string;
  description: string;
  notes?: string;
  category: string;
  transferType: string;
  transferAmount: number;
  startDate: string;
  ending: string;
  endDate?: string;
  recurrenceCount?: number;
  intervalUnit: string;
  frequency?: number;
}

async function validateTransaction(householdId: string, input: TransactionInput): Promise<void> {
  if (input.originAccountId === input.destinationAccountId) throw new FinanceError('same_account');
  if (!input.description.trim()) throw new FinanceError('description_required');
  if (input.transferAmount === 0) throw new FinanceError('transfer_amount_zero');
  if ((input.frequency ?? 1) < 1) throw new FinanceError('frequency_invalid');
  if (input.ending === 'AfterOccurrences' && (input.recurrenceCount ?? 0) < 1) {
    throw new FinanceError('recurrence_count_invalid');
  }
  const startMs = new Date(`${input.startDate}T00:00:00.000Z`).getTime();
  if (Number.isNaN(startMs) || Date.now() - startMs > FIVE_YEARS_MS) {
    throw new FinanceError('start_date_too_old');
  }
  if (input.ending === 'OnDate') {
    if (!input.endDate || new Date(input.endDate) <= new Date(input.startDate)) {
      throw new FinanceError('end_before_start');
    }
  }
  // Both accounts must exist in this household (active).
  const found = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.isActive, true)));
  const ids = new Set(found.map((a) => a.id));
  if (!ids.has(input.originAccountId) || !ids.has(input.destinationAccountId)) {
    throw new FinanceError('unknown_account');
  }
}

export async function createTransaction(ctx: ActorContext, input: TransactionInput) {
  await validateTransaction(ctx.householdId, input);
  const [row] = await db
    .insert(transactions)
    .values({
      householdId: ctx.householdId,
      originAccountId: input.originAccountId,
      destinationAccountId: input.destinationAccountId,
      description: input.description.trim(),
      notes: input.notes ?? null,
      category: input.category,
      transferType: input.transferType,
      transferAmount: String(input.transferAmount),
      startDate: input.startDate,
      ending: input.ending,
      endDate: input.endDate ?? null,
      recurrenceCount: input.recurrenceCount ?? null,
      intervalUnit: input.intervalUnit,
      frequency: input.frequency ?? 1,
    })
    .returning();
  return row!;
}

export async function listTransactions(ctx: ActorContext) {
  return db
    .select()
    .from(transactions)
    .where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.isActive, true)))
    .orderBy(asc(transactions.createdAt));
}

async function loadTransaction(householdId: string, id: string) {
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
    .limit(1);
  return row ?? null;
}

export async function getTransaction(ctx: ActorContext, id: string) {
  const row = await loadTransaction(ctx.householdId, id);
  if (!row) throw new NotFoundError('Transaction not found.');
  return row;
}

export async function updateTransaction(
  ctx: ActorContext,
  id: string,
  patch: Partial<TransactionInput>,
) {
  const existing = await loadTransaction(ctx.householdId, id);
  if (!existing) throw new NotFoundError('Transaction not found.');
  const merged: TransactionInput = {
    originAccountId: patch.originAccountId ?? existing.originAccountId,
    destinationAccountId: patch.destinationAccountId ?? existing.destinationAccountId,
    description: patch.description ?? existing.description,
    notes: patch.notes ?? existing.notes ?? undefined,
    category: patch.category ?? existing.category,
    transferType: patch.transferType ?? existing.transferType,
    transferAmount: patch.transferAmount ?? Number(existing.transferAmount),
    startDate: patch.startDate ?? existing.startDate,
    ending: patch.ending ?? existing.ending,
    endDate: patch.endDate ?? existing.endDate ?? undefined,
    recurrenceCount: patch.recurrenceCount ?? existing.recurrenceCount ?? undefined,
    intervalUnit: patch.intervalUnit ?? existing.intervalUnit,
    frequency: patch.frequency ?? existing.frequency,
  };
  await validateTransaction(ctx.householdId, merged);
  const [row] = await db
    .update(transactions)
    .set({
      originAccountId: merged.originAccountId,
      destinationAccountId: merged.destinationAccountId,
      description: merged.description.trim(),
      notes: merged.notes ?? null,
      category: merged.category,
      transferType: merged.transferType,
      transferAmount: String(merged.transferAmount),
      startDate: merged.startDate,
      ending: merged.ending,
      endDate: merged.endDate ?? null,
      recurrenceCount: merged.recurrenceCount ?? null,
      intervalUnit: merged.intervalUnit,
      frequency: merged.frequency ?? 1,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, id))
    .returning();
  return row!;
}

export async function deactivateTransaction(ctx: ActorContext, id: string) {
  const existing = await loadTransaction(ctx.householdId, id);
  if (!existing) throw new NotFoundError('Transaction not found.');
  await db
    .update(transactions)
    .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(transactions.id, id));
  return { deleted: true };
}

export async function setIncluded(ctx: ActorContext, id: string, included: boolean) {
  const existing = await loadTransaction(ctx.householdId, id);
  if (!existing) throw new NotFoundError('Transaction not found.');
  const [row] = await db
    .update(transactions)
    .set({ forecastIncluded: included, updatedAt: new Date() })
    .where(eq(transactions.id, id))
    .returning();
  return row!;
}

// --- Forecasts ---

export interface ForecastInput {
  startDate: string;
  endDate: string;
  description: string;
}

export async function createForecast(ctx: ActorContext, input: ForecastInput) {
  if (!input.description.trim()) throw new FinanceError('description_required');
  if (new Date(input.endDate) <= new Date(input.startDate)) {
    throw new FinanceError('forecast_end_before_start');
  }
  const forecastId = await withTransaction((tx) =>
    generateForecast(tx, ctx.householdId, {
      startDate: input.startDate,
      endDate: input.endDate,
      description: input.description.trim(),
    }),
  );
  return getForecast(ctx, forecastId);
}

export async function listForecasts(ctx: ActorContext) {
  return db
    .select()
    .from(forecasts)
    .where(and(eq(forecasts.householdId, ctx.householdId), eq(forecasts.isActive, true)))
    .orderBy(asc(forecasts.generatedAt));
}

async function loadForecast(householdId: string, id: string) {
  const [row] = await db
    .select()
    .from(forecasts)
    .where(and(eq(forecasts.id, id), eq(forecasts.householdId, householdId)))
    .limit(1);
  return row ?? null;
}

export async function getForecast(ctx: ActorContext, id: string) {
  const forecast = await loadForecast(ctx.householdId, id);
  if (!forecast) throw new NotFoundError('Forecast not found.');
  const [snapAccounts, snapTransactions, ledger, balances] = await Promise.all([
    db.select().from(forecastAccounts).where(eq(forecastAccounts.forecastId, id)),
    db.select().from(forecastTransactions).where(eq(forecastTransactions.forecastId, id)),
    db
      .select()
      .from(forecastLedgerEntries)
      .where(eq(forecastLedgerEntries.forecastId, id))
      .orderBy(asc(forecastLedgerEntries.sequence)),
    db
      .select()
      .from(forecastAccountBalances)
      .where(eq(forecastAccountBalances.forecastId, id))
      .orderBy(asc(forecastAccountBalances.date)),
  ]);
  return { forecast, accounts: snapAccounts, transactions: snapTransactions, ledger, balances };
}

export async function updateForecast(ctx: ActorContext, id: string, description: string) {
  const existing = await loadForecast(ctx.householdId, id);
  if (!existing) throw new NotFoundError('Forecast not found.');
  if (!description.trim()) throw new FinanceError('description_required');
  const [row] = await db
    .update(forecasts)
    .set({ description: description.trim(), updatedAt: new Date() })
    .where(eq(forecasts.id, id))
    .returning();
  return row!;
}

/** Soft-delete a forecast and cascade soft-delete to all its child snapshot/ledger rows. */
export async function deactivateForecast(ctx: ActorContext, id: string) {
  const existing = await loadForecast(ctx.householdId, id);
  if (!existing) throw new NotFoundError('Forecast not found.');
  const stamp = { isActive: false, deletedAt: new Date(), updatedAt: new Date() };
  await withTransaction(async (tx) => {
    await tx.update(forecasts).set(stamp).where(eq(forecasts.id, id));
    await tx.update(forecastAccounts).set(stamp).where(eq(forecastAccounts.forecastId, id));
    await tx.update(forecastTransactions).set(stamp).where(eq(forecastTransactions.forecastId, id));
    await tx
      .update(forecastLedgerEntries)
      .set(stamp)
      .where(eq(forecastLedgerEntries.forecastId, id));
    await tx
      .update(forecastAccountBalances)
      .set(stamp)
      .where(eq(forecastAccountBalances.forecastId, id));
  });
  return { deleted: true };
}
