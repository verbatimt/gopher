// Finance engine HTTP surface (/api/v1/households/:id/finance/...). Reads require finance:read,
// writes finance:write. SupervisedUser holds neither, so every endpoint 403s for that role.

import { Elysia } from 'elysia';
import type { AuthClaims } from '../../auth/context.ts';
import { guard } from '../../auth/guard.ts';
import { Permissions } from '../../auth/permissions.ts';
import { success } from '../../http/envelope.ts';
import { messages } from '../../http/messages.ts';
import { computeForecastSummary } from './analytics.ts';
import {
  type ActorContext,
  createAccount,
  createForecast,
  createTransaction,
  deactivateAccount,
  deactivateForecast,
  deactivateTransaction,
  getAccount,
  getForecast,
  getTransaction,
  listAccounts,
  listForecasts,
  listTransactions,
  setIncluded,
  updateAccount,
  updateForecast,
  updateTransaction,
} from './service.ts';
import {
  createAccountBody,
  createForecastBody,
  createTransactionBody,
  includedBody,
  updateAccountBody,
  updateForecastBody,
  updateTransactionBody,
} from './validators.ts';

const actor = (claims: AuthClaims): ActorContext => ({
  userId: claims.userId,
  householdId: claims.householdId,
});
const read = (id: string) => ({
  requireHousehold: id,
  requirePermissions: [Permissions.financeRead],
});
const write = (id: string) => ({
  requireHousehold: id,
  requirePermissions: [Permissions.financeWrite],
});

export const financePlugin = new Elysia({ name: 'finance' })
  .use(guard)
  // --- accounts ---
  .get(
    '/households/:id/finance/accounts',
    async ({ claims }) => success({ accounts: await listAccounts(actor(claims!)) }),
    read('id'),
  )
  .post(
    '/households/:id/finance/accounts',
    async ({ claims, body, set }) => {
      const account = await createAccount(actor(claims!), body);
      set.status = 201;
      return success({ account }, { statusCode: 201, message: messages.CREATED });
    },
    { ...write('id'), body: createAccountBody },
  )
  .get(
    '/households/:id/finance/accounts/:accountId',
    async ({ claims, params }) =>
      success({ account: await getAccount(actor(claims!), params.accountId) }),
    read('id'),
  )
  .patch(
    '/households/:id/finance/accounts/:accountId',
    async ({ claims, params, body }) =>
      success({ account: await updateAccount(actor(claims!), params.accountId, body) }),
    { ...write('id'), body: updateAccountBody },
  )
  .delete(
    '/households/:id/finance/accounts/:accountId',
    async ({ claims, params }) =>
      success(await deactivateAccount(actor(claims!), params.accountId)),
    write('id'),
  )
  // --- transactions ---
  .get(
    '/households/:id/finance/transactions',
    async ({ claims }) => success({ transactions: await listTransactions(actor(claims!)) }),
    read('id'),
  )
  .post(
    '/households/:id/finance/transactions',
    async ({ claims, body, set }) => {
      const transaction = await createTransaction(actor(claims!), body);
      set.status = 201;
      return success({ transaction }, { statusCode: 201, message: messages.CREATED });
    },
    { ...write('id'), body: createTransactionBody },
  )
  .get(
    '/households/:id/finance/transactions/:txId',
    async ({ claims, params }) =>
      success({ transaction: await getTransaction(actor(claims!), params.txId) }),
    read('id'),
  )
  .patch(
    '/households/:id/finance/transactions/:txId',
    async ({ claims, params, body }) =>
      success({ transaction: await updateTransaction(actor(claims!), params.txId, body) }),
    { ...write('id'), body: updateTransactionBody },
  )
  .patch(
    '/households/:id/finance/transactions/:txId/included',
    async ({ claims, params, body }) =>
      success({ transaction: await setIncluded(actor(claims!), params.txId, body.included) }),
    { ...write('id'), body: includedBody },
  )
  .delete(
    '/households/:id/finance/transactions/:txId',
    async ({ claims, params }) => success(await deactivateTransaction(actor(claims!), params.txId)),
    write('id'),
  )
  // --- forecasts ---
  .get(
    '/households/:id/finance/forecasts',
    async ({ claims }) => success({ forecasts: await listForecasts(actor(claims!)) }),
    read('id'),
  )
  .post(
    '/households/:id/finance/forecasts',
    async ({ claims, body, set }) => {
      const forecast = await createForecast(actor(claims!), body);
      set.status = 201;
      return success(forecast, { statusCode: 201, message: messages.CREATED });
    },
    { ...write('id'), body: createForecastBody },
  )
  .get(
    '/households/:id/finance/forecasts/:forecastId',
    async ({ claims, params }) => success(await getForecast(actor(claims!), params.forecastId)),
    read('id'),
  )
  .get(
    '/households/:id/finance/forecasts/:forecastId/summary',
    async ({ claims, params }) =>
      success(await computeForecastSummary(actor(claims!), params.forecastId)),
    read('id'),
  )
  .patch(
    '/households/:id/finance/forecasts/:forecastId',
    async ({ claims, params, body }) =>
      success({
        forecast: await updateForecast(actor(claims!), params.forecastId, body.description),
      }),
    { ...write('id'), body: updateForecastBody },
  )
  .delete(
    '/households/:id/finance/forecasts/:forecastId',
    async ({ claims, params }) =>
      success(await deactivateForecast(actor(claims!), params.forecastId)),
    write('id'),
  );
