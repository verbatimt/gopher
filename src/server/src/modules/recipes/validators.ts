// TypeBox request schemas for the recipes API (EP-0045). Quantities are numeric (non-negative
// when present); ordering is rewritten via the reorder endpoints. Kept separate from routes so
// the client mirrors the same shapes.

import { t } from 'elysia';

const ingredientInput = t.Object({
  name: t.String({ minLength: 1, maxLength: 200 }),
  quantity: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  unit: t.Optional(t.Union([t.String({ maxLength: 50 }), t.Null()])),
  note: t.Optional(t.Union([t.String({ maxLength: 500 }), t.Null()])),
});

const stepInput = t.Object({
  instruction: t.String({ minLength: 1, maxLength: 2000 }),
});

export const createRecipeBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 200 }),
  description: t.Optional(t.String({ maxLength: 4000 })),
  servings: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
  prepMinutes: t.Optional(t.Integer({ minimum: 0, maximum: 100000 })),
  cookMinutes: t.Optional(t.Integer({ minimum: 0, maximum: 100000 })),
  source: t.Optional(t.String({ maxLength: 500 })),
  imagePath: t.Optional(t.String({ maxLength: 500 })),
  tags: t.Optional(t.Array(t.String({ maxLength: 50 }), { maxItems: 30 })),
  ingredients: t.Optional(t.Array(ingredientInput, { maxItems: 200 })),
  steps: t.Optional(t.Array(stepInput, { maxItems: 200 })),
});

export const updateRecipeBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  description: t.Optional(t.Union([t.String({ maxLength: 4000 }), t.Null()])),
  servings: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
  prepMinutes: t.Optional(t.Union([t.Integer({ minimum: 0, maximum: 100000 }), t.Null()])),
  cookMinutes: t.Optional(t.Union([t.Integer({ minimum: 0, maximum: 100000 }), t.Null()])),
  source: t.Optional(t.Union([t.String({ maxLength: 500 }), t.Null()])),
  imagePath: t.Optional(t.Union([t.String({ maxLength: 500 }), t.Null()])),
  tags: t.Optional(t.Array(t.String({ maxLength: 50 }), { maxItems: 30 })),
});

export const ingredientBody = ingredientInput;

export const updateIngredientBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  quantity: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  unit: t.Optional(t.Union([t.String({ maxLength: 50 }), t.Null()])),
  note: t.Optional(t.Union([t.String({ maxLength: 500 }), t.Null()])),
});

export const stepBody = stepInput;

export const updateStepBody = t.Object({
  instruction: t.Optional(t.String({ minLength: 1, maxLength: 2000 })),
});

export const reorderBody = t.Object({
  order: t.Array(t.String({ format: 'uuid' }), { minItems: 1, maxItems: 200 }),
});

export const listQuery = t.Object({
  search: t.Optional(t.String({ maxLength: 200 })),
  tag: t.Optional(t.String({ maxLength: 50 })),
  page: t.Optional(t.String({ maxLength: 8 })),
});
