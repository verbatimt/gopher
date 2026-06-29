// Household-scoping enforcement at the HTTP boundary (defense-in-depth with the EP-0008
// data-layer scoped repos). System roles (held with household_id = NULL) bypass scoping.

import { ForbiddenError, UnauthorizedError } from '../http/errors.ts';
import type { AuthClaims } from './context.ts';
import { SYSTEM_ROLES } from './permissions.ts';

/** True if the claims include a system-level role (cross-tenant). */
export function isSystemActor(roles: string[]): boolean {
  return roles.some((r) => SYSTEM_ROLES.includes(r));
}

/**
 * Ensure the caller may act on [householdId]. System actors always may; otherwise the
 * caller's JWT household claim must match. Throws 401/403 on failure.
 */
export function assertHouseholdAccess(
  claims: AuthClaims | null,
  householdId: string | undefined,
): void {
  if (!claims) throw new UnauthorizedError();
  if (isSystemActor(claims.roles)) return;
  if (!householdId || claims.householdId !== householdId) {
    throw new ForbiddenError('You do not have access to this household.');
  }
}
