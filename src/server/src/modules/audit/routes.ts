// Audit read HTTP surface (EP-0051). Household action log + value-change history, gated by
// audit:read (Owner / supervising_user / system roles). The system-logs endpoint is restricted
// to system actors. Reads are household-scoped via the route :id; rows are never cross-tenant.

import { Elysia } from 'elysia';
import type { AuthClaims } from '../../auth/context.ts';
import { guard } from '../../auth/guard.ts';
import { Permissions } from '../../auth/permissions.ts';
import { isSystemActor } from '../../auth/scope.ts';
import { success } from '../../http/envelope.ts';
import { ForbiddenError } from '../../http/errors.ts';
import { resolveMemberId } from '../households/service.ts';
import { type ActorContext, listAuditLogs, listSystemLogs, listValueChanges } from './service.ts';
import { auditLogQuery, systemLogQuery, valueChangeQuery } from './validators.ts';

async function actor(claims: AuthClaims): Promise<ActorContext> {
  return {
    userId: claims.userId,
    householdId: claims.householdId,
    memberId: await resolveMemberId(claims.householdId, claims.userId),
    roles: claims.roles,
  };
}

const pageOf = (raw?: string): number => (raw ? Math.max(1, Number.parseInt(raw, 10) || 1) : 1);

export const auditPlugin = new Elysia({ name: 'audit' })
  .use(guard)
  .get(
    '/households/:id/audit-logs',
    async ({ claims, query }) =>
      success({
        logs: await listAuditLogs(await actor(claims!), {
          actor: query.actor,
          action: query.action,
          entityType: query.entityType,
          entityId: query.entityId,
          from: query.from,
          to: query.to,
          page: pageOf(query.page),
        }),
      }),
    { requireHousehold: 'id', requirePermissions: [Permissions.auditRead], query: auditLogQuery },
  )
  .get(
    '/households/:id/value-change-history',
    async ({ claims, query }) =>
      success({
        changes: await listValueChanges(await actor(claims!), {
          entityType: query.entityType,
          entityId: query.entityId,
          field: query.field,
          from: query.from,
          to: query.to,
          page: pageOf(query.page),
        }),
      }),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.auditRead],
      query: valueChangeQuery,
    },
  )
  // System-level events (household_id IS NULL): system roles only.
  .get(
    '/audit/system-logs',
    async ({ claims, query }) => {
      if (!claims || !isSystemActor(claims.roles)) throw new ForbiddenError();
      return success({
        logs: await listSystemLogs({
          action: query.action,
          from: query.from,
          to: query.to,
          page: pageOf(query.page),
        }),
      });
    },
    { requirePermissions: [Permissions.auditRead], query: systemLogQuery },
  );
