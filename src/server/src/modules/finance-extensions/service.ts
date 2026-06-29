// Household finance-extensions business logic (EP-0036): budgets + categories, expenses
// (with optional shared-expense splits), budget summary (actual vs target), settle-up, and
// money allowances. A separate subsystem from the forecasting engine — money is numeric(12,2)
// (docs/finance-domain.md). All queries are household-scoped; the finance permission already
// denies SupervisedUser at the route.

import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db, withTransaction } from '../../db/index.ts';
import {
  budgetCategories,
  budgets,
  expenseShares,
  expenses,
  householdMembers,
  moneyAllowances,
} from '../../db/schema/index.ts';
import { InvalidError, NotFoundError } from '../../http/errors.ts';
import { withDtstart } from '../../recurrence/rrule.ts';

export interface ActorContext {
  userId: string;
  householdId: string;
  memberId: string | null;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: string | number | null): number => Number(v ?? 0);
const money = (n: number): string => round2(n).toFixed(2);

// --- Budgets ---

export interface BudgetInput {
  name: string;
  period: string;
  startDate: string;
  endDate?: string;
}

export async function createBudget(ctx: ActorContext, input: BudgetInput) {
  if (input.period === 'custom' && !input.endDate) {
    throw new InvalidError('A custom budget requires an end date.');
  }
  const [row] = await db
    .insert(budgets)
    .values({
      householdId: ctx.householdId,
      name: input.name,
      period: input.period,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
    })
    .returning();
  return row!;
}

export async function listBudgets(ctx: ActorContext) {
  return db
    .select()
    .from(budgets)
    .where(and(eq(budgets.householdId, ctx.householdId), eq(budgets.isActive, true)))
    .orderBy(asc(budgets.startDate));
}

async function loadBudget(householdId: string, id: string) {
  const [row] = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.id, id), eq(budgets.householdId, householdId)))
    .limit(1);
  return row ?? null;
}

export async function getBudget(ctx: ActorContext, id: string) {
  const budget = await loadBudget(ctx.householdId, id);
  if (!budget) throw new NotFoundError('Budget not found.');
  const categories = await db
    .select()
    .from(budgetCategories)
    .where(and(eq(budgetCategories.budgetId, id), eq(budgetCategories.isActive, true)));
  return { budget, categories };
}

export async function updateBudget(ctx: ActorContext, id: string, patch: Partial<BudgetInput>) {
  const existing = await loadBudget(ctx.householdId, id);
  if (!existing) throw new NotFoundError('Budget not found.');
  const [row] = await db
    .update(budgets)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(budgets.id, id))
    .returning();
  return row!;
}

export async function deleteBudget(ctx: ActorContext, id: string) {
  const existing = await loadBudget(ctx.householdId, id);
  if (!existing) throw new NotFoundError('Budget not found.');
  await withTransaction(async (tx) => {
    await tx
      .update(budgets)
      .set({ isActive: false, deletedAt: new Date() })
      .where(eq(budgets.id, id));
    await tx
      .update(budgetCategories)
      .set({ isActive: false, deletedAt: new Date() })
      .where(eq(budgetCategories.budgetId, id));
  });
  return { deleted: true };
}

// --- Categories ---

export async function createCategory(
  ctx: ActorContext,
  budgetId: string,
  input: { name: string; targetAmount: number; colorTag?: string },
) {
  const budget = await loadBudget(ctx.householdId, budgetId);
  if (!budget) throw new NotFoundError('Budget not found.');
  const [row] = await db
    .insert(budgetCategories)
    .values({
      budgetId,
      name: input.name,
      targetAmount: money(input.targetAmount),
      colorTag: input.colorTag ?? null,
    })
    .returning();
  return row!;
}

async function loadCategory(householdId: string, categoryId: string) {
  const [row] = await db
    .select({ category: budgetCategories, budget: budgets })
    .from(budgetCategories)
    .innerJoin(budgets, eq(budgets.id, budgetCategories.budgetId))
    .where(and(eq(budgetCategories.id, categoryId), eq(budgets.householdId, householdId)))
    .limit(1);
  return row ?? null;
}

export async function updateCategory(
  ctx: ActorContext,
  categoryId: string,
  patch: { name?: string; targetAmount?: number; colorTag?: string },
) {
  const row = await loadCategory(ctx.householdId, categoryId);
  if (!row) throw new NotFoundError('Category not found.');
  const set: Partial<typeof budgetCategories.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.targetAmount !== undefined) set.targetAmount = money(patch.targetAmount);
  if (patch.colorTag !== undefined) set.colorTag = patch.colorTag;
  const [updated] = await db
    .update(budgetCategories)
    .set(set)
    .where(eq(budgetCategories.id, categoryId))
    .returning();
  return updated!;
}

