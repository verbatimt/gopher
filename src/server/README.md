# Gopher — API (`src/server`)

The Gopher backend: a **Bun + Elysia** application exposing a versioned REST API and
WebSocket channels, persisting to **PostgreSQL** (via Drizzle ORM + drizzle-kit
migrations) and using **Redis** for cache, session/refresh-token storage, real-time
pub/sub fan-out, and background-queue support.

## Conventions

- API surface is versioned under `/api/v1/...` and returns the Gopher response
  envelope `{ version, statusCode, success, message, result }`.
- Household-scoped routes are `/api/v1/households/:id/<resource>` and pass through the
  tenancy guard; permission guards declare required permissions (e.g. `tasks:write`).
- Drizzle schema: one file per aggregate under `src/db/schema/`, re-exported from
  `index.ts`; explicit foreign keys; check constraints for enums/ranges.

See [`../../docs/conventions.md`](../../docs/conventions.md) and
[`../../docs/api-conventions.md`](../../docs/api-conventions.md) (added in EP-0005).

## How it is run

- **Local development:** `bun install` then `bun run dev` (watch). Configuration comes
  from `.env` (see `.env.example`).
- **Containerized:** built from `Dockerfile` and orchestrated by the Compose stack in
  [`../infra`](../infra/README.md).

> Toolchains, dependency declarations, and run commands are established in EP-0002;
> container/compose definitions in EP-0003; the application skeleton in EP-0005.
