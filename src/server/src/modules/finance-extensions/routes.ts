// Household finance-extensions HTTP surface (/api/v1/households/:id/...). Reads require
// finance:read, writes finance:write. SupervisedUser holds neither → 403 on every endpoint.

import { Elysia } from 'elysia';
import type { AuthClaims } from '../../auth/context.ts';
import { guard } from '../../auth/guard.ts';
import { Permissions } from '../../auth/permissions.ts';
import { success } from '../../http/envelope.ts';
import { messages } from '../../http/messages.ts';
import { resolveMemberId } from '../households/service.ts';
import {
  type ActorContext,
  budgetSummary,
  createBudget,
  createCategory,
  createExpense,
  createMoneyAllowance,
  deleteBudget,
  deleteCategory,
  deleteExpense,
  deleteMoneyAllowance,
  getBudget,
  getExpense,
  listBudgets,
  listExpenses,
  listMoneyAllowances,
  settleUp,
  updateBudget,
  updateCategory,
  updateExpense,
} from './service.ts';
import {
  createBudgetBody,
  createCategoryBody,
  createExpenseBody,
  createMoneyAllowanceBody,
  expenseQuery,
  updateBudgetBody,
  updateCategoryBody,
  updateExpenseBody,
} from './validators.ts';

async function actor(claims: AuthClaims): Promise<ActorContext> {
  return {
    userId: claims.userId,
    householdId: claims.householdId,
    memberId: await resolveMemberId(claims.householdId, claims.userId),
  };
}

const read = (id: string) => ({
  requireHousehold: id,
  requirePermissions: [Permissions.financeRead],
});
const write = (id: string) => ({
  requireHousehold: id,
  requirePermissions: [Permissions.financeWrite],
});

export const financeExtPlugin = new Elysia({ name: 'finance-ext' })
  .use(guard)
  // --- budgets ---
  .get(
    '/households/:id/budgets',
    async ({ claims }) => success({ budgets: await listBudgets(await actor(claims!)) }),
    read('id'),
  )
  .post(
    '/households/:id/budgets',
    async ({ claims, body, set }) => {
      const budget = await createBudget(await actor(claims!), body);
      set.status = 201;
      return success({ budget }, { statusCode: 201, message: messages.CREATED });
    },
    { ...write('id'), body: createBudgetBody },
  )
  .get(
    '/households/:id/budgets/:budgetId',
    async ({ claims, params }) => success(await getBudget(await actor(claims!), params.budgetId)),
    read('id'),
  )
  .get(
    '/households/:id/budgets/:budgetId/summary',
    async ({ claims, params }) =>
      success(await budgetSummary(await actor(claims!), params.budgetId)),
    read('id'),
  )
  .patch(
    '/households/:id/budgets/:budgetId',
    async ({ claims, params, body }) =>
      success({ budget: await updateBudget(await actor(claims!), params.budgetId, body) }),
    { ...write('id'), body: updateBudgetBody },
  )
  .delete(
    '/households/:id/budgets/:budgetId',
    async ({ claims, params }) =>
      success(await deleteBudget(await actor(claims!), params.budgetId)),
    write('id'),
  )
  // --- categories ---
  .post(
    '/households/:id/budgets/:budgetId/categories',
    async ({ claims, params, body, set }) => {
      const category = await createCategory(await actor(claims!), params.budgetId, body);
      set.status = 201;
      return success({ category }, { statusCode: 201, message: messages.CREATED });
    },
    { ...write('id'), body: createCategoryBody },
  )
  .patch(
    '/households/:id/budget-categories/:categoryId',
    async ({ claims, params, body }) =>
      success({ category: await updateCategory(await actor(claims!), params.categoryId, body) }),
    { ...write('id'), body: updateCategoryBody },
  )
  .delete(
    '/households/:id/budget-categories/:categoryId',
    async ({ claims, params }) =>
      success(await deleteCategory(await actor(claims!), params.categoryId)),
    write('id'),
  )
  // --- expenses ---
  .get(
    '/households/:id/expenses',
    async ({ claims, query }) =>
      success({ expenses: await listExpenses(await actor(claims!), query) }),
    { ...read('id'), query: expenseQuery },
  )
  .get(
    '/households/:id/expenses/settle-up',
    async ({ claims }) => success(await settleUp(await actor(claims!))),
    read('id'),
  )
  .post(
    '/households/:id/expenses',
    async ({ claims, body, set }) => {
      const expense = await createExpense(await actor(claims!), body);
      set.status = 201;
      return success({ expense }, { statusCode: 201, message: messages.CREATED });
    },
    { ...write('id'), body: createExpenseBody },
  )
  .get(
    '/households/:id/expenses/:expenseId',
    async ({ claims, params }) => success(await getExpense(await actor(claims!), params.expenseId)),
    read('id'),
  )
  .patch(
    '/households/:id/expenses/:expenseId',
    async ({ claims, params, body }) =>
      success({ expense: await updateExpense(await actor(claims!), params.expenseId, body) }),
    { ...write('id'), body: updateExpenseBody },
  )
  .delete(
    '/households/:id/expenses/:expenseId',
    async ({ claims, params }) =>
      success(await deleteExpense(await actor(claims!), params.expenseId)),
    write('id'),
  )
  // --- money allowances ---
  .get(
    '/households/:id/money-allowances',
    async ({ claims }) => success({ allowances: await listMoneyAllowances(await actor(claims!)) }),
    read('id'),
  )
  .post(
    '/households/:id/money-allowances',
    async ({ claims, body, set }) => {
      const allowance = await createMoneyAllowance(await actor(claims!), body);
      set.status = 201;
      return success({ allowance }, { statusCode: 201, message: messages.CREATED });
    },
    { ...write('id'), body: createMoneyAllowanceBody },
  )
  .delete(
    '/households/:id/money-allowances/:allowanceId',
    async ({ claims, params }) =>
      success(await deleteMoneyAllowance(await actor(claims!), params.allowanceId)),
    write('id'),
  );
