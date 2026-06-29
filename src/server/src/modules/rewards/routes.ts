// Rewards HTTP surface (/api/v1/households/:id/...). Supervisor actions (rule/store CRUD,
// adjust, approve/reject) require rewards:manage; member self-service (redeem, read own
// balance/history) requires rewards:read and is scoped to self in the service.

import { Elysia } from 'elysia';
import type { AuthClaims } from '../../auth/context.ts';
import { guard } from '../../auth/guard.ts';
import { Permissions } from '../../auth/permissions.ts';
import { success } from '../../http/envelope.ts';
import { messages } from '../../http/messages.ts';
import { resolveMemberId } from '../households/service.ts';
import {
  type ActorContext,
  adjust,
  createAllowance,
  createItem,
  createRule,
  decideTransaction,
  deleteAllowance,
  deleteItem,
  deleteRule,
  getBalance,
  listAllowances,
  listItems,
  listRules,
  listTransactions,
  redeem,
  updateItem,
  updateRule,
} from './service.ts';
import {
  adjustBody,
  createAllowanceBody,
  createItemBody,
  createRuleBody,
  decideBody,
  historyQuery,
  updateItemBody,
  updateRuleBody,
} from './validators.ts';

async function actor(claims: AuthClaims): Promise<ActorContext> {
  return {
    userId: claims.userId,
    householdId: claims.householdId,
    memberId: await resolveMemberId(claims.householdId, claims.userId),
    roles: claims.roles,
  };
}

const pageOf = (raw?: string): number => (raw ? Math.max(1, Number.parseInt(raw, 10) || 1) : 1);

export const rewardsPlugin = new Elysia({ name: 'rewards' })
  .use(guard)
  // --- reward rules (supervisor) ---
  .post(
    '/households/:id/reward-rules',
    async ({ claims, body, set }) => {
      const rule = await createRule(await actor(claims!), body);
      set.status = 201;
      return success({ rule }, { statusCode: 201, message: messages.CREATED });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.rewardsManage],
      body: createRuleBody,
    },
  )
  .get(
    '/households/:id/reward-rules',
    async ({ claims }) => success({ rules: await listRules(await actor(claims!)) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.rewardsRead] },
  )
  .patch(
    '/households/:id/reward-rules/:ruleId',
    async ({ claims, params, body }) =>
      success({ rule: await updateRule(await actor(claims!), params.ruleId, body) }),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.rewardsManage],
      body: updateRuleBody,
    },
  )
  .delete(
    '/households/:id/reward-rules/:ruleId',
    async ({ claims, params }) => success(await deleteRule(await actor(claims!), params.ruleId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.rewardsManage] },
  )
  // --- store catalog ---
  .post(
    '/households/:id/reward-store',
    async ({ claims, body, set }) => {
      const item = await createItem(await actor(claims!), body);
      set.status = 201;
      return success({ item }, { statusCode: 201, message: messages.CREATED });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.rewardsManage],
      body: createItemBody,
    },
  )
  .get(
    '/households/:id/reward-store',
    async ({ claims }) => success({ items: await listItems(await actor(claims!)) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.rewardsRead] },
  )
  .patch(
    '/households/:id/reward-store/:itemId',
    async ({ claims, params, body }) =>
      success({ item: await updateItem(await actor(claims!), params.itemId, body) }),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.rewardsManage],
      body: updateItemBody,
    },
  )
  .delete(
    '/households/:id/reward-store/:itemId',
    async ({ claims, params }) => success(await deleteItem(await actor(claims!), params.itemId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.rewardsManage] },
  )
  .post(
    '/households/:id/reward-store/:itemId/redeem',
    async ({ claims, params, set }) => {
      const tx = await redeem(await actor(claims!), params.itemId);
      set.status = 201;
      return success({ transaction: tx }, { statusCode: 201, message: messages.CREATED });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.rewardsRead] },
  )
  // --- balances + history ---
  // `me` shortcuts: the caller's own balance/history (the client has no member id, only the
  // user token). Declared before the :memberId routes so `me` is not captured as a param.
  .get(
    '/households/:id/rewards/me',
    async ({ claims }) => {
      const a = await actor(claims!);
      if (!a.memberId) {
        return success({
          rewards: { memberId: null, balance: 0, lifetimeEarned: 0, lifetimeRedeemed: 0 },
        });
      }
      return success({ rewards: await getBalance(a, a.memberId) });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.rewardsRead] },
  )
  .get(
    '/households/:id/rewards/me/transactions',
    async ({ claims, query }) => {
      const a = await actor(claims!);
      if (!a.memberId) return success({ transactions: [] });
      return success({ transactions: await listTransactions(a, a.memberId, pageOf(query.page)) });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.rewardsRead], query: historyQuery },
  )
  .get(
    '/households/:id/rewards/:memberId',
    async ({ claims, params }) =>
      success({ rewards: await getBalance(await actor(claims!), params.memberId) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.rewardsRead] },
  )
  .get(
    '/households/:id/rewards/:memberId/transactions',
    async ({ claims, params, query }) =>
      success({
        transactions: await listTransactions(
          await actor(claims!),
          params.memberId,
          pageOf(query.page),
        ),
      }),
    { requireHousehold: 'id', requirePermissions: [Permissions.rewardsRead], query: historyQuery },
  )
  .post(
    '/households/:id/rewards/:memberId/adjust',
    async ({ claims, params, body, set }) => {
      const tx = await adjust(await actor(claims!), params.memberId, body);
      set.status = 201;
      return success({ transaction: tx }, { statusCode: 201, message: messages.CREATED });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.rewardsManage], body: adjustBody },
  )
  // --- approve / reject pending transactions (supervisor) ---
  .patch(
    '/households/:id/reward-transactions/:txId',
    async ({ claims, params, body }) =>
      success({
        transaction: await decideTransaction(await actor(claims!), params.txId, body.decision),
      }),
    { requireHousehold: 'id', requirePermissions: [Permissions.rewardsManage], body: decideBody },
  )
  // --- allowances (supervisor) ---
  .post(
    '/households/:id/reward-allowances',
    async ({ claims, body, set }) => {
      const allowance = await createAllowance(await actor(claims!), body);
      set.status = 201;
      return success({ allowance }, { statusCode: 201, message: messages.CREATED });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.rewardsManage],
      body: createAllowanceBody,
    },
  )
  .get(
    '/households/:id/reward-allowances',
    async ({ claims }) => success({ allowances: await listAllowances(await actor(claims!)) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.rewardsManage] },
  )
  .delete(
    '/households/:id/reward-allowances/:allowanceId',
    async ({ claims, params }) =>
      success(await deleteAllowance(await actor(claims!), params.allowanceId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.rewardsManage] },
  );
