// Auth business logic over the DB + token stores. Registration is a single transaction
// (user → household → owner member → role). Routes layer adds JWT/cookie/audit.

import { and, eq } from 'drizzle-orm';
import { recordValueChanges } from '../../audit/value-change.ts';
import { Roles } from '../../auth/permissions.ts';
import { db, withTransaction } from '../../db/index.ts';
import { householdMembers, households, roles, userRoles, users } from '../../db/schema/index.ts';
import { DuplicateError, UnauthorizedError } from '../../http/errors.ts';
import { seedDefaultTimeWindows } from '../scheduling/setup.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { consumeResetToken, createResetToken } from './reset-store.ts';
import { revokeAllSessions } from './session-store.ts';

export type UserRow = typeof users.$inferSelect;

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  timezone: string;
  currency: string;
  isActive: boolean;
  createdAt: Date;
}

export interface UserContext {
  user: UserRow;
  householdId: string | null;
  roleNames: string[];
}

export function toProfile(user: UserRow): UserProfile {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    timezone: user.timezone,
    currency: user.currency,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  timezone?: string;
}

/** Create user + household + owner member + supervising role atomically. */
export async function registerUser(
  input: RegisterInput,
): Promise<{ user: UserRow; householdId: string }> {
  const email = input.email.toLowerCase();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing.length > 0) {
    throw new DuplicateError('An account with this email already exists.');
  }
  const passwordHash = await hashPassword(input.password);
  const timezone = input.timezone ?? 'UTC';

  return withTransaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email, passwordHash, displayName: input.displayName, timezone })
      .returning();
    const [household] = await tx
      .insert(households)
      .values({ name: `${input.displayName}'s Household`, timezone, createdBy: user!.id })
      .returning();
    const [supervising] = await tx
      .select()
      .from(roles)
      .where(eq(roles.name, Roles.supervisingUser));
    await tx.insert(householdMembers).values({
      householdId: household!.id,
      userId: user!.id,
      displayName: input.displayName,
      isOwner: true,
      roleId: supervising!.id,
    });
    await tx.insert(userRoles).values({
      userId: user!.id,
      roleId: supervising!.id,
      householdId: household!.id,
    });
    await seedDefaultTimeWindows(household!.id, tx);
    return { user: user!, householdId: household!.id };
  });
}

/** Verify credentials; same error for unknown/wrong/inactive to avoid enumeration. */
export async function authenticate(email: string, password: string): Promise<UserRow> {
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  // biome-ignore lint/complexity/useOptionalChain: explicit form narrows `user` to non-null.
  if (!user || !user.isActive) throw new UnauthorizedError('Invalid email or password.');
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new UnauthorizedError('Invalid email or password.');
  return user;
}

export async function getUserById(userId: string): Promise<UserRow | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
}

/** Resolve a user's current household and effective role names (household + system). */
export async function getUserContext(userId: string): Promise<UserContext | null> {
  const user = await getUserById(userId);
  if (!user) return null;

  const [member] = await db
    .select({ householdId: householdMembers.householdId })
    .from(householdMembers)
    .where(and(eq(householdMembers.userId, userId), eq(householdMembers.isActive, true)))
    .limit(1);
  const householdId = member?.householdId ?? null;

  const grants = await db
    .select({ name: roles.name, householdId: userRoles.householdId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));

  const roleNames = [
    ...new Set(
      grants
        .filter((g) => g.householdId === null || g.householdId === householdId)
        .map((g) => g.name),
    ),
  ];
  return { user, householdId, roleNames };
}

export interface ProfilePatch {
  displayName?: string;
  avatarUrl?: string;
  timezone?: string;
  currency?: string;
}

export async function updateProfile(userId: string, patch: ProfilePatch): Promise<UserRow | null> {
  const [user] = await db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  return user ?? null;
}

/** Issue a reset token if the email exists; returns null otherwise (no enumeration). */
export async function requestPasswordReset(email: string): Promise<string | null> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  if (!user) return null;
  return createResetToken(user.id);
}

/** Consume a reset token, set a new password, and invalidate all sessions. */
export async function resetPassword(rawToken: string, newPassword: string): Promise<string> {
  const userId = await consumeResetToken(rawToken);
  if (!userId) throw new UnauthorizedError('Invalid or expired reset token.');
  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
  // Record presence-of-change for the secret field (never the value).
  await recordValueChanges({
    entityType: 'user',
    entityId: userId,
    changedBy: userId,
    before: { passwordHash: 'old' },
    after: { passwordHash: 'new' },
    fields: ['passwordHash'],
    secretFields: ['passwordHash'],
  });
  await revokeAllSessions(userId);
  return userId;
}
