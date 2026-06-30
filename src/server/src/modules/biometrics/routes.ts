// Biometrics/vitals HTTP surface (/api/v1/households/:id/...). Reads require vitals:read;
// writes vitals:write. Type management and recording-for-another-member are additionally
// gated in the service; non-supervisors are scoped to their own readings/targets.

import { Elysia } from 'elysia';
import type { AuthClaims } from '../../auth/context.ts';
import { guard } from '../../auth/guard.ts';
import { Permissions } from '../../auth/permissions.ts';
import { success } from '../../http/envelope.ts';
import { messages } from '../../http/messages.ts';
import { resolveMemberId } from '../households/service.ts';
import {
  type ActorContext,
  createType,
  deactivateType,
  deleteMeasurement,
  getMeasurement,
  getTrends,
  listMeasurements,
  listTargets,
  listTypes,
  recordMeasurement,
  updateMeasurement,
  updateType,
  upsertTarget,
} from './service.ts';
import {
  createTypeBody,
  historyQuery,
  recordMeasurementBody,
  trendsQuery,
  updateMeasurementBody,
  updateTypeBody,
  upsertTargetBody,
} from './validators.ts';

async function actor(claims: AuthClaims): Promise<ActorContext> {
  return {
    userId: claims.userId,
    householdId: claims.householdId,
    memberId: await resolveMemberId(claims.householdId, claims.userId),
    roles: claims.roles,
  };
}

const pageOf = (raw?: string): number => (raw ? Math.max(1, Number.parseInt(raw, 10) || 1) : 1);

export const biometricsPlugin = new Elysia({ name: 'biometrics' })
  .use(guard)
  // --- measurement types ---
  .get(
    '/households/:id/measurement-types',
    async ({ claims }) => success({ types: await listTypes(await actor(claims!)) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.vitalsRead] },
  )
  .post(
    '/households/:id/measurement-types',
    async ({ claims, body, set }) => {
      const type = await createType(await actor(claims!), body);
      set.status = 201;
      return success({ type }, { statusCode: 201, message: messages.CREATED });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.vitalsWrite],
      body: createTypeBody,
    },
  )
  .patch(
    '/households/:id/measurement-types/:typeId',
    async ({ claims, params, body }) =>
      success({ type: await updateType(await actor(claims!), params.typeId, body) }),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.vitalsWrite],
      body: updateTypeBody,
    },
  )
  .delete(
    '/households/:id/measurement-types/:typeId',
    async ({ claims, params }) =>
      success(await deactivateType(await actor(claims!), params.typeId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.vitalsWrite] },
  )
  // --- measurements ---
  .get(
    '/households/:id/members/:memberId/measurements',
    async ({ claims, params, query }) =>
      success({
        measurements: await listMeasurements(await actor(claims!), params.memberId, {
          typeKey: query.typeKey,
          from: query.from,
          to: query.to,
          page: pageOf(query.page),
        }),
      }),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.vitalsRead],
      query: historyQuery,
    },
  )
  .post(
    '/households/:id/members/:memberId/measurements',
    async ({ claims, params, body, set }) => {
      const measurement = await recordMeasurement(await actor(claims!), params.memberId, body);
      set.status = 201;
      return success({ measurement }, { statusCode: 201, message: messages.CREATED });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.vitalsWrite],
      body: recordMeasurementBody,
    },
  )
  // --- trends (specific route before :measurementId to avoid collision) ---
  .get(
    '/households/:id/members/:memberId/measurements/trends',
    async ({ claims, params, query }) =>
      success({
        trends: await getTrends(await actor(claims!), params.memberId, {
          typeKey: query.typeKey,
          from: query.from,
          to: query.to,
        }),
      }),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.vitalsRead],
      query: trendsQuery,
    },
  )
  .get(
    '/households/:id/members/:memberId/measurements/:measurementId',
    async ({ claims, params }) =>
      success({
        measurement: await getMeasurement(
          await actor(claims!),
          params.memberId,
          params.measurementId,
        ),
      }),
    { requireHousehold: 'id', requirePermissions: [Permissions.vitalsRead] },
  )
  .patch(
    '/households/:id/members/:memberId/measurements/:measurementId',
    async ({ claims, params, body }) =>
      success({
        measurement: await updateMeasurement(
          await actor(claims!),
          params.memberId,
          params.measurementId,
          body,
        ),
      }),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.vitalsWrite],
      body: updateMeasurementBody,
    },
  )
  .delete(
    '/households/:id/members/:memberId/measurements/:measurementId',
    async ({ claims, params }) =>
      success(await deleteMeasurement(await actor(claims!), params.memberId, params.measurementId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.vitalsWrite] },
  )
  // --- targets ---
  .get(
    '/households/:id/members/:memberId/measurement-targets',
    async ({ claims, params }) =>
      success({ targets: await listTargets(await actor(claims!), params.memberId) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.vitalsRead] },
  )
  .put(
    '/households/:id/members/:memberId/measurement-targets/:typeKey',
    async ({ claims, params, body }) =>
      success({
        target: await upsertTarget(await actor(claims!), params.memberId, params.typeKey, body),
      }),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.vitalsWrite],
      body: upsertTargetBody,
    },
  );
