# Gopher — Database Conventions

The PostgreSQL data layer: Drizzle ORM, the migration workflow, and the shared column
primitives every aggregate depends on. Realized under the server source root at
`src/server/src/db/` (the EP's `db/…` paths live here so they sit inside the Bun app).

## Layout

| Path | Purpose |
|---|---|
| `src/server/drizzle.config.ts` | drizzle-kit config (dialect, schema dir, out dir, `snake_case`). |
| `src/server/src/db/client.ts` | Shared postgres.js connection (`sql`) + `pingDatabase`. |
| `src/server/src/db/index.ts` | Drizzle client (`db`), `Tx` type, `withTransaction`. |
| `src/server/src/db/_shared.ts` | Column helpers (`baseColumns`, `timestamps`, `softDeleteColumns`, `actorColumns`). |
| `src/server/src/db/schema/` | One file per aggregate; all re-exported from `index.ts`. |
| `src/server/src/db/repo.ts` | Generic CRUD/soft-delete repository (`createRepository`). |
| `src/server/src/db/migrate.ts` | Migration runner (`bun run db:migrate`). |
| `src/server/src/db/migrations/` | Generated, reviewed, committed SQL + journal. |
| `src/server/src/db/seed.ts` | Idempotent seed runner scaffold. |

## Standards

- **Primary keys:** UUID v4 — `uuid().primaryKey().defaultRandom()` (`gen_random_uuid()`).
- **Timestamps:** `timestamp({ withTimezone: true })` (`timestamptz`), stored UTC.
- **Soft delete (default):** `isActive boolean default true` + `deletedAt timestamptz`.
  Reads hide inactive rows; data is retained ("hidden, not erased").
- **Tenancy:** household-owned tables carry `householdId uuid` (EP-0008).
- **Money:** finance/forecasting picks its own documented money type (EP-0032); the
  household finance extensions use `numeric(12,2)` (EP-0036). Keep each module internally
  consistent; document the boundary.
- **Casing:** column keys are camelCase in Drizzle; `casing: 'snake_case'` (config + the
  `drizzle()` call) maps them to snake_case columns. Generated SQL and runtime queries
  therefore agree.

## Adding a table (checklist)

1. Create `src/server/src/db/schema/<aggregate>.ts`; spread `baseColumns` (or
   `baseColumnsWithActor`) and add domain columns. Add explicit FKs and check constraints
   for enums/ranges.
2. Re-export it from `src/server/src/db/schema/index.ts`.
3. `bun run db:generate` → review the emitted SQL in `db/migrations/` (read it!).
4. Apply with `bun run db:migrate` (or `make migrate`).
5. Build a repository with `createRepository(table)` for standard CRUD/soft-delete, or add
   domain queries in a service.
6. Add tests (integration tests require the dev stack — see below).

## Migration workflow (forward-only)

- `drizzle-kit generate` diffs the schema against the committed journal and emits a new
  numbered SQL file. **Never edit an applied migration** — add a new one (e.g. an
  `ALTER TABLE`). The journal (`meta/_journal.json`) and snapshots are committed.
- `bun run db:migrate` applies pending migrations and is **idempotent** (drizzle records
  applied migrations in `drizzle.__drizzle_migrations`). Re-running is a no-op.
- The CI/verification entrypoint can run `make migrate` against the disposable local
  Postgres.

## Repository primitives

`createRepository(table)` returns: `create`, `retrieve` (active only),
`retrieveIncludingDeleted`, `listActive`, `update` (bumps `updated_at`), `softDelete`
(flip `is_active`/set `deleted_at`), and `restore`. Scoped/tenant-aware variants are added
in EP-0008. Multi-table writes use `withTransaction(tx => …)`.

## Running integration tests

DB-touching tests connect to `localhost:5432`. Bring up the dev stack first (it publishes
Postgres/Redis to the host via the compose override):

```sh
cd src/infra && docker compose up -d        # base + override (exposes 5432/6379, watch API)
cd ../server && DATABASE_URL=postgres://gopher:gopher_dev_pw@localhost:5432/gopher bun test
```

The production-shape stack (`docker compose -f docker-compose.yml …`) keeps Postgres/Redis
unpublished; the override is for development and tests only.