/** Delete a category: unlink it from expenses (they become uncategorized), then soft-delete. */
export async function deleteCategory(ctx: ActorContext, categoryId: string) {
  const row = await loadCategory(ctx.householdId, categoryId);
  if (!row) throw new NotFoundError('Category not found.');
  await withTransaction(async (tx) => {
    await tx
      .update(expenses)
      .set({ categoryId: null, updatedAt: new Date() })
      .where(eq(expenses.categoryId, categoryId));
    await tx
      .update(budgetCategories)
      .set({ isActive: false, deletedAt: new Date() })
      .where(eq(budgetCategories.id, categoryId));
  });
  return { deleted: true };
}

// --- Expenses ---

export interface ExpenseInput {
  categoryId?: string;
  amount: number;
  currencyCode?: string;
  expenseDate: string;
  description?: string;
  /** Even-split members, or explicit shares. */
  splitMemberIds?: string[];
  shares?: Array<{ memberId: string; share: number }>;
}

/** Even split with cent-accurate remainder allocation to the leading members. */
export function evenShares(
  amount: number,
  memberIds: string[],
): Array<{ memberId: string; share: number }> {
  const n = memberIds.length;
  if (n === 0) return [];
  const base = Math.floor((amount * 100) / n) / 100;
  const shares = memberIds.map((memberId) => ({ memberId, share: base }));
  let remainder = round2(amount - base * n);
  let i = 0;
  while (remainder >= 0.01 - 1e-9 && i < n) {
    shares[i]!.share = round2(shares[i]!.share + 0.01);
    remainder = round2(remainder - 0.01);
    i++;
  }
  return shares;
}

export async function createExpense(ctx: ActorContext, input: ExpenseInput) {
  if (input.amount <= 0) throw new InvalidError('Expense amount must be positive.');
  return withTransaction(async (tx) => {
    const [expense] = await tx
      .insert(expenses)
      .values({
        householdId: ctx.householdId,
        categoryId: input.categoryId ?? null,
        amount: money(input.amount),
        currencyCode: input.currencyCode ?? 'USD',
        expenseDate: input.expenseDate,
        description: input.description ?? null,
        loggedBy: ctx.memberId ?? '00000000-0000-0000-0000-000000000000',
      })
      .returning();

    const shares =
      input.shares ??
      (input.splitMemberIds ? evenShares(input.amount, input.splitMemberIds) : null);
    if (shares && shares.length > 0) {
      await tx.insert(expenseShares).values(
        shares.map((s) => ({
          expenseId: expense!.id,
          memberId: s.memberId,
          share: money(s.share),
        })),
      );
    }
    return expense!;
  });
}

export interface ExpenseFilters {
  from?: string;
  to?: string;
  categoryId?: string;
}

export async function listExpenses(ctx: ActorContext, filters: ExpenseFilters) {
  const conditions = [eq(expenses.householdId, ctx.householdId), eq(expenses.isActive, true)];
  if (filters.from) conditions.push(gte(expenses.expenseDate, filters.from));
  if (filters.to) conditions.push(lte(expenses.expenseDate, filters.to));
  if (filters.categoryId) conditions.push(eq(expenses.categoryId, filters.categoryId));
  return db
    .select()
    .from(expenses)
    .where(and(...conditions))
    .orderBy(asc(expenses.expenseDate));
}

async function loadExpense(householdId: string, id: string) {
  const [row] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.householdId, householdId)))
    .limit(1);
  return row ?? null;
}

export async function getExpense(ctx: ActorContext, id: string) {
  const expense = await loadExpense(ctx.householdId, id);
  if (!expense) throw new NotFoundError('Expense not found.');
  const shares = await db.select().from(expenseShares).where(eq(expenseShares.expenseId, id));
  return { expense, shares };
}

export async function updateExpense(
  ctx: ActorContext,
  id: string,
  patch: {
    categoryId?: string | null;
    amount?: number;
    expenseDate?: string;
    description?: string;
  },
) {
  const existing = await loadExpense(ctx.householdId, id);
  if (!existing) throw new NotFoundError('Expense not found.');
  const set: Partial<typeof expenses.$inferInsert> = { updatedAt: new Date() };
  if (patch.categoryId !== undefined) set.categoryId = patch.categoryId;
  if (patch.amount !== undefined) set.amount = money(patch.amount);
  if (patch.expenseDate !== undefined) set.expenseDate = patch.expenseDate;
  if (patch.description !== undefined) set.description = patch.description;
  const [row] = await db.update(expenses).set(set).where(eq(expenses.id, id)).returning();
  return row!;
}

export async function deleteExpense(ctx: ActorContext, id: string) {
  const existing = await loadExpense(ctx.householdId, id);
  if (!existing) throw new NotFoundError('Expense not found.');
  await withTransaction(async (tx) => {
    await tx.delete(expenseShares).where(eq(expenseShares.expenseId, id));
    await tx
      .update(expenses)
      .set({ isActive: false, deletedAt: new Date() })
      .where(eq(expenses.id, id));
  });
  return { deleted: true };
}

