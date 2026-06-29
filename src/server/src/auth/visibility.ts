// Role-aware visibility helpers feature EPs reuse to filter data by role. Gopher rules:
// supervised users see only their own tasks; finance rejects supervised users; medication
// visibility narrows to own-schedule for non-supervisors.

import { ForbiddenError } from '../http/errors.ts';
import type { AuthClaims } from './context.ts';
import { hasPermission, Permissions, permissionsForRoles, Roles } from './permissions.ts';
import { isSystemActor } from './scope.ts';

/** Highest-privilege household role the claims hold (system > supervising > unsupervised > supervised). */
export function effectiveRole(
  roles: string[],
): 'system' | 'supervising' | 'unsupervised' | 'supervised' | 'none' {
  if (isSystemActor(roles)) return 'system';
  if (roles.includes(Roles.supervisingUser)) return 'supervising';
  if (roles.includes(Roles.unsupervisedUser)) return 'unsupervised';
  if (roles.includes(Roles.supervisedUser)) return 'supervised';
  return 'none';
}

/** Supervised users only see their own tasks/items; everyone else sees the household. */
export function scopedToSelf(roles: string[]): boolean {
  return effectiveRole(roles) === 'supervised';
}

/** Medication visibility: supervisors see all; others see only their own schedules. */
export function medicationScope(roles: string[]): 'all' | 'self' {
  const role = effectiveRole(roles);
  return role === 'supervising' || role === 'system' ? 'all' : 'self';
}

/** Finance is closed to supervised users; throws 403 if the caller lacks finance:read. */
export function assertFinanceAccess(claims: AuthClaims | null): void {
  if (!claims || !hasPermission(permissionsForRoles(claims.roles), Permissions.financeRead)) {
    throw new ForbiddenError('Finance is not available for this role.');
  }
}
