// TypeBox request schemas for the medications API (EP-0024). Dosages/stock/threshold are
// non-negative numbers; the dosing `rrule` is a free-form RRULE pattern validated for
// parseability in the service (EP-0018). Kept separate from routes so the client mirrors
// the same shapes.

import { t } from 'elysia';

export const createScheduleBody = t.Object({
  memberId: t.String({ format: 'uuid' }),
  medicationName: t.String({ minLength: 1, maxLength: 200 }),
  dosageAmount: t.Number({ minimum: 0 }),
  dosageUnit: t.String({ minLength: 1, maxLength: 50 }),
  rrule: t.String({ minLength: 1, maxLength: 500 }),
  startDate: t.String({ minLength: 8, maxLength: 10 }),
  endDate: t.Optional(t.String({ minLength: 8, maxLength: 10 })),
  stockQuantity: t.Optional(t.Number({ minimum: 0 })),
  refillThreshold: t.Optional(t.Number({ minimum: 0 })),
  doseWindowMinutes: t.Optional(t.Integer({ minimum: 1, maximum: 1440 })),
  notes: t.Optional(t.String({ maxLength: 2000 })),
});

export const updateScheduleBody = t.Object({
  medicationName: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  dosageAmount: t.Optional(t.Number({ minimum: 0 })),
  dosageUnit: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
  rrule: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
  startDate: t.Optional(t.String({ minLength: 8, maxLength: 10 })),
  endDate: t.Optional(t.Union([t.String({ minLength: 8, maxLength: 10 }), t.Null()])),
  stockQuantity: t.Optional(t.Number({ minimum: 0 })),
  refillThreshold: t.Optional(t.Number({ minimum: 0 })),
  doseWindowMinutes: t.Optional(t.Integer({ minimum: 1, maximum: 1440 })),
  notes: t.Optional(t.String({ maxLength: 2000 })),
});

export const logDoseBody = t.Object({
  takenAt: t.Optional(t.String()),
  status: t.Optional(t.Union([t.Literal('taken'), t.Literal('skipped')])),
  notes: t.Optional(t.String({ maxLength: 2000 })),
});

export const logRefillBody = t.Object({
  quantityAdded: t.Number({ exclusiveMinimum: 0 }),
  refillDate: t.Optional(t.String({ minLength: 8, maxLength: 10 })),
  notes: t.Optional(t.String({ maxLength: 2000 })),
});

export const historyQuery = t.Object({
  page: t.Optional(t.String({ maxLength: 8 })),
});

export const complianceQuery = t.Object({
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
});
