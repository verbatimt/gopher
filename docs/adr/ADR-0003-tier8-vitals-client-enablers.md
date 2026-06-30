# ADR-0003 — Tier 8 Vitals Client Enablers (`/auth/me` member id + `health` module)

- **Status:** Accepted
- **Date:** 2026-06-29
- **Context:** EP-0043 (Biometrics API) + EP-0044 (Biometrics client). Records two minimal,
  additive server decisions the client genuinely needs, per "How to Use This Plan" §3.

## Context

EP-0044 renders per-member vitals. Two facts the client needs were not previously available:

1. **The caller's own `household_members` id.** The JWT claims and `/auth/me` expose `userId`,
   `householdId`, and `roles` — but **not** the member id. Non-supervisor roles
   (`unsupervised_user`, `supervised_user`) do **not** hold `members:read`, so they cannot list
   members to discover their own id, yet the EP-0043 endpoints are addressed as
   `/members/:memberId/...` and self-scope to the caller's member. Without the id, a
   non-supervisor cannot read or record **their own** vitals.

2. **A module gate for the new domain.** EP-0044 routes the feature under the *More* hub
   (`/health`) gated by `active_modules`, but no `health` module existed.

## Decision

1. **Add `memberId` to the `/auth/me` response** (`user.memberId`), resolved via the existing
   `resolveMemberId(householdId, userId)`. Null when the user has no household membership. This
   is the single, central place the client reads its own member id; `members:read` is not
   required. The client `User` model gains an optional `memberId`; `AuthProvider.ensureMemberId()`
   lazily fetches `/me` when it is not yet known (e.g. right after login, before the next app
   start re-runs `init()`).

2. **Add a `health` feature module.** Server: `DEFAULT_ACTIVE_MODULES` (and the `households`
   column default) now include `health`, so new households get vitals on by default; it remains
   toggleable via household settings like any other module. Client: `AppModules.health` gates the
   `/health` screens via `ModuleGuard`.

## Consequences

- Existing households created before this change keep their stored `active_modules` and will not
  have `health` until a supervisor enables it (or the household is recreated). New households get
  it by default. This matches the established module-toggle model; no backfill is performed.
- `/auth/me` now performs one extra indexed lookup (`resolveMemberId`). Negligible.
- No new external dependency; LAN-only and clean-slate constraints hold.
