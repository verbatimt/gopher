# Gopher — Authorization (RBAC, Tenancy, Rate Limiting)

The reusable authorization layer (EP-0012). Routes opt in declaratively via macros from the
`guard` plugin (`src/server/src/auth/guard.ts`). The guard authorizes at the HTTP boundary;
the EP-0008 scoped repository guarantees data isolation — defense in depth, both keyed on
the same `householdId`.

## Protecting a route

```ts
import { guard } from '../../auth/guard.ts';

new Elysia().use(guard)
  .get('/households/:id/tasks', handler, {
    requireHousehold: 'id',                 // :id must match the caller's household
    requirePermissions: ['tasks:read'],     // caller must hold this permission
  })
  .post('/auth/login', handler, {
    rateLimit: { limit: 10, windowSeconds: 60, bucket: 'login' },
  });
```

### Macros

| Macro | Effect |
|---|---|
| `requireAuth: true` | 401 if no valid bearer token. |
| `requirePermissions: string[]` | 401 if unauthenticated, 403 unless the caller holds **all** listed permissions (the `*` wildcard satisfies any). |
| `requireHousehold: '<param>'` | 403 unless the route param matches the caller's household claim (system roles bypass). |
| `rateLimit: { limit, windowSeconds, bucket }` | 429 + `Retry-After` once the per-IP window is exceeded. |

Claims (`{ userId, householdId, roles }`) come from the shared `authContext` derive
(decodes the `Authorization: Bearer` JWT). Permissions are resolved from the caller's role
names via the static role→permission matrix (`permissions.ts`), which mirrors the seeded
`role_permissions`.

## Permission catalog

Permissions are `resource:action` strings (see `auth/permissions.ts` and the
[identity model](identity-model.md) matrix). Guards declare the permission they need; the
catalog is the single source — no string literals at call sites.

## Household scoping

`requireHousehold` (and `assertHouseholdAccess`) enforce that a caller only touches their
own household. A member of household A calling `…/households/B/…` is rejected (403) and
never receives B's data. Combine with the EP-0008 scoped repo for the data-layer guarantee.

## System vs household matrix

| Capability | household roles | `support_operator` | `system_admin` |
|---|:--:|:--:|:--:|
| Own-household feature access | per role matrix | — | ✓ (wildcard) |
| Cross-tenant read (admin/support) | ✗ | ✓ (read-mostly) | ✓ |
| Cross-tenant write | ✗ | ✗ | ✓ |
| Household-scope bypass | ✗ | ✓ | ✓ |

System roles are held with `household_id = NULL` (`isSystemActor`); they bypass household
scoping deliberately and their actions are audited (EP-0009 / EP-0038).

## Role-aware visibility (`auth/visibility.ts`)

Feature EPs reuse these helpers to filter data by role:

- `scopedToSelf(roles)` — supervised users see only their own tasks/items.
- `medicationScope(roles)` — `'all'` for supervisors, `'self'` otherwise.
- `assertFinanceAccess(claims)` — throws 403 for supervised users (no `finance:read`).

## Rate limiting

Per-IP fixed-window counters in Redis (`ratelimit:<bucket>:<ip>`). Applied to `/auth/*`
(login 10/min, register 5/min). Exceeding the limit returns **429** with a `Retry-After`
header (seconds). Extendable to other routes in EP-0038.

## Cache invalidation

The permission matrix is static (seed-defined), so no runtime cache invalidation is needed
for MVP. If permissions become dynamically editable, resolve them from `role_permissions`
with a short-TTL Redis cache invalidated on `user_roles`/`role_permissions` mutation.
