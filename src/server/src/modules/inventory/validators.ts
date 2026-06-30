// TypeBox request schemas for the inventory API (EP-0048). Quantities/thresholds are
// numeric (non-negative); item-quantity is changed only via /adjust (signed delta + reason).

import { t } from 'elysia';

const dateStr = t.String({ minLength: 8, maxLength: 10 });

export const createItemBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 200 }),
  category: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
  unit: t.Optional(t.Union([t.String({ maxLength: 50 }), t.Null()])),
  quantity: t.Optional(t.Number({ minimum: 0 })),
  location: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
  lowThreshold: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  expiresAt: t.Optional(t.Union([dateStr, t.Null()])),
  barcode: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
  autoAddToGrocery: t.Optional(t.Boolean()),
  notes: t.Optional(t.Union([t.String({ maxLength: 2000 }), t.Null()])),
});

export const updateItemBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  category: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
  unit: t.Optional(t.Union([t.String({ maxLength: 50 }), t.Null()])),
  location: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
  lowThreshold: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  expiresAt: t.Optional(t.Union([dateStr, t.Null()])),
  barcode: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
  autoAddToGrocery: t.Optional(t.Boolean()),
  notes: t.Optional(t.Union([t.String({ maxLength: 2000 }), t.Null()])),
});

export const adjustBody = t.Object({
  delta: t.Number(),
  reason: t.Union([
    t.Literal('restock'),
    t.Literal('consume'),
    t.Literal('correction'),
    t.Literal('expired'),
  ]),
  note: t.Optional(t.Union([t.String({ maxLength: 500 }), t.Null()])),
});

export const listQuery = t.Object({
  category: t.Optional(t.String({ maxLength: 100 })),
  location: t.Optional(t.String({ maxLength: 100 })),
  lowStock: t.Optional(t.String({ maxLength: 8 })),
  search: t.Optional(t.String({ maxLength: 200 })),
  expiringBefore: t.Optional(dateStr),
  page: t.Optional(t.String({ maxLength: 8 })),
});

export const historyQuery = t.Object({
  page: t.Optional(t.String({ maxLength: 8 })),
});
