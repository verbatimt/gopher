// Canonical role names, the permission catalog (`resource:action`), and the role→permission
// matrix. Permissions are DATA (seeded into role_permissions), so new permissions are seed
// additions, not code changes. EP-0012 guards declare permissions from this catalog.

export const Roles = {
  supervisingUser: 'supervising_user',
  unsupervisedUser: 'unsupervised_user',
  supervisedUser: 'supervised_user',
  systemAdmin: 'system_admin',
  supportOperator: 'support_operator',
} as const;

export type RoleName = (typeof Roles)[keyof typeof Roles];

/** Permission catalog. `*` is a wildcard held only by system_admin (matches any check). */
export const Permissions = {
  wildcard: '*',
  householdRead: 'household:read',
  householdWrite: 'household:write',
  membersRead: 'members:read',
  membersWrite: 'members:write',
  calendarRead: 'calendar:read',
  calendarWrite: 'calendar:write',
  tasksRead: 'tasks:read',
  tasksWrite: 'tasks:write',
  medicationsRead: 'medications:read',
  medicationsWrite: 'medications:write',
  rewardsRead: 'rewards:read',
  rewardsWrite: 'rewards:write',
  rewardsManage: 'rewards:manage',
  mealsRead: 'meals:read',
  mealsWrite: 'meals:write',
  financeRead: 'finance:read',
  financeWrite: 'finance:write',
  dashboardRead: 'dashboard:read',
  auditRead: 'audit:read',
  systemAdmin: 'system:admin',
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

const P = Permissions;

export interface RoleDefinition {
  name: RoleName;
  description: string;
  permissions: string[];
}

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    name: Roles.supervisingUser,
    description: 'Adult/supervisor: full household management and all feature access.',
    permissions: [
      P.householdRead,
      P.householdWrite,
      P.membersRead,
      P.membersWrite,
      P.calendarRead,
      P.calendarWrite,
      P.tasksRead,
      P.tasksWrite,
      P.medicationsRead,
      P.medicationsWrite,
      P.rewardsRead,
      P.rewardsWrite,
      P.rewardsManage,
      P.mealsRead,
      P.mealsWrite,
      P.financeRead,
      P.financeWrite,
      P.dashboardRead,
    ],
  },
  {
    name: Roles.unsupervisedUser,
    description: 'Independent member: self-managed access, no member administration.',
    permissions: [
      P.householdRead,
      P.calendarRead,
      P.calendarWrite,
      P.tasksRead,
      P.tasksWrite,
      P.medicationsRead,
      P.medicationsWrite,
      P.rewardsRead,
      P.mealsRead,
      P.mealsWrite,
      P.financeRead,
      P.financeWrite,
      P.dashboardRead,
    ],
  },
  {
    name: Roles.supervisedUser,
    description: 'Dependent (e.g. child): limited, supervised access. No finance.',
    permissions: [
      P.householdRead,
      P.calendarRead,
      P.tasksRead,
      P.tasksWrite,
      P.medicationsRead,
      P.rewardsRead,
      P.dashboardRead,
    ],
  },
  {
    name: Roles.systemAdmin,
    description: 'Platform administrator (system-level, cross-tenant). Holds the wildcard.',
    permissions: [P.wildcard],
  },
  {
    name: Roles.supportOperator,
    description: 'Support operator (system-level, cross-tenant, read-mostly).',
    permissions: [P.householdRead, P.membersRead, P.auditRead],
  },
];

/** System-level role names (held with household_id = NULL). */
export const SYSTEM_ROLES: readonly string[] = [Roles.systemAdmin, Roles.supportOperator];

/** True if the permission set satisfies the required permission (wildcard matches all). */
export function hasPermission(granted: Iterable<string>, required: string): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  return set.has(Permissions.wildcard) || set.has(required);
}

/** role name → permission strings (mirrors the seeded role_permissions). */
export const ROLE_PERMISSIONS: Record<string, string[]> = Object.fromEntries(
  ROLE_DEFINITIONS.map((d) => [d.name, d.permissions]),
);

/** Resolve the union of permissions granted by a set of role names. */
export function permissionsForRoles(roleNames: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const name of roleNames) {
    for (const permission of ROLE_PERMISSIONS[name] ?? []) set.add(permission);
  }
  return set;
}
