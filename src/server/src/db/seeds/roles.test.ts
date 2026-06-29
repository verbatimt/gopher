// Integration tests for the identity schema + role seed. Runs fully in-process on the embedded DB (pglite + ioredis-mock).

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { Permissions, ROLE_DEFINITIONS, Roles } from '../../auth/permissions.ts';
import { db } from '../index.ts';
import * as schema from '../schema/index.ts';
import { seedRoles } from './roles.ts';

const { roles, rolePermissions, userRoles, users } = schema;

const testEmail = 'identity-seed-test@x.test';
const household = '00000000-0000-4000-8000-0000000000aa';

async function cleanup(): Promise<void> {
  await db.execute(
    sql`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email = ${testEmail})`,
  );
  await db.execute(sql`DELETE FROM users WHERE email = ${testEmail}`);
}

beforeAll(async () => {
  await cleanup();
  // Run twice to assert idempotency.
  await seedRoles(db);
  await seedRoles(db);
});

afterAll(async () => {
  await cleanup();
});

describe('role seed', () => {
  it('creates exactly the five canonical roles (idempotent)', async () => {
    for (const def of ROLE_DEFINITIONS) {
      const found = await db.select().from(roles).where(eq(roles.name, def.name));
      expect(found.length).toBe(1); // no duplicates after two runs
    }
  });

  it('grants each role its defined permission set', async () => {
    for (const def of ROLE_DEFINITIONS) {
      const [role] = await db.select().from(roles).where(eq(roles.name, def.name));
      const perms = await db
        .select()
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, role!.id));
      expect(perms.length).toBe(def.permissions.length);
    }
    // Spot-check a few critical grants.
    const [supervisor] = await db.select().from(roles).where(eq(roles.name, Roles.supervisingUser));
    const supervisorPerms = (
      await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, supervisor!.id))
    ).map((p) => p.permission);
    expect(supervisorPerms).toContain(Permissions.tasksWrite);
    expect(supervisorPerms).toContain(Permissions.financeWrite);
    expect(supervisorPerms).toContain(Permissions.membersWrite);
  });

  it('system_admin holds the wildcard permission', async () => {
    const [admin] = await db.select().from(roles).where(eq(roles.name, Roles.systemAdmin));
    const perms = (
      await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, admin!.id))
    ).map((p) => p.permission);
    expect(perms).toEqual([Permissions.wildcard]);
  });
});

describe('user_roles tenancy', () => {
  it('allows a system-level (null household) and a household-scoped grant for one user', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: testEmail, passwordHash: 'x', displayName: 'Seed Test' })
      .returning();
    const [role] = await db.select().from(roles).where(eq(roles.name, Roles.supervisingUser));

    await db.insert(userRoles).values({ userId: user!.id, roleId: role!.id, householdId: null });
    await db
      .insert(userRoles)
      .values({ userId: user!.id, roleId: role!.id, householdId: household });

    const grants = await db.select().from(userRoles).where(eq(userRoles.userId, user!.id));
    expect(grants.length).toBe(2);

    // A duplicate of the household-scoped grant violates the unique constraint.
    let threw = false;
    try {
      await db
        .insert(userRoles)
        .values({ userId: user!.id, roleId: role!.id, householdId: household });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe('role_permissions uniqueness', () => {
  it('rejects a duplicate (role_id, permission)', async () => {
    const [role] = await db.select().from(roles).where(eq(roles.name, Roles.supervisingUser));
    let threw = false;
    try {
      // supervising_user already has tasks:write from the seed.
      await db
        .insert(rolePermissions)
        .values({ roleId: role!.id, permission: Permissions.tasksWrite });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
