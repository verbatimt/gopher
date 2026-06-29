// Household + member + invite-management HTTP surface (/api/v1/households/:id/...). All
// routes are tenancy-scoped (requireHousehold) and permission-gated (EP-0012); writes are
// supervisor-only (members:write / household:write).

import { Elysia, t } from 'elysia';
import { AuditActions } from '../../audit/actions.ts';
import { auditLog } from '../../audit/log.ts';
import { guard } from '../../auth/guard.ts';
import { Permissions } from '../../auth/permissions.ts';
import { success } from '../../http/envelope.ts';
import { NotFoundError } from '../../http/errors.ts';
import { messages } from '../../http/messages.ts';
import type { InviteStatus } from '../invites/service.ts';
import { createInvite, listInvites, revokeInvite } from '../invites/service.ts';
import {
  createManagedMember,
  deactivateMember,
  getHousehold,
  getMember,
  listMembers,
  updateHousehold,
  updateMember,
} from './service.ts';

const EMAIL_PATTERN = '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$';

function toHouseholdDto(h: Awaited<ReturnType<typeof getHousehold>>) {
  if (!h) return null;
  return {
    id: h.id,
    name: h.name,
    timezone: h.timezone,
    locale: h.locale,
    activeModules: h.activeModules,
    rewardCurrencyName: h.rewardCurrencyName,
    createdAt: h.createdAt,
  };
}

export const householdsPlugin = new Elysia({ name: 'households' })
  .use(guard)
  // --- household settings ---
  .get(
    '/households/:id',
    async ({ params }) => {
      const household = await getHousehold(params.id);
      if (!household) throw new NotFoundError('Household not found.');
      return success({ household: toHouseholdDto(household) });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.householdRead] },
  )
  .patch(
    '/households/:id',
    async ({ params, body, claims }) => {
      const updated = await updateHousehold(params.id, body);
      if (!updated) throw new NotFoundError('Household not found.');
      await auditLog({
        action: AuditActions.household.settingsUpdated,
        householdId: params.id,
        actorUserId: claims?.userId,
        entityType: 'household',
        entityId: params.id,
        metadata: { fields: Object.keys(body) },
      });
      return success({ household: toHouseholdDto(updated) });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.householdWrite],
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
        timezone: t.Optional(t.String({ maxLength: 64 })),
        locale: t.Optional(t.String({ maxLength: 16 })),
        activeModules: t.Optional(t.Array(t.String({ maxLength: 32 }), { maxItems: 32 })),
      }),
    },
  )
  // --- members ---
  .get(
    '/households/:id/members',
    async ({ params }) => success({ members: await listMembers(params.id) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.householdRead] },
  )
  .get(
    '/households/:id/members/:memberId',
    async ({ params }) => {
      const member = await getMember(params.id, params.memberId);
      if (!member) throw new NotFoundError('Member not found.');
      return success({ member });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.householdRead] },
  )
  .post(
    '/households/:id/members',
    async ({ params, body, claims, set }) => {
      const member = await createManagedMember(params.id, body);
      await auditLog({
        action: AuditActions.household.memberAdded,
        householdId: params.id,
        actorUserId: claims?.userId,
        entityType: 'household_member',
        entityId: member.id,
      });
      set.status = 201;
      return success({ member }, { statusCode: 201, message: messages.CREATED });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.membersWrite],
      body: t.Object({
        displayName: t.String({ minLength: 1, maxLength: 80 }),
        dateOfBirth: t.Optional(t.String({ maxLength: 32 })),
        avatarUrl: t.Optional(t.String({ maxLength: 500 })),
      }),
    },
  )
  .patch(
    '/households/:id/members/:memberId',
    async ({ params, body, claims }) => {
      const { member, roleChanged } = await updateMember(
        params.id,
        params.memberId,
        body,
        claims?.userId ?? null,
      );
      if (roleChanged) {
        await auditLog({
          action: AuditActions.household.memberRoleChanged,
          householdId: params.id,
          actorUserId: claims?.userId,
          entityType: 'household_member',
          entityId: params.memberId,
          metadata: { role: member.role },
        });
      }
      return success({ member });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.membersWrite],
      body: t.Object({
        displayName: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
        avatarUrl: t.Optional(t.String({ maxLength: 500 })),
        role: t.Optional(t.String({ maxLength: 40 })),
      }),
    },
  )
  .delete(
    '/households/:id/members/:memberId',
    async ({ params, claims }) => {
      const member = await deactivateMember(params.id, params.memberId);
      await auditLog({
        action: AuditActions.household.memberDeactivated,
        householdId: params.id,
        actorUserId: claims?.userId,
        entityType: 'household_member',
        entityId: params.memberId,
      });
      return success({ member });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.membersWrite] },
  )
  // --- invites (management; acceptance is POST /auth/accept-invite) ---
  .post(
    '/households/:id/invites',
    async ({ params, body, claims, set }) => {
      const { invite, rawToken } = await createInvite(
        params.id,
        claims!.userId,
        body.email,
        body.role,
      );
      await auditLog({
        action: AuditActions.household.inviteCreated,
        householdId: params.id,
        actorUserId: claims?.userId,
        entityType: 'household_invite',
        entityId: invite.id,
        metadata: { email: invite.email },
      });
      set.status = 201;
      // The raw token is returned for out-of-band sharing (no email provider on the LAN).
      return success({ invite, token: rawToken }, { statusCode: 201, message: messages.CREATED });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.membersWrite],
      body: t.Object({
        email: t.String({ pattern: EMAIL_PATTERN, maxLength: 254 }),
        role: t.String({ maxLength: 40 }),
      }),
    },
  )
  .get(
    '/households/:id/invites',
    async ({ params, query }) =>
      success({ invites: await listInvites(params.id, query.status as InviteStatus | undefined) }),
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.membersWrite],
      query: t.Object({ status: t.Optional(t.String({ maxLength: 16 })) }),
    },
  )
  .delete(
    '/households/:id/invites/:inviteId',
    async ({ params, claims }) => {
      const invite = await revokeInvite(params.id, params.inviteId);
      await auditLog({
        action: AuditActions.household.inviteRevoked,
        householdId: params.id,
        actorUserId: claims?.userId,
        entityType: 'household_invite',
        entityId: params.inviteId,
      });
      return success({ invite });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.membersWrite] },
  );
