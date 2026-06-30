// Inventory HTTP surface (/api/v1/households/:id/inventory...). Reads + adjustments require
// inventory:read (any member); item create/edit/delete require inventory:write
// (supervising/unsupervised). Household-scoped.

import { Elysia } from 'elysia';
import type { AuthClaims } from '../../auth/context.ts';
import { guard } from '../../auth/guard.ts';
import { Permissions } from '../../auth/permissions.ts';
import { success } from '../../http/envelope.ts';
import { messages } from '../../http/messages.ts';
import { resolveMemberId } from '../households/service.ts';
import {
  type ActorContext,
  addToGrocery,
  adjust,
  createItem,
  deleteItem,
  getItem,
  listAdjustments,
  listItems,
  lowStock,
  updateItem,
} from './service.ts';
import {
  adjustBody,
  createItemBody,
  historyQuery,
  listQuery,
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

const pageOf = (raw?: string): number => (raw ? Math.max(1, Number.parseInt(raw, 10) || 1) : 1);

export const inventoryPlugin = new Elysia({ name: 'inventory' })
  .use(guard)
  .get(
    '/households/:id/inventory',
    async ({ claims, query }) =>
      success({
        items: await listItems(await actor(claims!), {
          category: query.category,
          location: query.location,
          lowStock: query.lowStock === 'true',
          search: query.search,
          expiringBefore: query.expiringBefore,
          page: pageOf(query.page),
        }),
      }),
    { requireHousehold: 'id', requirePermissions: [Permissions.inventoryRead], query: listQuery },
  )
  .post(
    '/households/:id/inventory',
    async ({ claims, body, set }) => {
      const item = await createItem(await actor(claims!), body);
      set.status = 201;
      return success({ item }, { statusCode: 201, message: messages.CREATED });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.inventoryWrite],
      body: createItemBody,
    },
  )
  // Static route before :itemId so it is not shadowed.
  .get(
    '/households/:id/inventory/low-stock',
    async ({ claims }) => success({ items: await lowStock(await actor(claims!)) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.inventoryRead] },
  )
  .get(
    '/households/:id/inventory/:itemId',
    async ({ claims, params }) =>
      success({ item: await getItem(await actor(claims!), params.itemId) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.inventoryRead] },
  )
  .patch(
    '/households/:id/inventory/:itemId',
    async ({ claims, params, body }) =>
      success({ item: await updateItem(await actor(claims!), params.itemId, body) }),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.inventoryWrite],
      body: updateItemBody,
    },
  )
  .delete(
    '/households/:id/inventory/:itemId',
    async ({ claims, params }) => success(await deleteItem(await actor(claims!), params.itemId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.inventoryWrite] },
  )
  .post(
    '/households/:id/inventory/:itemId/adjust',
    async ({ claims, params, body, set }) => {
      const result = await adjust(await actor(claims!), params.itemId, body);
      set.status = 201;
      return success(result, { statusCode: 201, message: messages.CREATED });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.inventoryRead], body: adjustBody },
  )
  .get(
    '/households/:id/inventory/:itemId/adjustments',
    async ({ claims, params, query }) =>
      success({
        adjustments: await listAdjustments(await actor(claims!), params.itemId, pageOf(query.page)),
      }),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.inventoryRead],
      query: historyQuery,
    },
  )
  .post(
    '/households/:id/inventory/:itemId/add-to-grocery',
    async ({ claims, params }) => success(await addToGrocery(await actor(claims!), params.itemId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.inventoryRead] },
  );