// --- Budget summary (actual vs target per category) ---

function periodEnd(budget: typeof budgets.$inferSelect): string {
  if (budget.endDate) return budget.endDate;
  const d = new Date(`${budget.startDate}T00:00:00.000Z`);
  if (budget.period === 'weekly') d.setUTCDate(d.getUTCDate() + 6);
  else if (budget.period === 'monthly') {
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(d.getUTCDate() - 1);
  } else if (budget.period === 'annual') {
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    d.setUTCDate(d.getUTCDate() - 1);
  } else return budget.startDate;
  return d.toISOString().slice(0, 10);
}

export async function budgetSummary(ctx: ActorContext, budgetId: string) {
  const budget = await loadBudget(ctx.householdId, budgetId);
  if (!budget) throw new NotFoundError('Budget not found.');
  const end = periodEnd(budget);
  const categories = await db
    .select()
    .from(budgetCategories)
    .where(and(eq(budgetCategories.budgetId, budgetId), eq(budgetCategories.isActive, true)));

  const rows = await db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.householdId, ctx.householdId),
        eq(expenses.isActive, true),
        gte(expenses.expenseDate, budget.startDate),
        lte(expenses.expenseDate, end),
      ),
    );
  const actualByCategory = new Map<string, number>();
  for (const e of rows) {
    if (!e.categoryId) continue;
    actualByCategory.set(
      e.categoryId,
      round2((actualByCategory.get(e.categoryId) ?? 0) + num(e.amount)),
    );
  }

  return {
    budget: {
      id: budget.id,
      name: budget.name,
      period: budget.period,
      startDate: budget.startDate,
      endDate: end,
    },
    categories: categories.map((c) => {
      const target = num(c.targetAmount);
      const actual = actualByCategory.get(c.id) ?? 0;
      return {
        categoryId: c.id,
        name: c.name,
        target,
        actual: round2(actual),
        remaining: round2(target - actual),
      };
    }),
  };
}

// --- Shared-expense settle-up ---

export async function settleUp(ctx: ActorContext) {
  // Only shared expenses (those with share rows) participate.
  const expenseRows = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.householdId, ctx.householdId), eq(expenses.isActive, true)));
  if (expenseRows.length === 0) return { members: [] };
  const ids = expenseRows.map((e) => e.id);
  const shareRows = await db
    .select()
    .from(expenseShares)
    .where(inArray(expenseShares.expenseId, ids));

  const sharedExpenseIds = new Set(shareRows.map((s) => s.expenseId));
  const paid = new Map<string, number>();
  const owed = new Map<string, number>();
  for (const e of expenseRows) {
    if (!sharedExpenseIds.has(e.id)) continue;
    paid.set(e.loggedBy, round2((paid.get(e.loggedBy) ?? 0) + num(e.amount)));
  }
  for (const s of shareRows) {
    owed.set(s.memberId, round2((owed.get(s.memberId) ?? 0) + num(s.share)));
  }
  const memberIds = new Set([...paid.keys(), ...owed.keys()]);
  const members = [...memberIds].map((memberId) => {
    const p = paid.get(memberId) ?? 0;
    const o = owed.get(memberId) ?? 0;
    return { memberId, paid: round2(p), owed: round2(o), net: round2(p - o) };
  });
  return { members };
}

// --- Money allowances ---

export async function createMoneyAllowance(
  ctx: ActorContext,
  input: { memberId: string; amount: number; rrule: string; name?: string },
) {
  const [member] = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.id, input.memberId),
        eq(householdMembers.householdId, ctx.householdId),
      ),
    )
    .limit(1);
  if (!member) throw new NotFoundError('Member not found.');
  const now = new Date();
  let rrule: string;
  try {
    rrule = withDtstart(input.rrule, now);
  } catch {
    throw new InvalidError('Invalid allowance cadence (RRULE).');
  }
  const [row] = await db
    .insert(moneyAllowances)
    .values({
      householdId: ctx.householdId,
      memberId: input.memberId,
      name: input.name ?? null,
      amount: money(input.amount),
      rrule,
      lastGrantedAt: now,
    })
    .returning();
  return row!;
}

export async function listMoneyAllowances(ctx: ActorContext) {
  return db
    .select()
    .from(moneyAllowances)
    .where(
      and(eq(moneyAllowances.householdId, ctx.householdId), eq(moneyAllowances.isActive, true)),
    );
}

export async function deleteMoneyAllowance(ctx: ActorContext, id: string) {
  const [row] = await db
    .update(moneyAllowances)
    .set({ isActive: false, deletedAt: new Date() })
    .where(and(eq(moneyAllowances.id, id), eq(moneyAllowances.householdId, ctx.householdId)))
    .returning();
  if (!row) throw new NotFoundError('Allowance not found.');
  return { deleted: true };
}
