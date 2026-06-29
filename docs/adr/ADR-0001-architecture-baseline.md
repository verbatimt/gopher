# ADR-0001 — Architecture Baseline

- **Status:** Accepted
- **Date:** 2026-06-28
- **Supersedes:** —

## Context

Gopher is a clean-slate, multi-tenant household operating system. Before any feature
work begins, the cross-cutting architectural assumptions must be fixed so that
independently executed EPs do not drift. These assumptions are taken from the master
execution plan (`.planning/execution-plan.md §2`) and restated here as the binding
record. Each numbered decision below maps 1:1 to an assumption in that section.

## Decision

The following are adopted as project-wide invariants:

1. **Monorepo, three roots.** Code lives under `src/{server,client,infra}`. `.planning/`
   holds the plan and `context.md` (local-only).
2. **Backend = Bun + Elysia + Drizzle ORM + PostgreSQL + Redis.** Elysia provides REST +
   WebSockets; Drizzle provides schema + migrations; Redis provides cache,
   session/refresh-token store, real-time pub/sub, and background-queue support.
3. **Client = Flutter (latest stable) + Material Design 3**, targeting Windows, Android,
   Web. Layered architecture (UI → provider → service → ApiClient), adaptive layouts,
   secure token storage, WebSocket client.
4. **UUID v4 primary keys; all timestamps `timestamptz` in UTC**, converted to the
   user/household IANA timezone at the API/UI boundary.
5. **Multi-tenancy by `household_id`.** Every household-owned row carries `household_id`;
   all queries are household-scoped and enforced by middleware. A role grant with
   `household_id = NULL` denotes a **system-level** role (platform admin/support).
6. **Soft deletion is the default** (hidden-not-erased via `is_active`/`deleted_at`).
   Hard deletion is reserved for junction/link rows with no standalone meaning.
   Documented exceptions: in finance/forecasting, deactivating an account cascades a
   soft-deactivation to its transactions; the household finance-extensions module
   defines its own expense-deletion rule (EP-0036).
7. **Roles** are implemented abstractly as **`SupervisingUser`, `UnsupervisedUser`,
   `SupervisedUser`** plus **`Owner`** (a SupervisingUser who created the household and
   cannot be removed), **`Guest`** (constrained/temporary), and system-level
   **`system_admin`** / **`support_operator`**.
8. **Identity model.** Baseline: `users` (login) ↔ `household_members` (membership;
   `user_id` nullable for managed/dependent profiles with no login). The optional
   `individuals` normalization (one person across multiple households) is documented but
   **not** required for MVP.
9. **Task Replacement Model.** A polymorphic `scheduled_items` base
   (`type ∈ {appointment, event, recurring_task, task}`) with 1:1 detail tables
   `recurring_tasks`, `tasks`, `task_workflow_steps`. Runs in parallel to any legacy task
   model initially.
10. **Recurrence = iCalendar RRULE.** A single shared engine (EP-0018) expands RRULEs and
    is used by scheduling, recurring-task generation, medications, and the finance
    forecast engine.
11. **Occurrence generation.** Recurring tasks **generate future instances in the
    background** with generation boundaries to prevent duplicate spawning, using
    `last_generated_at` + `generate_ahead_days` (EP-0022). A purely on-the-fly model is
    recorded as a documented alternative for read-heavy calendar queries.
12. **Finance/forecasting — clean-slate.** `context.md §5` originally mandated porting
    the prior SPENDEM project *verbatim* and called it "CRITICAL." **The clean-slate
    direction supersedes the "verbatim" instruction:** Gopher implements its own
    finance/forecasting design (accounts, transactions, recurrence-driven forecasts,
    ledger projection, analytics) using SPENDEM only as loose conceptual guidance, and
    copies nothing. The capability and UX SPENDEM represented are preserved as goals; the
    implementation is fresh (EP-0032–EP-0035).
13. **Offline-first.** Online mode = immediate persistence + WebSocket/Redis cross-device
    updates. Offline mode = local proxy DB (SQLite native / IndexedDB web), an action
    queue, deferred sync with retries + exponential backoff, server-authoritative
    conflict resolution, clean timeouts, and a manual-review prompt on unresolved failure.
14. **Auditing is two-tier:** an append-only `audit_logs` action log (actor, action,
    entity, IP, user-agent, metadata) **and** `value_change_history` capturing from/to
    values for sensitive/critical fields.
15. **Deployment target is `server.local`** via Docker Compose, with the fixed network
    layout (`gopher.local`/`gopher-api.local`/`gopher-db.local`/`gopher-redis.local`,
    reserved IPs `.53–.56`, reserved MACs). Self-hosted on the LAN; no cloud dependency.
    The host is ARM64, so images target `linux/arm64`.
16. **API surface is versioned** (`/api/v1/...`) and returns a consistent envelope
    (`version`, `statusCode`, `success`, `message`, `result`).
17. **Zero external dependencies — self-hosted, LAN-only (non-negotiable).** No
    third-party service accounts and no external services at runtime: no cloud/hosting,
    public domain/DNS, CDN, external identity provider/OAuth, payment, analytics,
    email/SMTP provider, or push gateway. The only outbound network use is at *build*
    time (pinned package deps + Docker base images), which can be mirrored/vendored.
    **TLS is intentionally omitted** (plain HTTP on the trusted LAN); the web client is
    served same-origin so secure cookies are unnecessary.

## Consequences

- Every later EP restates the relevant detail locally, so the plan stays self-contained.
- These invariants are referenced by EP Implementation Guidance; a change to any of them
  requires a new ADR that supersedes the affected clause.
- The clean-slate finance direction (decision 12) means no historical SPENDEM code is
  read or ported; finance is specified entirely in EP-0032–EP-0036.
