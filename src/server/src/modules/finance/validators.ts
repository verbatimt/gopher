// TypeBox request schemas for the finance engine API (EP-0033). Enum membership is enforced
// here; business rules (origin≠destination, amount≠0, date sanity, account existence) are
// enforced in the service so messages come from the module's catalog.

import { t } from 'elysia';
import {
  ACCOUNT_TYPES,
  RECURRENCE_INTERVALS,
  TRANSACTION_CATEGORIES,
  TRANSACTION_ENDINGS,
  TRANSFER_TYPES,
} from '../../db/schema/finance/enums.ts';

const enumOf = (members: readonly string[]) => t.Union(members.map((m) => t.Literal(m)));
const dateStr = t.String({ minLength: 8, maxLength: 10 });
const money = t.Number({ minimum: -1_000_000_000, maximum: 1_000_000_000 });

export const createAccountBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  type: enumOf(ACCOUNT_TYPES),
  notes: t.Optional(t.String({ maxLength: 2000 })),
  currentBalance: t.Optional(money),
});

export const updateAccountBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  type: t.Optional(enumOf(ACCOUNT_TYPES)),
  notes: t.Optional(t.String({ maxLength: 2000 })),
  currentBalance: t.Optional(money),
});

const transactionFields = {
  originAccountId: t.String({ format: 'uuid' }),
  destinationAccountId: t.String({ format: 'uuid' }),
  description: t.String({ minLength: 1, maxLength: 200 }),
  notes: t.Optional(t.String({ maxLength: 2000 })),
  category: enumOf(TRANSACTION_CATEGORIES),
  transferType: enumOf(TRANSFER_TYPES),
  transferAmount: money,
  startDate: dateStr,
  ending: enumOf(TRANSACTION_ENDINGS),
  endDate: t.Optional(dateStr),
  recurrenceCount: t.Optional(t.Integer({ minimum: 1, maximum: 100_000 })),
  intervalUnit: enumOf(RECURRENCE_INTERVALS),
  frequency: t.Optional(t.Integer({ minimum: 1, maximum: 1000 })),
};

export const createTransactionBody = t.Object(transactionFields);

export const updateTransactionBody = t.Partial(t.Object(transactionFields));

export const includedBody = t.Object({ included: t.Boolean() });

export const createForecastBody = t.Object({
  startDate: dateStr,
  endDate: dateStr,
  description: t.String({ minLength: 1, maxLength: 200 }),
});

export const updateForecastBody = t.Object({
  description: t.String({ minLength: 1, maxLength: 200 }),
});
