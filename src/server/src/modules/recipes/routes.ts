// Recipes HTTP surface (/api/v1/households/:id/recipes...). Reads require meals:read; writes
// meals:write (recipes ride with the meals module). All routes are household-scoped.

import { Elysia } from 'elysia';
import type { AuthClaims } from '../../auth/context.ts';
import { guard } from '../../auth/guard.ts';
import { Permissions } from '../../auth/permissions.ts';
import { success } from '../../http/envelope.ts';
import { messages } from '../../http/messages.ts';
import {
  type ActorContext,
  addIngredient,
  addStep,
  createRecipe,
  deleteIngredient,
  deleteRecipe,
  deleteStep,
  getRecipe,
  listRecipes,
  reorderIngredients,
  reorderSteps,
  updateIngredient,
  updateRecipe,
  updateStep,
} from './service.ts';
import {
  createRecipeBody,
  ingredientBody,
  listQuery,
  reorderBody,
  stepBody,
  updateIngredientBody,
  updateRecipeBody,
  updateStepBody,
} from './validators.ts';

function actor(claims: AuthClaims): ActorContext {
  return { userId: claims.userId, householdId: claims.householdId };
}

const pageOf = (raw?: string): number => (raw ? Math.max(1, Number.parseInt(raw, 10) || 1) : 1);

export const recipesPlugin = new Elysia({ name: 'recipes' })
  .use(guard)
  // --- recipes ---
  .get(
    '/households/:id/recipes',
    async ({ claims, query }) =>
      success({
        recipes: await listRecipes(actor(claims!), {
          search: query.search,
          tag: query.tag,
          page: pageOf(query.page),
        }),
      }),
    // Reads require household membership (all member roles hold household:read); authoring
    // requires meals:write. (EP-0045: "meals:write to author, membership to read".)
    { requireHousehold: 'id', requirePermissions: [Permissions.householdRead], query: listQuery },
  )
  .post(
    '/households/:id/recipes',
    async ({ claims, body, set }) => {
      const recipe = await createRecipe(actor(claims!), body);
      set.status = 201;
      return success(recipe, { statusCode: 201, message: messages.CREATED });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.mealsWrite],
      body: createRecipeBody,
    },
  )
  .get(
    '/households/:id/recipes/:recipeId',
    async ({ claims, params }) => success(await getRecipe(actor(claims!), params.recipeId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.householdRead] },
  )
  .patch(
    '/households/:id/recipes/:recipeId',
    async ({ claims, params, body }) =>
      success(await updateRecipe(actor(claims!), params.recipeId, body)),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.mealsWrite],
      body: updateRecipeBody,
    },
  )
  .delete(
    '/households/:id/recipes/:recipeId',
    async ({ claims, params }) => success(await deleteRecipe(actor(claims!), params.recipeId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite] },
  )
  // --- ingredients ---
  .post(
    '/households/:id/recipes/:recipeId/ingredients',
    async ({ claims, params, body, set }) => {
      const ingredient = await addIngredient(actor(claims!), params.recipeId, body);
      set.status = 201;
      return success({ ingredient }, { statusCode: 201, message: messages.CREATED });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: ingredientBody },
  )
  .post(
    '/households/:id/recipes/:recipeId/ingredients/reorder',
    async ({ claims, params, body }) =>
      success(await reorderIngredients(actor(claims!), params.recipeId, body.order)),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: reorderBody },
  )
  .patch(
    '/households/:id/recipes/:recipeId/ingredients/:ingredientId',
    async ({ claims, params, body }) =>
      success({
        ingredient: await updateIngredient(
          actor(claims!),
          params.recipeId,
          params.ingredientId,
          body,
        ),
      }),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.mealsWrite],
      body: updateIngredientBody,
    },
  )
  .delete(
    '/households/:id/recipes/:recipeId/ingredients/:ingredientId',
    async ({ claims, params }) =>
      success(await deleteIngredient(actor(claims!), params.recipeId, params.ingredientId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite] },
  )
  // --- steps ---
  .post(
    '/households/:id/recipes/:recipeId/steps',
    async ({ claims, params, body, set }) => {
      const step = await addStep(actor(claims!), params.recipeId, body);
      set.status = 201;
      return success({ step }, { statusCode: 201, message: messages.CREATED });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: stepBody },
  )
  .post(
    '/households/:id/recipes/:recipeId/steps/reorder',
    async ({ claims, params, body }) =>
      success(await reorderSteps(actor(claims!), params.recipeId, body.order)),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: reorderBody },
  )
  .patch(
    '/households/:id/recipes/:recipeId/steps/:stepId',
    async ({ claims, params, body }) =>
      success({ step: await updateStep(actor(claims!), params.recipeId, params.stepId, body) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite], body: updateStepBody },
  )
  .delete(
    '/households/:id/recipes/:recipeId/steps/:stepId',
    async ({ claims, params }) =>
      success(await deleteStep(actor(claims!), params.recipeId, params.stepId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.mealsWrite] },
  );
