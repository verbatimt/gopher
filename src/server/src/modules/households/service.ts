// Household + member management business logic. Write operations are supervisor-gated at
// the route (EP-0012). Role changes and deletions enforce the owner + last-supervisor
// invariants inside a transaction with row locks (EP-0014 risk: concurrent demotions).

import { and, eq } from 'drizzle-orm';
import { recordValueChange } from '../../audit/value-change.ts';
import { Roles } from '../../auth/permissions.ts';
import { db, withTransaction } from '../../db/index.ts';
import { householdMembers, households, roles, userRoles } from '../../db/schema/index.ts';
import { ConflictError, InvalidError, NotFoundError } from '../../http/errors.ts';

export type HouseholdRow = typeof households.$inferSelect;

export interface MemberDto {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  dateOfBirth: string | null;
  isManaged: boolean;
  isOwner: boolean;
  hasLogin: boolean;
  role: string;
}

function toMemberDto(member: typeof householdMembers.$inferSelect, roleName: string): MemberDto {
  return {
    id: member.id,
    displayName: member.displayName,
    avatarUrl: member.avatarUrl,
    dateOfBirth: member.dateOfBirth,
    isManaged: member.isManaged,
    isOwner: member.isOwner,
    hasLogin: member.userId !== null,
    role: roleName,
  };
}

/** Resolve the household_members id for a (household, user) pair, or null. */
export async function resolveMemberId(householdId: string, userId: string): Promise<string | null> {
  const [member] = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.userId, userId),
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.isActive, true),
      ),
    )
    .limit(1);
  return member?.id ?? null;
}

export async function getHousehold(id: string): Promise<HouseholdRow | null> {
  const [row] = await db
    .select()
    .from(households)
    .where(and(eq(households.id, id), eq(households.isActive, true)))
    .limit(1);
  return row ?? null;
}

export interface HouseholdPatch {
  name?: string;
  timezone?: string;
  locale?: string;
  activeModules?: string[];
}

export async function updateHousehold(
  id: string,
  patch: HouseholdPatch,
): Promise<HouseholdRow | null> {
  const [row] = await db
    .update(households)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(households.id, id))
    .returning();
  return row ?? null;
}

export async function listMembers(householdId: string): Promise<MemberDto[]> {
  const rows = await db
    .select({ member: householdMembers, roleName: roles.name })
    .from(householdMembers)
    .innerJoin(roles, eq(roles.id, householdMembers.roleId))
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.isActive, true)));
  return rows.map((r) => toMemberDto(r.member, r.roleName));
}

export async function getMember(householdId: string, memberId: string): Promise<MemberDto | null> {
  const [row] = await db
    .select({ member: householdMembers, roleName: roles.name })
    .from(householdMembers)
    .innerJoin(roles, eq(roles.id, householdMembers.roleId))
    .where(
      and(
        eq(householdMembers.id, memberId),
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.isActive, true),
      ),
    )
    .limit(1);
  return row ? toMemberDto(row.member, row.roleName) : null;
}

export interface CreateManagedInput {
  displayName: string;
  dateOfBirth?: string;
  avatarUrl?: string;
}

/** Create a managed/dependent profile (no login), defaulting to supervised_user. */
export async function createManagedMember(
  householdId: string,
  input: CreateManagedInput,
): Promise<MemberDto> {
  const [role] = await db.select().from(roles).where(eq(roles.name, Roles.supervisedUser));
  const [member] = await db
    .insert(householdMembers)
    .values({
      householdId,
      userId: null,
      displayName: input.displayName,
      dateOfBirth: input.dateOfBirth ?? null,
      avatarUrl: input.avatarUrl ?? null,
      isManaged: true,
      isOwner: false,
      roleId: role!.id,
    })
    .returning();
  return toMemberDto(member!, Roles.supervisedUser);
}

export interface MemberPatch {
  displayName?: string;
  avatarUrl?: string;
  role?: string;
}

/** Update a member; enforces owner-stays-supervisor and last-supervisor invariants. */
export async function updateMember(
  householdId: string,
  memberId: string,
  patch: MemberPatch,
  actorUserId: string | null,
): Promise<{ member: MemberDto; roleChanged: boolean }> {
  return withTransaction(async (tx) => {
    const [member] = await tx
      .select()
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.id, memberId),
          eq(householdMembers.householdId, householdId),
          eq(householdMembers.isActive, true),
        ),
      )
      .limit(1)
      .for('update');
    if (!member) throw new NotFoundError('Member not found.');

    const updates: Partial<typeof householdMembers.$inferInsert> = {};
    if (patch.displayName !== undefined) updates.displayName = patch.displayName;
    if (patch.avatarUrl !== undefined) updates.avatarUrl = patch.avatarUrl;

    const [currentRole] = await tx.select().from(roles).where(eq(roles.id, member.roleId));
    const oldRoleName = currentRole?.name;
    let newRoleName = oldRoleName;
    let roleChanged = false;

    if (patch.role && patch.role !== oldRoleName) {
      const [newRole] = await tx.select().from(roles).where(eq(roles.name, patch.role));
      if (!newRole) throw new InvalidError('Unknown role.');

      // The owner must remain a supervisor.
      if (member.isOwner && newRole.name !== Roles.supervisingUser) {
        throw new ConflictError('The household owner must remain a supervisor.');
      }
      // Cannot demote the last supervisor.
      if (oldRoleName === Roles.supervisingUser && newRole.name !== Roles.supervisingUser) {
        const supervisors = await tx
          .select({ id: householdMembers.id })
          .from(householdMembers)
          .innerJoin(roles, eq(roles.id, householdMembers.roleId))
          .where(
            and(
              eq(householdMembers.householdId, householdId),
              eq(householdMembers.isActive, true),
              eq(roles.name, Roles.supervisingUser),
            ),
          );
        if (supervisors.length <= 1) {
          throw new ConflictError('Cannot demote the last supervisor.');
        }
      }

      updates.roleId = newRole.id;
      newRoleName = newRole.name;
      roleChanged = true;

      // Keep the user_roles grant in sync for members with a login.
      if (member.userId) {
        await tx
          .update(userRoles)
          .set({ roleId: newRole.id })
          .where(and(eq(userRoles.userId, member.userId), eq(userRoles.householdId, householdId)));
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
    }
    const [updated] = await tx
      .update(householdMembers)
      .set(updates)
      .where(eq(householdMembers.id, memberId))
      .returning();

    if (roleChanged && oldRoleName && newRoleName) {
      await recordValueChange(
        {
          entityType: 'household_member',
          entityId: memberId,
          fieldName: 'role',
          oldValue: oldRoleName,
          newValue: newRoleName,
          changedBy: actorUserId,
          householdId,
        },
        tx,
      );
    }

    return { member: toMemberDto(updated!, newRoleName ?? Roles.supervisedUser), roleChanged };
  });
}

/** Soft-deactivate a member; the owner cannot be removed. */
export async function deactivateMember(householdId: string, memberId: string): Promise<MemberDto> {
  const [row] = await db
    .select({ member: householdMembers, roleName: roles.name })
    .from(householdMembers)
    .innerJoin(roles, eq(roles.id, householdMembers.roleId))
    .where(
      and(
        eq(householdMembers.id, memberId),
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.isActive, true),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Member not found.');
  if (row.member.isOwner) throw new ConflictError('The household owner cannot be removed.');

  await db
    .update(householdMembers)
    .set({ isActive: false, deletedAt: new Date() })
    .where(eq(householdMembers.id, memberId));
  return toMemberDto(row.member, row.roleName);
}
