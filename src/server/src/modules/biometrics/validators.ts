// TypeBox request schemas for the biometrics/vitals API (EP-0043). Measured values are
// numeric (validated for range sanity in the service, not here). Kept separate from routes
// so the client mirrors the same shapes.

import { t } from 'elysia';

export const createTypeBody = t.Object({
  key: t.String({ minLength: 1, maxLength: 50, pattern: '^[a-z0-9_]+$' }),
  displayName: t.String({ minLength: 1, maxLength: 100 }),
  valueShape: t.Optional(t.Union([t.Literal('single'), t.Literal('dual')])),
  unitDefault: t.String({ minLength: 1, maxLength: 20 }),
  precision: t.Optional(t.Integer({ minimum: 0, maximum: 6 })),
  minNormal: t.Optional(t.Union([t.Number(), t.Null()])),
  maxNormal: t.Optional(t.Union([t.Number(), t.Null()])),
});

export const updateTypeBody = t.Object({
  displayName: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  unitDefault: t.Optional(t.String({ minLength: 1, maxLength: 20 })),
  precision: t.Optional(t.Integer({ minimum: 0, maximum: 6 })),
  minNormal: t.Optional(t.Union([t.Number(), t.Null()])),
  maxNormal: t.Optional(t.Union([t.Number(), t.Null()])),
});

export const recordMeasurementBody = t.Object({
  typeKey: t.String({ minLength: 1, maxLength: 50 }),
  valueNumeric: t.Number(),
  valueSecondary: t.Optional(t.Union([t.Number(), t.Null()])),
  unit: t.Optional(t.String({ minLength: 1, maxLength: 20 })),
  measuredAt: t.Optional(t.String()),
  notes: t.Optional(t.String({ maxLength: 2000 })),
});

export const updateMeasurementBody = t.Object({
  valueNumeric: t.Optional(t.Number()),
  valueSecondary: t.Optional(t.Union([t.Number(), t.Null()])),
  unit: t.Optional(t.String({ minLength: 1, maxLength: 20 })),
  measuredAt: t.Optional(t.String()),
  notes: t.Optional(t.Union([t.String({ maxLength: 2000 }), t.Null()])),
});

export const upsertTargetBody = t.Object({
  minTarget: t.Optional(t.Union([t.Number(), t.Null()])),
  maxTarget: t.Optional(t.Union([t.Number(), t.Null()])),
  goalValue: t.Optional(t.Union([t.Number(), t.Null()])),
});

export const historyQuery = t.Object({
  typeKey: t.Optional(t.String({ maxLength: 50 })),
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
  page: t.Optional(t.String({ maxLength: 8 })),
});

export const trendsQuery = t.Object({
  typeKey: t.Optional(t.String({ maxLength: 50 })),
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
});
