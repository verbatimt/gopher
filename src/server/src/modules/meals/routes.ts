// Meals HTTP surface (/api/v1/households/:id/...). Reads require meals:read; writes
// meals:write. Meal plans + grocery are household-wide (no per-member scoping); the module is
// gated by the household's active_modules on the client.

import { Elysia } from 'elysia';
import type { AuthClaims } from '../../auth/context.ts';
import { guard } from '../../auth/guard.ts';
import { Permissions } from '../../auth/permissions.ts';
import { success } from '../../http/envelope.ts';
import { messages } from '../../http/messages.ts';
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
  updateEntryBody,
  updateItemBody,
} from './validators.ts';

function actor(claims: AuthClaims): ActorContext {
  return { userId: claims.userId, householdId: claims.householdId };
}

export const mealsPlugin = new Elysia({ name: 'meals' })
  .use(guard)
  // --- meal plans ---
  .get(
    '/households/:id/meal-plans',
    async ({ claims, query }) =>
      success({ plans: await listPlans(actor(claims!), query.weekStart) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsRead], query: planQuery },
  )
  .post(
    '/households/:id/meal-plans',
    async ({ claims, body, set }) => {
      const plan = await createPlan(actor(claims!), body.weekStartDate);
      set.status = 201;
      return success({ plan }, { statusCode: 201, message: messages.CREATED });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: createPlanBody },
  )
  .get(
    '/households/:id/meal-plans/:planId',
    async ({ claims, params }) => success(await getPlan(actor(claims!), params.planId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsRead] },
  )
  .post(
    '/households/:id/meal-plans/:planId/copy',
    async ({ claims, params, body, set }) => {
      const plan = await copyPlan(actor(claims!), params.planId, body.targetWeekStart);
      set.status = 201;
      return success({ plan }, { statusCode: 201, message: messages.CREATED });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: copyBody },
  )
  // --- entries ---
  .post(
    '/households/:id/meal-plans/:planId/entries',
    async ({ claims, params, body, set }) => {
      const entry = await upsertEntry(actor(claims!), params.planId, body);
      set.status = 201;
      return success({ entry }, { statusCode: 201, message: messages.CREATED });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: entryBody },
  )
  .patch(
    '/households/:id/meal-plans/:planId/entries/:entryId',
    async ({ claims, params, body }) =>
      success({ entry: await updateEntry(actor(claims!), params.planId, params.entryId, body) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: updateEntryBody },
  )
  .delete(
    '/households/:id/meal-plans/:planId/entries/:entryId',
    async ({ claims, params }) =>
      success(await deleteEntry(actor(claims!), params.planId, params.entryId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite] },
  )
  // --- grocery list ---
  .get(
    '/households/:id/grocery',
    async ({ claims }) => success(await getGroceryList(actor(claims!))),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsRead] },
  )
  .post(
    '/households/:id/grocery/items',
    async ({ claims, body, set }) => {
      const item = await addGroceryItem(actor(claims!), body);
      set.status = 201;
      return success({ item }, { statusCode: 201, message: messages.CREATED });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: addItemBody },
  )
  .patch(
    '/households/:id/grocery/items/:itemId',
    async ({ claims, params, body }) =>
      success({ item: await updateGroceryItem(actor(claims!), params.itemId, body) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: updateItemBody },
  )
  .delete(
    '/households/:id/grocery/items/:itemId',
    async ({ claims, params }) => success(await deleteGroceryItem(actor(claims!), params.itemId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite] },
  )
  .post(
    '/households/:id/grocery/seed',
    async ({ claims, body }) => success(await seedGroceryFromPlan(actor(claims!), body.planId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: seedBody },
  );
