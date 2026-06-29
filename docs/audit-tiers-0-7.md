# Gopher — Independent Audit (Tiers 0–7, EP-0001…EP-0042)

> **Audit date:** 2026-06-28 · **Auditor:** Claude (read-only assessment)
> **Scope:** Full top-to-bottom audit of the Gopher implementation as it exists on disk and on the
> running LAN deployment (`http://gopher.local`), versus `.planning/execution-plan.md` and
> `.planning/execution/EP-0001…EP-0042.md`.
> **Method:** Ran the server + client suites, lint/typecheck/analyze, and `drizzle-kit generate`
> drift check; grepped the codebase for each EP's deliverables; cross-checked the production
> Postgres table list; exercised the live `/health`, `/metrics`, register/login, `/auth/me`, and
> `/dashboard`. No code, schema, or deployment was changed. Discrepancies are flagged, not fixed.

---

## 0. Post-Audit Correction (P0 — added 2026-06-28, after live web testing)

> **The "green" verdict below was incomplete.** This audit verified that the suites pass, the code
> matches the plan, the API answers over curl, and the stack is reachable — but it did **not** drive
> the **web client** against the live **plain-HTTP** deployment. Doing so reveals a **P0: registration
> and login are broken on the web target.**
>
> **Root cause:** the client persists the access token with `flutter_secure_storage` on all platforms
> (`main.dart` → `SecureTokenStore`). On web, that plugin encrypts via the Web Crypto API
> (`crypto.subtle`), which browsers expose **only in a secure context** (HTTPS or `http://localhost`).
> The deployment is plain HTTP on `http://gopher.local` (LAN-only, no TLS — by design), so
> `crypto.subtle` is `undefined` and every token read/write **throws**. Register creates the account
> server-side (201) then throws client-side (→ retry 409); login gets 200 then the throw escapes the
> screen's `await` (`auth_provider.dart:138` is outside `runGuarded`), so the spinner hangs forever.
>
> **Why the audit (and CI) missed it:** widget tests inject `InMemoryTokenStore`, and
> `flutter analyze`/`flutter test` never run in a browser at a non-secure origin. Every gate was green
> while the real web app was unusable. **Lesson:** for auth-touching changes, "tests pass" must be
> paired with a smoke test of the web build against the plain-HTTP deployment.
>
> **Fix applied (client only, not yet deployed):** a per-platform conditional token store
> (`core/storage/token_store_factory.dart`) — native keeps `flutter_secure_storage`; web uses
> `localStorage` via `shared_preferences` (no `crypto.subtle`). Only the 15-min access token is in
> `localStorage`; the refresh token stays in the httpOnly cookie. Recorded in
> `docs/adr/ADR-0002-web-token-storage-on-plain-http.md`. Requires a web rebuild + redeploy to take
> effect on `gopher.local`.

---

## 1. Executive Summary

