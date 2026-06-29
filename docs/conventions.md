# Gopher — Conventions

This document states the cross-cutting rules every EP relies on. It is prescriptive:
parallel work must follow it exactly so the codebase stays coherent. See
[`adr/ADR-0001-architecture-baseline.md`](adr/ADR-0001-architecture-baseline.md) for the
binding architectural assumptions.

## 1. Repository & branching

- Monorepo with three roots: `src/server`, `src/client`, `src/infra`. Shared docs in
  `docs/`. Planning artifacts in `.planning/` (local-only).
- Branch naming: `ep/<NNNN>-<slug>` for EP work (e.g. `ep/0011-authentication`),
  `fix/<slug>` for fixes. The default integration branch is `main`.
- Commits are small and buildable. Reference the EP in the subject when applicable
  (e.g. `EP-0011: rotate refresh tokens on use`).
- **Keep it buildable.** A half-applied EP must never block the next one; CI/the
  verification entrypoint (EP-0004) stays green after every EP.

## 2. EP lifecycle / definition of done

An EP is **done** only when:

1. Every Acceptance Criterion is met.
2. Every Validation Step passes on a clean checkout.
3. The Deliverables exist and match the spec.
4. The change is deployed to the local stack and verified against running services.
5. The build/typecheck/lint/test baseline stays green.
6. No external service/account was introduced (LAN-only, plain-HTTP holds).
7. The checklist item in `.planning/execution-plan.md` is marked `[x]` immediately — not
   batched.

Where a detail is genuinely unspecified, prefer the conventions in EP-0001 (this doc),
EP-0005 (API conventions), and EP-0007 (DB conventions); otherwise make a minimal,
documented decision and record it as an ADR under `docs/adr/`.

## 3. API conventions (server)

- **Versioning:** all routes under `/api/v1/...`. Household-scoped routes are
  `/api/v1/households/:id/<resource>`.
- **Response envelope** (every response, success and error):
  ```json
  { "version": "v1", "statusCode": 200, "success": true, "message": "OK", "result": {} }
  ```
  `success` is `true` on 2xx. Responses are produced only via the shared `success()` /
  error helpers (EP-0005) — routes never hand-roll the envelope.
- **Error taxonomy → HTTP:** `Duplicate → 409`, `NotFound → 404`, `Invalid → 422`,
  `BadRequest → 400`, `Unauthorized → 401`, `Forbidden → 403`, `FailedOperation → 500`.
  User-facing strings live in a shared `messages.ts` catalog; internal details never
  leak into the body.
- **Validation** happens at the route boundary via Elysia schema / TypeBox, mirrored by
  the documented business rules per EP.
- **Module pattern:** one Elysia plugin per domain, mounted under the `/api/v1` app.
  Household-scoped plugins pass through the tenancy guard; permission guards declare
  required permissions (e.g. `tasks:write`).

## 4. Database conventions (Drizzle / Postgres)

- **One file per aggregate** under `src/server/src/db/schema/`, re-exported from
  `index.ts`.
- **UUID v4** primary keys; `timestamptz` columns stored in **UTC**.
- Explicit foreign keys; **check constraints** for enums and numeric ranges.
- Every household-owned table carries `household_id` (tenancy). Standard lifecycle
  columns: `created_at`, `updated_at`, and soft-delete columns `is_active` /
  `deleted_at` (hidden from normal reads).
- Migrations are **forward-only**, generated with drizzle-kit and reviewed before
  applying. No destructive edits to already-applied migrations.

## 5. Client conventions (Flutter / MD3)

- Folder layout: `core/api`, `core/theme`, `core/constants.dart`, `providers/`,
  `services/`, `models/`, `screens/<feature>/`, `widgets/`.
- **Layering:** UI (screens/widgets) → provider (state) → service (per-domain API) →
  `ApiClient` (transport). Feature EPs slot into this without exception.
- Material 3 only (`useMaterial3: true`, `ColorScheme.fromSeed`); screens consume theme
  tokens — **no hardcoded colors**.
- Adaptive navigation: bottom `NavigationBar` at compact width; `NavigationRail`/sidebar
  at expanded width; one source of truth for destinations.
- API base URL via `--dart-define=API_BASE_URL` (default `http://gopher-api.local`);
  never hardcode hosts. All fonts/icons are bundled — no CDN fetches.

## 6. Identity, time & money

- Timestamps are UTC `timestamptz`; convert to the user/household IANA timezone at the
  API/UI boundary.
- Monetary amounts are stored as integer **minor units** (e.g. cents) with an explicit
  currency code, never as floats (finance EPs restate this locally).

## 7. Security posture

- Plain HTTP on the trusted LAN (TLS intentionally omitted). Web client served
  same-origin behind the `gopher.local` proxy, so cookies need no `Secure` flag.
- Secrets come only from environment variables; `.env` is git-ignored and
  `.env.example` carries placeholders only. No secrets in code or in version control.
