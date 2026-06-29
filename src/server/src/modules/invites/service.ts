// Invitation lifecycle: create (hashed token, 7-day expiry, no duplicate pending),
// list (with derived status), revoke, and accept (link/create user + member + role grant
// atomically). Token issuance for the accepted user happens in the auth route.

import { and, eq } from 'drizzle-orm';
import { db, withTransaction } from '../../db/index.ts';
import {
  householdInvites,
  householdMembers,
  roles,
  userRoles,
  users,
} from '../../db/schema/index.ts';
import {
  BadRequestError,
  ConflictError,
  DuplicateError,
  GoneError,
  InvalidError,
  NotFoundError,
} from '../../http/errors.ts';
import { hashPassword } from '../auth/password.ts';
import { generateToken, sha256 } from '../auth/tokens.ts';

export const INVITE_TTL_DAYS = 7;

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export function inviteStatus(invite: typeof householdInvites.$inferSelect): InviteStatus {
  if (invite.acceptedAt) return 'accepted';
  if (invite.revokedAt) return 'revoked';
  if (invite.expiresAt.getTime() < Date.now()) return 'expired';
  return 'pending';
}

export interface InviteDto {
  id: string;
  email: string;
  status: InviteStatus;
  expiresAt: Date;
  createdAt: Date;
}

function toInviteDto(invite: typeof householdInvites.$inferSelect): InviteDto {
  return {
    id: invite.id,
    email: invite.email,
    status: inviteStatus(invite),
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
  };
}

/** Create an invite (hashed token, 7-day expiry). Duplicate pending → 409. */
export async function createInvite(
  householdId: string,
  invitedBy: string,
  email: string,
  roleName: string,
): Promise<{ invite: InviteDto; rawToken: string }> {
  const normalizedEmail = email.toLowerCase();
  const [role] = await db.select().from(roles).where(eq(roles.name, roleName));
  if (!role) throw new InvalidError('Unknown role.');

  const rawToken = generateToken(32);
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  try {
    const [invite] = await db
      .insert(householdInvites)
      .values({
        householdId,
        invitedBy,
        email: normalizedEmail,
        tokenHash,
        roleId: role.id,
        expiresAt,
      })
      .returning();
    return { invite: toInviteDto(invite!), rawToken };
  } catch {
    // Partial unique index on (household, email) WHERE pending.
    throw new DuplicateError('An invitation for this email is already pending.');
  }
}

export async function listInvites(
  householdId: string,
  status?: InviteStatus,
): Promise<InviteDto[]> {
  const rows = await db
    .select()
    .from(householdInvites)
    .where(eq(householdInvites.householdId, householdId));
  const dtos = rows.map(toInviteDto);
  return status ? dtos.filter((d) => d.status === status) : dtos;
}

export async function revokeInvite(householdId: string, inviteId: string): Promise<InviteDto> {
  const [invite] = await db
    .select()
    .from(householdInvites)
    .where(and(eq(householdInvites.id, inviteId), eq(householdInvites.householdId, householdId)))
    .limit(1);
  if (!invite) throw new NotFoundError('Invitation not found.');
  if (inviteStatus(invite) === 'pending') {
    await db
      .update(householdInvites)
      .set({ revokedAt: new Date() })
      .where(eq(householdInvites.id, inviteId));
  }
  const [updated] = await db
    .select()
    .from(householdInvites)
    .where(eq(householdInvites.id, inviteId))
    .limit(1);
  return toInviteDto(updated!);
}

export interface AcceptInviteInput {
  token: string;
  /** When accepting while signed in. */
  userId?: string;
  /** When accepting by creating an account (uses the invite's email). */
  password?: string;
  displayName?: string;
}

/** Validate + accept an invite, creating/linking the user, member, and role grant. */
export async function acceptInvite(
  input: AcceptInviteInput,
): Promise<{ userId: string; householdId: string }> {
  const [invite] = await db
    .select()
    .from(householdInvites)
    .where(eq(householdInvites.tokenHash, sha256(input.token)))
    .limit(1);
  if (!invite) throw new NotFoundError('Invalid invitation.');

  const status = inviteStatus(invite);
  if (status === 'accepted') throw new ConflictError('This invitation has already been accepted.');
  if (status === 'revoked' || status === 'expired') {
    throw new GoneError('This invitation is no longer valid.');
  }

  return withTransaction(async (tx) => {
    let userId = input.userId;

    if (!userId) {
      if (!input.password || !input.displayName) {
        throw new BadRequestError('An account password and display name are required.');
      }
      const existing = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, invite.email))
        .limit(1);
      if (existing.length > 0) {
        throw new ConflictError('An account with this email already exists — sign in to accept.');
      }
      const passwordHash = await hashPassword(input.password);
      const [created] = await tx
        .insert(users)
        .values({ email: invite.email, passwordHash, displayName: input.displayName })
        .returning();
      userId = created!.id;
    }

    // Resolve a display name for the member row.
    let displayName = input.displayName;
    if (!displayName) {
      const [u] = await tx
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      displayName = u?.displayName ?? invite.email;
    }

    await tx.insert(householdMembers).values({
      householdId: invite.householdId,
      userId,
      displayName,
      isOwner: false,
      roleId: invite.roleId,
    });
    await tx
      .insert(userRoles)
      .values({ userId, roleId: invite.roleId, householdId: invite.householdId })
      .onConflictDoNothing();
    await tx
      .update(householdInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(householdInvites.id, invite.id));

    return { userId, householdId: invite.householdId };
  });
}
