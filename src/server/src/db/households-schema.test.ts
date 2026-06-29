// Integration tests for the household/member/invite schema. Runs fully in-process on the embedded DB (pglite + ioredis-mock).

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { Roles } from '../auth/permissions.ts';
import { db } from './index.ts';
import * as schema from './schema/index.ts';
import { seedRoles } from './seeds/roles.ts';

const { households, householdMembers, householdInvites, roles, users } = schema;

const ownerEmail = 'household-schema-owner@x.test';

async function cleanup(): Promise<void> {
  await db.execute(
    sql`DELETE FROM household_invites WHERE household_id IN (SELECT id FROM households WHERE created_by IN (SELECT id FROM users WHERE email = ${ownerEmail}))`,
  );
  await db.execute(
    sql`DELETE FROM household_members WHERE household_id IN (SELECT id FROM households WHERE created_by IN (SELECT id FROM users WHERE email = ${ownerEmail}))`,
  );
  await db.execute(
    sql`DELETE FROM households WHERE created_by IN (SELECT id FROM users WHERE email = ${ownerEmail})`,
  );
  await db.execute(sql`DELETE FROM users WHERE email = ${ownerEmail}`);
}

async function roleId(name: string): Promise<string> {
  const [r] = await db.select().from(roles).where(eq(roles.name, name));
  return r!.id;
}

beforeAll(async () => {
  await seedRoles(db);
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

describe('households schema', () => {
  it('creates a household with the default active_modules, an owner, and a managed child', async () => {
    const [owner] = await db
      .insert(users)
      .values({ email: ownerEmail, passwordHash: 'x', displayName: 'Owner' })
      .returning();

    const [household] = await db
      .insert(households)
      .values({ name: "Owner's Home", createdBy: owner!.id })
      .returning();

    // active_modules default is present.
    expect(household!.activeModules).toEqual([
      'calendar',
      'tasks',
      'medications',
      'rewards',
      'finance',
      'meals',
    ]);

    const supervising = await roleId(Roles.supervisingUser);
    const supervised = await roleId(Roles.supervisedUser);

    // Owner member (linked to a user).
    await db.insert(householdMembers).values({
      householdId: household!.id,
      userId: owner!.id,
      displayName: 'Owner',
      isOwner: true,
      roleId: supervising,
    });

    // Managed/dependent child (no user_id, is_managed).
    const [child] = await db
      .insert(householdMembers)
      .values({
        householdId: household!.id,
        userId: null,
        displayName: 'Kiddo',
        dateOfBirth: '2015-05-01',
        isManaged: true,
        roleId: supervised,
      })
      .returning();
    expect(child!.userId).toBeNull();
    expect(child!.isManaged).toBe(true);

    // Exactly one owner resolvable.
    const owners = await db
      .select()
      .from(householdMembers)
      .where(
        and(eq(householdMembers.householdId, household!.id), eq(householdMembers.isOwner, true)),
      );
    expect(owners.length).toBe(1);
  });

  it('enforces at most one owner per household', async () => {
    const [owner] = await db.select().from(users).where(eq(users.email, ownerEmail));
    const [household] = await db
      .select()
      .from(households)
      .where(eq(households.createdBy, owner!.id));
    const supervising = await roleId(Roles.supervisingUser);

    let threw = false;
    try {
      await db.insert(householdMembers).values({
        householdId: household!.id,
        displayName: 'Second Owner',
        isOwner: true,
        roleId: supervising,
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('prevents a duplicate pending invite for the same household+email, but allows re-invite after revoke', async () => {
    const [owner] = await db.select().from(users).where(eq(users.email, ownerEmail));
    const [household] = await db
      .select()
      .from(households)
      .where(eq(households.createdBy, owner!.id));
    const supervised = await roleId(Roles.supervisedUser);
    const inviteEmail = 'invitee@x.test';
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);

    const [first] = await db
      .insert(householdInvites)
      .values({
        householdId: household!.id,
        email: inviteEmail,
        tokenHash: 'hash-1',
        roleId: supervised,
        expiresAt,
      })
      .returning();

    // Duplicate pending invite → blocked.
    let threw = false;
    try {
      await db.insert(householdInvites).values({
        householdId: household!.id,
        email: inviteEmail,
        tokenHash: 'hash-2',
        roleId: supervised,
        expiresAt,
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // Revoke the first, then a fresh invite is allowed.
    await db
      .update(householdInvites)
      .set({ revokedAt: new Date() })
      .where(eq(householdInvites.id, first!.id));
    const [third] = await db
      .insert(householdInvites)
      .values({
        householdId: household!.id,
        email: inviteEmail,
        tokenHash: 'hash-3',
        roleId: supervised,
        expiresAt,
      })
      .returning();
    expect(third!.id).toBeTruthy();
  });
});
