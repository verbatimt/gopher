// Idempotent role + permission seed. Upserts each canonical role by name and each
// (role, permission) grant, ignoring conflicts — re-running produces no duplicates.

import { ROLE_DEFINITIONS } from '../../auth/permissions.ts';
import { type Database, db as defaultDb } from '../index.ts';
import { rolePermissions, roles } from '../schema/index.ts';

export async function seedRoles(database: Database = defaultDb): Promise<void> {
  for (const definition of ROLE_DEFINITIONS) {
    // Upsert the role by unique name; fetch its id.
    const [role] = await database
      .insert(roles)
      .values({ name: definition.name, description: definition.description })
      .onConflictDoUpdate({
        target: roles.name,
        set: { description: definition.description, isActive: true },
      })
      .returning();

    const roleId = role!.id;

    // Insert each grant, ignoring existing ones (idempotent).
    for (const permission of definition.permissions) {
      await database
        .insert(rolePermissions)
        .values({ roleId, permission })
        .onConflictDoNothing({ target: [rolePermissions.roleId, rolePermissions.permission] });
    }
  }
}
