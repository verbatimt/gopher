// TypeBox request schemas for the meals API (EP-0030). Week starts are 'YYYY-MM-DD'; meal
// types are a fixed enum; days are 0–6.

import { t } from 'elysia';

const dateStr = t.String({ minLength: 8, maxLength: 10 });
const mealType = t.Union([
  t.Literal('breakfast'),
  t.Literal('lunch'),
  t.Literal('dinner'),
  t.Literal('snack'),
]);

export const createPlanBody = t.Object({ weekStartDate: dateStr });

export const planQuery = t.Object({ weekStart: t.Optional(dateStr) });

export const entryBody = t.Object({
  dayOfWeek: t.Integer({ minimum: 0, maximum: 6 }),
  mealType,
  mealName: t.String({ minLength: 1, maxLength: 200 }),
  notes: t.Optional(t.String({ maxLength: 1000 })),
});

export const updateEntryBody = t.Object({
  mealName: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  notes: t.Optional(t.String({ maxLength: 1000 })),
});

export const copyBody = t.Object({ targetWeekStart: dateStr });

export const addItemBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 200 }),
  quantity: t.Optional(t.String({ maxLength: 50 })),
});

export const updateItemBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  quantity: t.Optional(t.String({ maxLength: 50 })),
  isChecked: t.Optional(t.Boolean()),
});

export const seedBody = t.Object({ planId: t.String({ format: 'uuid' }) });
