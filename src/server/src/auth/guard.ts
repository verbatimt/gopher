// The reusable authorization layer as Elysia macros. Routes opt in declaratively:
//
//   .get('/households/:id/tasks', handler, {
//     requireHousehold: 'id',
//     requirePermissions: ['tasks:read'],
//   })
//
// The guard authorizes at the HTTP boundary; the EP-0008 scoped repo guarantees data
// isolation (defense in depth) — both consume the same householdId.

import { Elysia } from 'elysia';
import { ForbiddenError, TooManyRequestsError, UnauthorizedError } from '../http/errors.ts';
import { authContext } from './context.ts';
import { hasPermission, permissionsForRoles } from './permissions.ts';
import { checkRateLimit } from './rate-limit.ts';
import { clientIp } from './request-ip.ts';
import { assertHouseholdAccess } from './scope.ts';

export const guard = new Elysia({ name: 'guard' }).use(authContext).macro({
  /** Require a valid bearer token. */
  requireAuth(enabled: boolean) {
    return {
      beforeHandle({ claims }) {
        if (enabled && !claims) throw new UnauthorizedError();
      },
    };
  },
  /** Require ALL of the given permissions (wildcard satisfies any). */
  requirePermissions(permissions: string[]) {
    return {
      beforeHandle({ claims }) {
        if (!claims) throw new UnauthorizedError();
        const granted = permissionsForRoles(claims.roles);
        if (!permissions.every((p) => hasPermission(granted, p))) {
          throw new ForbiddenError();
        }
      },
    };
  },
  /** Enforce that the route's :householdId param matches the caller (system bypass). */
  requireHousehold(paramName: string) {
    return {
      beforeHandle({ claims, params }) {
        assertHouseholdAccess(claims ?? null, (params as Record<string, string>)[paramName]);
      },
    };
  },
  /** Per-IP fixed-window rate limit; 429 + Retry-After when exceeded. */
  rateLimit(opts: { limit: number; windowSeconds: number; bucket: string }) {
    return {
      async beforeHandle({ request, server, set }) {
        const id = clientIp(request, server) ?? 'unknown';
        const result = await checkRateLimit(opts.bucket, id, opts.limit, opts.windowSeconds);
        if (!result.allowed) {
          set.headers['retry-after'] = String(result.retryAfter);
          throw new TooManyRequestsError();
        }
      },
    };
  },
});
