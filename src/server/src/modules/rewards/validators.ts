// TypeBox request schemas for the rewards API (EP-0027). Adjust requires a non-empty `notes`
// (mandatory audit reason); points/costs are non-negative integers.

import { t } from 'elysia';

export const createRuleBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  points: t.Integer({ minimum: 0, maximum: 1_000_000 }),
});

export const updateRuleBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  points: t.Optional(t.Integer({ minimum: 0, maximum: 1_000_000 })),
});

export const createItemBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  description: t.Optional(t.String({ maxLength: 2000 })),
  pointCost: t.Integer({ minimum: 0, maximum: 1_000_000 }),
  redemptionCap: t.Optional(t.Integer({ minimum: 1, maximum: 1_000_000 })),
  cooldownMinutes: t.Optional(t.Integer({ minimum: 1, maximum: 1_440_000 })),
});

export const updateItemBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  description: t.Optional(t.String({ maxLength: 2000 })),
  pointCost: t.Optional(t.Integer({ minimum: 0, maximum: 1_000_000 })),
  redemptionCap: t.Optional(t.Integer({ minimum: 1, maximum: 1_000_000 })),
  cooldownMinutes: t.Optional(t.Integer({ minimum: 1, maximum: 1_440_000 })),
});

// Mandatory notes — an adjustment must always carry a reason.
export const adjustBody = t.Object({
  amount: t.Integer({ minimum: -1_000_000, maximum: 1_000_000 }),
  notes: t.String({ minLength: 1, maxLength: 2000 }),
});

export const decideBody = t.Object({
  decision: t.Union([t.Literal('approve'), t.Literal('reject')]),
});

export const createAllowanceBody = t.Object({
  memberId: t.String({ format: 'uuid' }),
  points: t.Integer({ minimum: 1, maximum: 1_000_000 }),
  rrule: t.String({ minLength: 1, maxLength: 500 }),
  name: t.Optional(t.String({ maxLength: 120 })),
});

export const historyQuery = t.Object({
  page: t.Optional(t.String({ maxLength: 8 })),
});
