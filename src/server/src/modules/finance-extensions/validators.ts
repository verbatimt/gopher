// TypeBox request schemas for the household finance extensions (EP-0036).

import { t } from 'elysia';

const dateStr = t.String({ minLength: 8, maxLength: 10 });
const money = t.Number({ minimum: 0, maximum: 1_000_000_000 });
const period = t.Union([
  t.Literal('weekly'),
  t.Literal('monthly'),
  t.Literal('annual'),
  t.Literal('custom'),
]);

export const createBudgetBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  period,
  startDate: dateStr,
  endDate: t.Optional(dateStr),
});

export const updateBudgetBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  period: t.Optional(period),
  startDate: t.Optional(dateStr),
  endDate: t.Optional(dateStr),
});

export const createCategoryBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  targetAmount: money,
  colorTag: t.Optional(t.String({ maxLength: 32 })),
});

export const updateCategoryBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  targetAmount: t.Optional(money),
  colorTag: t.Optional(t.String({ maxLength: 32 })),
});

export const createExpenseBody = t.Object({
  categoryId: t.Optional(t.String({ format: 'uuid' })),
  amount: t.Number({ exclusiveMinimum: 0, maximum: 1_000_000_000 }),
  currencyCode: t.Optional(t.String({ minLength: 3, maxLength: 3 })),
  expenseDate: dateStr,
  description: t.Optional(t.String({ maxLength: 500 })),
  splitMemberIds: t.Optional(t.Array(t.String({ format: 'uuid' }), { maxItems: 50 })),
  shares: t.Optional(
    t.Array(t.Object({ memberId: t.String({ format: 'uuid' }), share: money }), { maxItems: 50 }),
  ),
});

export const updateExpenseBody = t.Object({
  categoryId: t.Optional(t.Union([t.String({ format: 'uuid' }), t.Null()])),
  amount: t.Optional(t.Number({ exclusiveMinimum: 0, maximum: 1_000_000_000 })),
  expenseDate: t.Optional(dateStr),
  description: t.Optional(t.String({ maxLength: 500 })),
});

export const expenseQuery = t.Object({
  from: t.Optional(dateStr),
  to: t.Optional(dateStr),
  categoryId: t.Optional(t.String({ format: 'uuid' })),
});

export const createMoneyAllowanceBody = t.Object({
  memberId: t.String({ format: 'uuid' }),
  amount: t.Number({ exclusiveMinimum: 0, maximum: 1_000_000_000 }),
  rrule: t.String({ minLength: 1, maxLength: 500 }),
  name: t.Optional(t.String({ maxLength: 120 })),
});
