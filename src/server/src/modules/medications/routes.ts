// Medications HTTP surface (/api/v1/households/:id/medications...). Reads require
// medications:read; writes medications:write. Schedule create/update are additionally
// supervisor-gated in the service; non-supervisors are scoped to their own schedules.

import { Elysia } from 'elysia';
import type { AuthClaims } from '../../auth/context.ts';
import { guard } from '../../auth/guard.ts';
import { Permissions } from '../../auth/permissions.ts';
import { success } from '../../http/envelope.ts';
import { messages } from '../../http/messages.ts';
import { resolveMemberId } from '../households/service.ts';
import {
  type ActorContext,
  createSchedule,
  deactivateSchedule,
  getCompliance,
  getSchedule,
  listDoses,
  listRefills,
  listSchedules,
  logDose,
  logRefill,
  updateSchedule,
} from './service.ts';
import {
  complianceQuery,
  createScheduleBody,
  historyQuery,
  logDoseBody,
  logRefillBody,
  updateScheduleBody,
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

export const medicationsPlugin = new Elysia({ name: 'medications' })
  .use(guard)
  // --- schedules ---
  .get(
    '/households/:id/medications',
    async ({ claims }) => success({ schedules: await listSchedules(await actor(claims!)) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.medicationsRead] },
  )
  .post(
    '/households/:id/medications',
    async ({ claims, body, set }) => {
      const schedule = await createSchedule(await actor(claims!), body);
      set.status = 201;
      return success({ schedule }, { statusCode: 201, message: messages.CREATED });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.medicationsWrite],
      body: createScheduleBody,
    },
  )
  .get(
    '/households/:id/medications/:schedId',
    async ({ claims, params }) =>
      success({ schedule: await getSchedule(await actor(claims!), params.schedId) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.medicationsRead] },
  )
  .patch(
    '/households/:id/medications/:schedId',
    async ({ claims, params, body }) =>
      success({ schedule: await updateSchedule(await actor(claims!), params.schedId, body) }),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.medicationsWrite],
      body: updateScheduleBody,
    },
  )
  .delete(
    '/households/:id/medications/:schedId',
    async ({ claims, params }) =>
      success(await deactivateSchedule(await actor(claims!), params.schedId)),
    { requireHousehold: 'id', requirePermissions: [Permissions.medicationsWrite] },
  )
  // --- doses ---
  .get(
    '/households/:id/medications/:schedId/doses',
    async ({ claims, params, query }) =>
      success({ doses: await listDoses(await actor(claims!), params.schedId, pageOf(query.page)) }),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.medicationsRead],
      query: historyQuery,
    },
  )
  .post(
    '/households/:id/medications/:schedId/doses',
    async ({ claims, params, body, set }) => {
      const dose = await logDose(await actor(claims!), params.schedId, body);
      set.status = 201;
      return success({ dose }, { statusCode: 201, message: messages.CREATED });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.medicationsWrite],
      body: logDoseBody,
    },
  )
  // --- compliance (EP-0025) ---
  .get(
    '/households/:id/medications/:schedId/compliance',
    async ({ claims, params, query }) =>
      success({
        compliance: await getCompliance(await actor(claims!), params.schedId, {
          from: query.from,
          to: query.to,
        }),
      }),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.medicationsRead],
      query: complianceQuery,
    },
  )
  // --- refills ---
  .get(
    '/households/:id/medications/:schedId/refills',
    async ({ claims, params, query }) =>
      success({
        refills: await listRefills(await actor(claims!), params.schedId, pageOf(query.page)),
      }),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.medicationsRead],
      query: historyQuery,
    },
  )
  .post(
    '/households/:id/medications/:schedId/refills',
    async ({ claims, params, body, set }) => {
      const result = await logRefill(await actor(claims!), params.schedId, body);
      set.status = 201;
      return success(result, { statusCode: 201, message: messages.CREATED });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.medicationsWrite],
      body: logRefillBody,
    },
  );
