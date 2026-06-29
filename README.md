# Gopher

**Gopher** is a modular **household operating system**: a multi-tenant platform that
gives a household intelligent organization for daily operations — scheduling,
tasks/chores, rewards, medication tracking, meal planning, and finance — with
offline-capable clients and real-time synchronization.

Gopher is a **clean-slate** product. It follows a lineage of earlier attempts
(DIDJA → SPENDEM → Lifetrack → Mira → Ultima → FamWise → Gopher). Those projects are
used only as loose guidance on structure and concepts — Gopher copies nothing from
them and brings in nothing verbatim. Everything needed to build Gopher is designed
fresh and stated inline in the planning artifacts.

## Stack

- **Client** — Flutter + Material Design 3, targeting Windows, Android, and Web.
- **API** — Bun + Elysia (REST + WebSockets).
- **Database** — PostgreSQL 18.
- **Cache / queue / pub-sub** — Redis 7.

Self-hosted and LAN-only: no third-party service accounts and no external services at
runtime. Plain HTTP on the trusted LAN; the eventual deployment target is `server.local`.

## Repository layout

| Path | Purpose |
|---|---|
| [`src/server`](src/server/README.md) | Bun/Elysia API (REST + WebSockets), Drizzle schema & migrations. |
| [`src/client`](src/client/README.md) | Flutter + Material Design 3 client (Windows/Android/Web). |
| [`src/infra`](src/infra/README.md) | Docker Compose stack and deployment assets. |
| [`docs/`](docs/) | Architecture Decision Records, conventions, and operational docs. |
| `.planning/` | The execution plan and per-EP work breakdown (local, not versioned). |

## Where to start

- The master execution plan: [`.planning/execution-plan.md`](.planning/execution-plan.md).
- Architecture baseline (the binding assumptions): [`docs/adr/ADR-0001-architecture-baseline.md`](docs/adr/ADR-0001-architecture-baseline.md).
- Cross-cutting conventions every EP relies on: [`docs/conventions.md`](docs/conventions.md).

Work proceeds one **execution plan (EP)** at a time, in dependency order. An EP is
"done" only when its Acceptance Criteria are all true and its Validation Steps pass on
a clean checkout, and the change keeps the build green.