**Overall: green.** The implementation matches the plan to a high degree. All 39 non-deferred EPs
are implemented, tested, and consistent with their documented deviations; the 3 deferred EPs
(EP-0037, EP-0038, EP-0042) are cleanly absent (not half-built). The checklist in
`execution-plan.md §5` accurately reflects reality — **no batch-marking discrepancies were found**
(no `[x]` that isn't done, no done-but-unmarked item).

**Verification at a glance**

| Gate | Result |
|---|---|
| Server `tsc --noEmit` (typecheck) | **pass** (exit 0) |
| Server `biome check` (lint/format) | **pass** — 151 files, no fixes |
| Server `bun test` (NODE_ENV=test, pglite + ioredis-mock) | **152 pass / 0 fail**, 494 expects, 30 files |
| `drizzle-kit generate` (schema↔migration drift) | **no drift** ("No schema changes, nothing to migrate") |
| Client `flutter analyze` | **pass** — "No issues found" |
| Client `flutter test` | **63 pass**, 16 files |
| Live `GET /health` | `healthy`, `database:true`, `redis:true`, `build:"dev"` |
| Live `GET /metrics` | served; `serverErrors:0`, worker stats present |
| Live register → `/auth/me` → `/dashboard` (plain HTTP) | **201 / 200 / 200**, envelope correct |
| Prod DB §6 mandatory-entity coverage | **100%** (47 public tables) |

**Per-tier traffic light**

| Tier | EPs | Status |
|---|---|---|
| 0 — Foundation & Environment | 0001–0006 | 🟢 Implemented |
| 1 — Data Platform | 0007–0009 | 🟢 Implemented |
| 2 — Identity & Access | 0010–0015 | 🟢 Implemented |
| 3 — Platform Services | 0016–0018 | 🟢 Implemented |
| 4 — Scheduling & Tasks | 0019–0023 | 🟢 Implemented |
| 5 — Health/Rewards/Meals/Dashboard | 0024–0031 | 🟢 Implemented |
| 6 — Finance & Forecasting | 0032–0036 | 🟢 Implemented |
| 7 — Offline, Hardening & Delivery | 0037–0042 | 🟢 as planned: 0039/0040/0041 done; 0037/0038/0042 deferred (clean) |

**Top discrepancies / things to decide (none are correctness defects):**

1. **`everyapp_macvlan` reference in prod compose** — EP-0041's acceptance criterion says the prod
   stack should run "with **no reference to any non-Gopher network**," and its deliverable names
   `gopher_macvlan`. The actual `src/infra/docker-compose.prod.yml` reuses an external network named
   **`everyapp_macvlan`**. This is the EP-0041 §7(c) "reuse a shared macvlan" resolution and **is
   documented** in `docs/deployment-guide.md`, but the chosen name is not the "neutral, non-app-specific"
   name (`lan_macvlan`) the EP recommends. Pragmatic + documented, but technically against that AC. *Decision needed.*
2. **Demo/fixture tables shipped to production** — the four EP-0007 scaffolding tables
   (`demo_widgets`, `demo_items`, `demo_categories`, `demo_links`) from `db/schema/_demo.ts` are still
   in the schema barrel and exist in the **prod DB**. Harmless, but they are test fixtures in a
   production database. *Cleanliness decision.*
3. **`BUILD_SHA` not wired in prod compose** — `/health.build` defaults to `"dev"` on the live
   deployment (confirmed). Documented as an EP-0040 deviation; minor observability gap (can't tell
   which build is running from `/health`).
4. **Root `CLAUDE.md` is empty (0 bytes)** — not an EP deliverable (EP-0001's docs are the READMEs +
   ADR-0001 + `conventions.md`, all present), but worth noting as an empty placeholder.

---

## 2. Per-EP Audit Table

Legend — **Status:** Implemented / Partial / Missing / Deferred. **Mark:** the `[x]/[ ]` in
`execution-plan.md §5`. ✔ = mark matches audited reality.

| EP | Title | Mark | Audited | Evidence (files / tests) | Notes |
|---|---|---|---|---|---|
| 0001 | Project Foundation | [x] | Implemented ✔ | `README.md`, `src/{server,client,infra}/README.md`, `docs/adr/ADR-0001-architecture-baseline.md`, `docs/conventions.md`, `.gitignore` | ADR-0001 covers all 17 §2 assumptions 1:1. |
| 0002 | Development Environment | [x] | Implemented ✔ | `src/server/{package.json,tsconfig.json,.env.example}`, `src/client/{pubspec.yaml,analysis_options.yaml}`, `.tool-versions` (bun 1.3.10, flutter stable), `docs/development.md` | typecheck + analyze pass on the scaffold. |
| 0003 | Local Infra & Containerization | [x] | Implemented ✔ | `src/infra/docker-compose.yml` + `.override.yml`, `src/server/Dockerfile` + `.dockerignore`, `docs/infra-local.md` | postgres:18 + redis:7-alpine + api, internal net, healthchecks. |
| 0004 | CI/CD Pipeline (local-first) | [x] | Implemented ✔ | `Makefile` (verify/check/test/build/migrate/up/down), `scripts/install-hooks.sh`, `docs/ci.md` | No cloud CI; plain-command entrypoint per §2.17. |
| 0005 | API Application Skeleton | [x] | Implemented ✔ | `src/server/src/{app.ts,config.ts}`, `http/{envelope,errors,messages}.ts`, `plugins/health.ts`, tests `app.test.ts`, `http/envelope.test.ts`, `http/errors.test.ts`, `plugins/health.test.ts` | Envelope + error taxonomy + `/health` + OpenAPI (`openapi()` mounted) all present. OpenAPI is reachable on the API host, not via the gopher.local web proxy (proxy forwards only `/api`,`/ws`,`/health`,`/metrics`) — by design. |
| 0006 | Flutter Client + MD3 Foundation | [x] | Implemented ✔ | `lib/core/{api,theme,storage,constants}`, `lib/screens/shell/app_shell.dart`, `providers/base_provider.dart`, `screens/router.dart`, tests `app_shell_test.dart`, `theme_test.dart`, `widgets_test.dart`, `api_client_test.dart` | Adaptive nav (bottom-bar vs rail) verified by `app_shell_test`. |
| 0007 | DB Foundations & Migrations | [x] | Implemented ✔ | `db/index.ts`, `db/_shared.ts`, `db/repo.ts`, `drizzle.config.ts`, 15 migrations (`0000`–`0014`) + meta journal, `db/seed.ts`, test `db/repo.test.ts`, `docs/db-conventions.md` | UUID PK + tz timestamps + soft-delete helpers. Demo fixture tables (`_demo.ts`) — see Finding #2. |
| 0008 | Multi-Tenancy & Soft-Deletion | [x] | Implemented ✔ | `db/tenancy.ts`, `db/deletion.ts`, test `db/tenancy.test.ts`, `docs/tenancy-and-deletion.md` | Scoped `forHousehold()` factory; cross-tenant reads blocked (tested). |
| 0009 | Auditing & Value-Change Tracking | [x] | Implemented ✔ | `db/schema/{audit-logs,value-change-history}.ts`, `audit/{log,value-change,actions}.ts`, test `audit/audit.test.ts` | Two-tier audit; action-constant catalog. |
| 0010 | Identity & Roles Schema | [x] | Implemented ✔ | `db/schema/{users,roles,role-permissions,user-roles,user-sessions}.ts`, `auth/permissions.ts` (catalog + matrix), `db/seeds/roles.ts`, test `db/seeds/roles.test.ts`, `docs/identity-model.md` | 5 roles seeded idempotently; `user_sessions.push_endpoint` provisioned for EP-0042 (column only). |
| 0011 | Authentication & Session Mgmt | [x] | Implemented ✔ | `modules/auth/{routes,service,tokens,password,session-store,reset-store}.ts`, test `modules/auth/auth.test.ts` | Live register→me verified; JWT carries `sub/householdId/roles`; refresh rotation; reset flow. |
| 0012 | Authorization, RBAC & Tenancy | [x] | Implemented ✔ | `auth/{guard,scope,rate-limit,visibility,context}.ts`, test `auth/guard.test.ts` | `guard` macro w/ `requirePermissions`; rate-limit by `request-ip.ts`. |
| 0013 | Households/Members/Invites Schema | [x] | Implemented ✔ | `db/schema/{households,household-invites}.ts` (+ household_members), test `db/households-schema.test.ts`, `docs/household-model.md` | `active_modules` default array; managed-profile `user_id` nullable. |
| 0014 | Household & Member Mgmt API | [x] | Implemented ✔ | `modules/households/{routes,service}.ts`, `modules/invites/service.ts`, test `modules/households/households-api.test.ts` | Last-supervisor guard, owner-undeletable, invite lifecycle. |
| 0015 | Client: Auth & Onboarding | [x] | Implemented ✔ | `screens/auth/{login,register,accept_invite}_screen.dart`, `screens/onboarding/`, `providers/{auth,household}_provider.dart`, `services/{auth,household}_service.dart`, test `auth_flow_test.dart` | Three-state routing guard in `screens/router.dart`. |
| 0016 | Real-Time WebSocket Infra | [x] | Implemented ✔ | `realtime/{ws,bus,events}.ts`, test `realtime/ws.test.ts`; client `providers/ws_provider.dart`, `services/ws_service.dart`, test `ws_test.dart` | Handshake-first; Redis pub/sub fan-out; live `/metrics` shows `wsConnections`. |
| 0017 | Notifications Subsystem | [x] | Implemented ✔ | `db/schema/notifications.ts`, `modules/notifications/{routes,notify,types}.ts`, test `notifications.test.ts`; client `notification_provider.dart`, `screens/notifications/`, `widgets/notification_bell.dart`, test `notification_test.dart` | `notify()` single creation point. |
| 0018 | Recurrence & RRULE Engine | [x] | Implemented ✔ | `recurrence/rrule.ts`, test `recurrence/rrule.test.ts`, `docs/recurrence.md` | Shared by scheduling/tasks/medications/finance. |
| 0019 | Scheduling Items & Occurrence Model | [x] | Implemented ✔ | `db/schema/{scheduled-items,scheduling-tags,time-windows,occurrence-overrides}.ts`, `modules/scheduling/{setup,constants}.ts`, test `scheduling-schema.test.ts`, `docs/scheduling-model.md` | 4 types; tag replace-set; default time windows seeded. |
| 0020 | Calendar & Events API | [x] | Implemented ✔ | `modules/calendar/{routes,service}.ts`, test `calendar.test.ts` | 3 delete scopes; range expansion; visibility filter. Live `/calendar` returns 200. |
| 0021 | Tasks, Chores & Workflow Steps | [x] | Implemented ✔ | `db/schema/tasks.ts` (recurring_tasks/tasks/task_workflow_steps), `modules/tasks/{routes,service}.ts`, test `tasks.test.ts` | Step auto-complete, reorder, rotation fields, approval flow. |
| 0022 | Recurring Task Generation Worker | [x] | Implemented ✔ | `workers/recurring-task-generator.ts`, test `workers/recurring-task-generator.test.ts` | Half-open boundary + idempotency; rotation advance. |
| 0023 | Client: Calendar, Tasks & Routines | [x] | Implemented ✔ | `screens/calendar/`, `screens/tasks/{task_list,task_detail,task_form}_screen.dart`, `providers/{calendar,task}_provider.dart`, test `calendar_tasks_test.dart` | Scheduling-intent validation tested ("blocks exact schedule without a time"). |
| 0024 | Medications API | [x] | Implemented ✔ | `db/schema/medications.ts`, `modules/medications/{routes,service,validators}.ts`, test `medications.test.ts` | Dose-window validation; value-change on dosage; refill increments stock. |
| 0025 | Med Reminders/Compliance/Refill | [x] | Implemented ✔ | `workers/medication-reminders.ts`, test `workers/medication-reminders.test.ts` | Dedupe key `(schedule_id, scheduled_at)`; refill-needed hook wired into EP-0024 log path. Live `/metrics` shows `medication-reminders` worker runs. |
| 0026 | Client: Medication Tracker | [x] | Implemented ✔ | `screens/medications/{medication_list,medication_detail,medication_form}_screen.dart`, `providers/medication_provider.dart`, test `medications_test.dart` | Role gating; refill view. |
| 0027 | Rewards API | [x] | Implemented ✔ | `db/schema/{rewards,reward-rules}.ts`, `modules/rewards/{routes,service,validators}.ts`, test `rewards.test.ts` | `balance_after` on every mutation; cap/cooldown; soft-deactivate preserves id. |
| 0028 | Task-Completion Reward Hook & Allowances | [x] | Implemented ✔ | earn hook in tasks/rewards path, `workers/allowance-granter.ts`, `reward_allowances` table, test `rewards-earn.test.ts` (`describe('allowances')`) | Per-task earn idempotency; allowance cadence tested. |
| 0029 | Client: Rewards & Redemption | [x] | Implemented ✔ | `screens/rewards/rewards_screen.dart`, `providers/reward_provider.dart`, `services/reward_service.dart`, test `rewards_test.dart` | Affordability gating; supervisor approve/reject. |
| 0030 | Meal Planning & Grocery Lists | [x] | Implemented ✔ | `db/schema/{meal-plans,groceries}.ts`, `modules/meals/{routes,service,validators}.ts`, test `meals.test.ts`; client `screens/meals/{meal_planner,grocery}_screen.dart`, test `meals_test.dart` | Unique week; copy-with-409; replace-per-slot. |
| 0031 | Dashboard | [x] | Implemented ✔ | `modules/dashboard/{routes,service}.ts`, test `dashboard.test.ts`; client `screens/dashboard/dashboard_screen.dart`, test `dashboard_test.dart` | Live `/dashboard` returns 7 conditional sections; role/module gating. |
| 0032 | Finance & Forecasting Schema | [x] | Implemented ✔ | `db/schema/finance/{accounts,transactions,forecasts,forecast-accounts,forecast-transactions,forecast-ledger-entries,forecast-account-balances,enums}.ts`, test `db/finance-schema.test.ts`, `docs/finance-domain.md` | 7 tables + 5 enums; `numeric(14,2)`; reserved-word renames; account→tx cascade. |
| 0033 | Finance Forecast Engine | [x] | Implemented ✔ | `modules/finance/{engine,service,routes,validators,errors}.ts`, test `finance.test.ts` | Deterministic forecast test; liability overpay guard; 2-dp rounding. Live forecast gen ~86ms p50 (perf doc). |
| 0034 | Finance Forecast Analytics | [x] | Implemented ✔ | `modules/finance/analytics.ts`, test `analytics.test.ts`, `docs/finance-analytics.md` | Category groups; cash/credit/net-worth; series. |
| 0035 | Client: Finance & Forecasting UX | [x] | Implemented ✔ | `screens/finance/{accounts,transactions,forecasts,forecast_detail}_screen.dart`, `widgets/net_worth_chart.dart`, `providers/finance_provider.dart`, test `finance_test.dart`, `docs/finance-ux.md` | 5 detail tabs + net-worth chart. |
| 0036 | Household Finance Extensions | [x] | Implemented ✔ | `db/schema/finance-ext/{budgets,budget-categories,expenses,expense-shares,money-allowances}.ts`, `modules/finance-extensions/{routes,service,validators}.ts`, `workers/money-allowance-granter.ts`, test `finance-ext.test.ts`; client `screens/finances/{budgets,expenses}_screen.dart`, `budgets_screen` test `budget_test.dart` | `numeric(12,2)`; SupervisedUser 403 on every endpoint (tested at `finance-ext.test.ts:118`). |
| 0037 | Offline-First Sync | [ ] | **Deferred (clean)** ✔ | *absent:* no `lib/core/offline/`, no `sync_engine`/`action_queue`/`offline_store` | See §3. |
| 0038 | Security Hardening | [ ] | **Deferred (clean)** ✔ | *absent:* no `docs/security-review.md`, no `audit-logs` read endpoints | See §3. `audit:read`/`system:admin` permissions exist in the catalog (harmless scaffolding ahead of the endpoints). |
| 0039 | Accessibility & Responsiveness | [x] | Implemented ✔ | `docs/accessibility-and-responsive.md`, tests `accessibility_test.dart`, `app_shell_test.dart` | Golden tests intentionally omitted; per-screen checklist + manual gaps recorded. |
| 0040 | Observability & Performance Baseline | [x] | Implemented ✔ | `observability/{logger,metrics}.ts`, `plugins/metrics.ts`, test `observability/metrics.test.ts`, `src/infra/loadtest/loadtest.ts`, `docs/observability.md`, `docs/performance-baseline.md` | Self-contained bun load test (no autocannon/k6); `THINK_MS`. `build` defaults `dev` (Finding #3). |
| 0041 | Deployment & Network Topology | [x] | Implemented ✔ (pulled forward) | `src/infra/docker-compose.prod.yml`, `src/infra/docker/{nginx.conf,web.Dockerfile}`, `src/infra/scripts/deploy.sh`, `docs/deployment-guide.md`; live stack at `gopher.local` | Same-origin nginx proxy verified; **`everyapp_macvlan`** reuse (Finding #1). |
| 0042 | Push Notifications | [ ] | **Deferred (clean)** ✔ | *absent:* no `modules/push/`, no `/auth/push-endpoint` route | `user_sessions.push_endpoint` column only (EP-0010 provision). See §3. |

---

## 3. Deferred-Items Confirmation (EP-0037 / EP-0038 / EP-0042)

All three are **cleanly absent — not half-built.**

- **EP-0037 Offline-First Sync** — no `src/client/lib/core/offline/` directory; grep for `offline`
  across `src/client/lib` returns nothing. No `action_queue`, `sync_engine`, `connectivity_monitor`,
  or `offline_store`. The client is purely online (REST + WS). ✔ Clean.
- **EP-0038 Security Hardening** — no `docs/security-review.md`; no audit-read endpoints
  (`GET …/households/:id/audit-logs`, `GET /admin/audit-logs`). The only `audit_logs` references in
  modules are test-teardown `DELETE`s. The `audit:read` and `system:admin` permission *strings* exist
  in `auth/permissions.ts` (held by `support_operator`/`system_admin`) but no route consumes them —
  this is permission scaffolding ahead of the deferred endpoints, not a partial implementation. ✔ Clean.
  *Note:* the underlying mechanisms this EP would "harden" (per-route guards, scoped repos,
  parameterized Drizzle, input validation, auth rate-limiting, value-change capture) are already
  present from their owning EPs; what's deferred is the dedicated coverage-matrix pass + the two
  audit-read endpoints + `docs/security-review.md`.
- **EP-0042 Push Notifications** — no `src/server/src/modules/push/`, no
  `POST /api/v1/auth/push-endpoint`, no UnifiedPush/ntfy client. The only artifact is the
  `user_sessions.push_endpoint` text column, explicitly provisioned by EP-0010's schema (commented
  "optional self-hosted UnifiedPush endpoint for EP-0042"). ✔ Clean.

---

## 4. Deviation Log

Each documented deviation from the audit brief, with verification verdict. **All listed deviations
are intentional, documented, and match the code**, except the macvlan naming nuance (D11).

| # | Deviation | Intentional? | Documented where | Matches code? |
|---|---|---|---|---|
| D1 | Finance is **clean-slate**; ADR-0001 supersedes context.md §5 "verbatim SPENDEM"; EP-0032–0036 are Gopher's own design | Yes | `ADR-0001` decision 12; `docs/finance-domain.md` intro; `execution-plan.md §2.12` | ✔ Yes — finance code is original; no SPENDEM port. |
| D2 | Money types: engine `numeric(14,2)`, extensions `numeric(12,2)`, intentionally separate | Yes | `docs/finance-domain.md` "Money type" | ✔ Yes — verified in `db/schema/finance/*` (14,2) and `db/schema/finance-ext/*` (12,2). |
| D3 | Reserved-word renames: transaction `interval`→`interval_unit`, forecast `start`/`end`→`start_date`/`end_date` | Yes | `docs/finance-domain.md` "Naming notes" | ✔ Yes — `transactions.ts:41`, `forecasts.ts:14-15`. |
| D4 | `forecast_ledger_entries.sequence` (deterministic analytics ordering); `forecast_account_balances.total` (per-day net worth) | Yes | column comments in schema | ✔ Yes — `forecast-ledger-entries.ts:17` (`sequence integer`), `forecast-account-balances.ts:19` (`total numeric(14,2)`). |
| D5 | Rewards permissions: member self-service (redeem/own-balance) via `rewards:read`; supervisor actions via `rewards:manage` | Yes | `modules/rewards/routes.ts` header comment | ✔ Yes — catalog in `auth/permissions.ts`; `supervised_user` has `rewards:read` (not manage/write). |
| D6 | Medications: dose-log stock decrement + refill-needed hook in EP-0025 wired into EP-0024 log path; unique `(schedule_id, scheduled_at)` dedupe/upsert key | Yes | `medications.ts` comments; EP-0025 | ✔ Yes — `medications.ts:61` unique constraint; reminder worker present. |
| D7 | Added endpoints: reward allowance CRUD (0028), `/rewards/me` + `/rewards/me/transactions` (0029), money-allowance CRUD (0036) | Yes | route comments | ✔ Yes — `rewards/routes.ts:136,149,195,208,213`; finance-ext money-allowance routes. All guarded + self-scoped. |
| D8 | EP-0036 money allowances recorded as expense rows; SupervisedUser denied all finance endpoints via the **finance permission** (403), not a separate role check | Yes | `modules/finance-extensions/routes.ts` header | ✔ Yes — `guard` + `requirePermissions:[financeRead/financeWrite]`; `supervised_user` holds neither; 403 asserted at `finance-ext.test.ts:118`. |
| D9 | EP-0040: `/metrics` endpoint + nginx same-origin proxy; self-contained bun load test (not autocannon/k6) with `THINK_MS`; `/health.build` defaults `"dev"` (BUILD_SHA not wired); first-run dashboard "errors" were a load-generator socket-exhaustion artifact | Yes | `docs/performance-baseline.md` ("Think time matters" + recorded run), `docs/observability.md` | ✔ Yes — `loadtest.ts` uses built-in `fetch` + `THINK_MS`; live `/health` shows `build:"dev"`; doc explains the artifact (dashboard 1243× 200, 0 err). |
| D10 | EP-0039: golden tests omitted (brittle) in favor of breakpoint + semantics widget tests; screen-reader/Windows-DPI checks documented as manual | Yes | `docs/accessibility-and-responsive.md` ("Known gaps") | ✔ Yes — `accessibility_test.dart` + `app_shell_test.dart`; no golden tests present. |
| D11 | EP-0041: prod compose reuses an **external shared macvlan** rather than creating `gopher_macvlan` | Yes (constraint-driven) | `docs/deployment-guide.md` "shared macvlan" §; EP-0041 §7(c) | ⚠ **Partly** — the *approach* (reuse shared macvlan) is the documented §7(c) resolution and is recorded, but the network is named **`everyapp_macvlan`** (another app's brand), not the EP's recommended neutral `lan_macvlan`. The EP-0041 AC "no reference to any non-Gopher network" is therefore not strictly met. See Finding #1 / §7. |
| D12 | Test infra: server tests run on embedded pglite (no standalone Postgres); each test file uses a distinct `x-forwarded-for` to avoid sharing the auth rate-limit bucket | Yes | test files + `bunfig.toml`/`test-setup.ts` | ✔ Yes — 152 tests pass fully in-process; ioredis-mock used. |

**Newly found deviations (not in the brief):** D-N1 — the EP-0007 demo fixture tables are present in
the prod DB (Finding #2). D-N2 — root `CLAUDE.md` is empty (Finding #4). Neither is a correctness
issue; both are recorded for decision.

---

## 5. Guardrails, Mandatory-Entity (§6) & Migration Integrity

### 5.1 Guardrails (non-negotiable) — all upheld

- **Clean-slate (nothing copied verbatim):** ADR-0001 decision 12 + `finance-domain.md` assert it;
  the finance code is an original double-entry-style ledger projection specified inline in EP-0032/0033.
  No `.reference/` material is consulted by the build. ✔
- **Self-hosted + LAN-only, plain HTTP:** prod compose runs API/Postgres/Redis/nginx on the LAN
  macvlan + an `internal: true` bridge; nginx serves the web build and proxies `/api`,`/ws`,`/health`,
  `/metrics` same-origin; **no TLS**. Live login works over plain `http://gopher.local`. ✔
- **No external runtime dependencies/accounts:** grep of `src/client/lib` for CDN/Google-Fonts/external
  hosts → **none**; grep of `src/server/src` for outbound `fetch`/`axios`/`http(s)://` (non-test) →
  **none**. `package.json` deps are all local-capable (elysia, drizzle-orm, ioredis, postgres, rrule);
  `pubspec.yaml` deps are all local (provider, go_router, http, shared_preferences, intl,
  table_calendar, flutter_secure_storage, web_socket_channel). No new external pkg/runtime dep crept in. ✔
- **Web served same-origin:** confirmed in `src/infra/docker/nginx.conf` (`try_files … /index.html` for
  the SPA; `location /api/`, `/ws`, `/health`, `/metrics` → `proxy_pass http://gopher-api:3000`). ✔

### 5.2 Mandatory data-model coverage (master plan §6) — 100%

Cross-checked against the **production** `pg_tables` list (47 public tables). Every required entity
resolves to an existing table:

| Required entity | Table(s) | Present in prod? |
|---|---|---|
| Users / Roles / Permissions | `users`, `roles`, `role_permissions` (+ `user_roles`) | ✔ |
| Households / Members | `households`, `household_members` (+ `household_invites`) | ✔ |
| Scheduled Items / Events / Appointments | `scheduled_items`, `events` (appointment = `type='appointment'`) | ✔ |
| Recurring Tasks / Tasks | `recurring_tasks`, `tasks`, `task_workflow_steps` | ✔ |
| Rewards / Catalog Items | `rewards`, `reward_rules`, `reward_transactions`, `reward_store_items` | ✔ |
| Medications / Med Logs | `medication_schedules`, `medication_refills`, `medication_doses` | ✔ |
| Financial Records | `finance_accounts`, `finance_transactions`, `finance_forecasts`, `finance_forecast_*`, `budgets`, `budget_categories`, `expenses` (+ `expense_shares`, `money_allowances`) | ✔ |
| Audit Records | `audit_logs`, `value_change_history` | ✔ |
| Notifications | `notifications` | ✔ |

Additional implemented tables beyond the minimum (all owned by an EP): `user_sessions`,
`scheduling_tags`, `scheduled_item_tags`, `time_windows`, `occurrence_overrides`, `reward_allowances`,
`grocery_lists`, `grocery_items`, `meal_plans`, `meal_plan_entries`. Plus the four `demo_*` fixture
tables (Finding #2).

### 5.3 Migration integrity — forward-only, in sync

- 15 migrations `0000_*`…`0014_*` with a meta journal under `db/migrations/meta/`; numbering is
  contiguous and forward-only.
- **`drizzle-kit generate` reports no drift** ("No schema changes, nothing to migrate") — the Drizzle
  schema and the committed migrations are in sync.
- The live deployment's `/health` reports `database:true` (migrations applied; DB reachable), and the
  prod table list matches the schema barrel (`db/schema/index.ts`).

---

## 6. Build / Test / Deploy Verification (raw results)

**Server** (`cd src/server`):
- `bun run typecheck` → `tsc --noEmit` exit **0**.
- `bun run check` → `biome check .` → **151 files, no fixes** (exit 0).
- `NODE_ENV=test bun test` → **152 pass / 0 fail**, 494 `expect()` calls, 30 files, ~22.8s.
- `bun run db:generate` → **"No schema changes, nothing to migrate"** (no drift).

**Client** (`cd src/client`, Flutter on PATH):
- `flutter analyze` → **"No issues found!"** (note: 6 transitive packages have newer-but-incompatible
  versions — pinned, not an error).
- `flutter test` → **All tests passed** — 63 tests, 16 files.

**Live deployment** (`http://gopher.local`, ARM64 Pi; not redeployed):
- `GET /health` → `{"status":"healthy","services":{"database":true,"redis":true},"name":"gopher-api","version":"v1","build":"dev","uptime":1930}`
- `GET /metrics` → `{"uptimeSeconds":1929,"requests":51280,"serverErrors":0,"clientErrors":0,"errorRate":0,"wsConnections":0,…,"workers":{"medication-reminders":{"runs":2,…}}}`
- `POST /api/v1/auth/register` (throwaway) → **201**, envelope `{version,statusCode,success,message,result}`, JWT contains `sub/householdId/roles=supervising_user`.
- `GET /api/v1/auth/me` (Bearer) → **200**, profile only (no password hash).
- `GET /api/v1/dashboard` (Bearer) → **200**, 7 conditional sections (`notifications/calendar/tasks/medications/rewards/meals/finance`).
- `gopher-db.local:5432` reachable on the LAN; read-only `pg_tables` query → 47 public tables (credentials were **not** printed).
- `gopher-api.local` is **not** resolvable from the dev host (native-client path); the web front
  `gopher.local` and the proxied API are reachable — consistent with the same-origin topology.

---

## 7. Prioritized Gaps & Risks (for your decision — no code was changed)

**P1 — decide before calling EP-0041 "done to spec"**
1. **Macvlan name `everyapp_macvlan` vs EP-0041 AC.** The prod stack references a non-Gopher-named
   external network, which the EP-0041 acceptance criterion ("no reference to any non-Gopher network")
   forbids and its deliverable (`gopher_macvlan`) doesn't anticipate. It *is* the documented §7(c)
   fallback, but the name isn't the recommended neutral `lan_macvlan`. **Options:** (a) accept and
   amend the EP-0041 AC to bless the documented §7(c) reuse; (b) rename the shared host network to a
   neutral `lan_macvlan` and point all apps at it. Low technical risk; it's a wording/cleanliness
   conformance call.

**P2 — low-risk cleanliness**
2. **Demo fixture tables in production.** `_demo.ts` (demo_widgets/items/categories/links) is still in
   the schema barrel and exists in the prod DB. Consider removing `_demo.ts` from `db/schema/index.ts`
   (and adding a drop migration) so production carries no test fixtures — or consciously keep them as a
   harmless smoke fixture. (They are still used by `db/repo.test.ts`/`db/tenancy.test.ts`, so a
   removal must keep the test fixtures available to the test harness another way.)
3. **`BUILD_SHA` not wired in prod compose.** `/health.build` is `"dev"` on the live stack. Wiring the
   build SHA into `docker-compose.prod.yml`/`deploy.sh` would make `/health` identify the running build
   (useful for the EP-0040 observability goal). Documented as a known deviation; trivially closable.

**P3 — note only**
4. **Empty root `CLAUDE.md`.** 0 bytes. Not an EP deliverable (EP-0001's docs are all present), but an
   empty committed placeholder; populate or remove at will.
5. **`audit:read`/`system:admin` permissions exist without endpoints.** Harmless scaffolding ahead of
   the deferred EP-0038 audit-read endpoints; no action needed unless you want the catalog to track
   only live permissions.

**Deferred work remaining (expected, not gaps):** EP-0037 (offline sync), EP-0038 (security-hardening
coverage pass + audit-read endpoints + `security-review.md`), EP-0042 (self-hosted push). These are the
only remaining `[ ]` items and are correctly unmarked.

---

## 8. Bottom Line

The Gopher implementation faithfully realizes the plan. **39/39 non-deferred EPs are implemented and
test-backed; 3/3 deferred EPs are cleanly absent; the checklist is accurate; the live LAN deployment is
healthy and serves real flows over plain HTTP; the schema is in sync with migrations and covers every
mandatory §6 entity; and every guardrail (clean-slate, LAN-only, no external runtime deps, same-origin
web) holds.** The only items warranting a decision are conformance/cleanliness nits — chiefly the
`everyapp_macvlan` naming against EP-0041's AC, and demo fixtures in the production database — none of
which affect correctness or security of the running system.
