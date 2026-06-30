// Meals HTTP surface (/api/v1/households/:id/...). Reads require meals:read; writes
// meals:write (supervising/unsupervised only). Plans + grocery are household-wide; meal entries
// carry a family/personal scope, and a non-supervising member (i.e. unsupervised) only sees
// family + their own personal entries (per-member visibility resolved via the enriched actor()).
// The module is gated by active_modules on the client.

import { Elysia } from 'elysia';
import type { AuthClaims } from '../../auth/context.ts';
import { guard } from '../../auth/guard.ts';
import { Permissions } from '../../auth/permissions.ts';
import { success } from '../../http/envelope.ts';
import { messages } from '../../http/messages.ts';
import { resolveMemberId } from '../households/service.ts';
import {
  type ActorContext,
  addGroceryItem,
  copyPlan,
  createPlan,
  deleteEntry,
  deleteGroceryItem,
  getGroceryList,
  getPlan,
  listPlans,
  seedGroceryFromPlan,
  seedGroceryFromPlanIngredients,
  updateEntry,
  updateGroceryItem,
  upsertEntry,
} from './service.ts';
import {
  addItemBody,
  copyBody,
  createPlanBody,
  entryBody,
  planQuery,
  seedBody,
  seedFromPlanBody,
  updateEntryBody,
  updateItemBody,
} from './validators.ts';

async function actor(claims: AuthClaims): Promise<ActorContext> {
  return {
    userId: claims.userId,
    householdId: claims.householdId,
    memberId: await resolveMemberId(claims.householdId, claims.userId),
    roles: claims.roles,
  };
}

export const mealsPlugin = new Elysia({ name: 'meals' })
  .use(guard)
  // --- meal plans ---
  .get(
    '/households/:id/meal-plans',
    async ({ claims, query }) =>
      success({ plans: await listPlans(await actor(claims!), query.weekStart) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsRead], query: planQuery },
  )
  .post(
    '/households/:id/meal-plans',
    async ({ claims, body, set }) => {
      const plan = await createPlan(await actor(claims!), body.weekStartDate);
      set.status = 201;
      return success({ plan }, { statusCode: 201, message: messages.CREATED });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: createPlanBody },
  )
  .get(
    '/households/:id/meal-plans/:planId',
    async ({ claims, params }) => success(await getPlan(await actor(claims!), params.planId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsRead] },
  )
  .post(
    '/households/:id/meal-plans/:planId/copy',
    async ({ claims, params, body, set }) => {
      const plan = await copyPlan(await actor(claims!), params.planId, body.targetWeekStart);
      set.status = 201;
      return success({ plan }, { statusCode: 201, message: messages.CREATED });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: copyBody },
  )
  // --- entries ---
  .post(
    '/households/:id/meal-plans/:planId/entries',
    async ({ claims, params, body, set }) => {
      const entry = await upsertEntry(await actor(claims!), params.planId, body);
      set.status = 201;
      return success({ entry }, { statusCode: 201, message: messages.CREATED });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: entryBody },
  )
  .patch(
    '/households/:id/meal-plans/:planId/entries/:entryId',
    async ({ claims, params, body }) =>
      success({
        entry: await updateEntry(await actor(claims!), params.planId, params.entryId, body),
      }),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: updateEntryBody },
  )
  .delete(
    '/households/:id/meal-plans/:planId/entries/:entryId',
    async ({ claims, params }) =>
      success(await deleteEntry(await actor(claims!), params.planId, params.entryId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite] },
  )
  // --- grocery list ---
  .get(
    '/households/:id/grocery',
    async ({ claims }) => success(await getGroceryList(await actor(claims!))),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsRead] },
  )
  .post(
    '/households/:id/grocery/items',
    async ({ claims, body, set }) => {
      const item = await addGroceryItem(await actor(claims!), body);
      set.status = 201;
      return success({ item }, { statusCode: 201, message: messages.CREATED });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: addItemBody },
  )
  .patch(
    '/households/:id/grocery/items/:itemId',
    async ({ claims, params, body }) =>
      success({ item: await updateGroceryItem(await actor(claims!), params.itemId, body) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: updateItemBody },
  )
  .delete(
    '/households/:id/grocery/items/:itemId',
    async ({ claims, params }) =>
      success(await deleteGroceryItem(await actor(claims!), params.itemId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite] },
  )
  .post(
    '/households/:id/grocery/seed',
    async ({ claims, body }) =>
      success(await seedGroceryFromPlan(await actor(claims!), body.planId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: seedBody },
  )
  // EP-0046: ingredient-derived grocery seeding from a plan's recipe-linked entries.
  .post(
    '/households/:id/grocery/seed-from-plan',
    async ({ claims, body }) =>
      success(await seedGroceryFromPlanIngredients(await actor(claims!), body.planId)),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.mealsWrite],
      body: seedFromPlanBody,
    },
  );
