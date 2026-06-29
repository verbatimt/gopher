# Gopher — CI / Verification

Gopher's pipeline is **local-first**: a set of plain commands that run entirely on a
developer machine or on `server.local`, with **no dependency on any cloud CI service or
third-party account**. The single entrypoint is the root [`Makefile`](../Makefile).

## The verification entrypoint

```sh
make verify       # FULL entrypoint: checks + API image build + web build
make check        # fast verification (deps, types, lint, tests; no builds)
make test         # all tests (server + client)
make build        # API Docker image + Flutter web release bundle
make migrate      # apply Drizzle migrations to the local Postgres (EP-0007+)
make up / make down   # start / stop the local stack
make help         # list all targets
```

`make verify` is the single verification entrypoint (and what the pre-push hook runs): it
runs `make check` plus `make build` (API image + web bundle). `make check` runs, in order:

| Stage | Command | Notes |
|---|---|---|
| Server deps | `bun install --frozen-lockfile` | Reproducible from `bun.lock`. |
| Server types | `bun run typecheck` (`tsc --noEmit`) | Strict TypeScript. |
| Server lint | `bun run check` (Biome) | Lint + format check. |
| Server tests | `bun test` | Unit tests. |
| Client deps | `flutter pub get` | |
| Client analyze | `flutter analyze` | Must be clean. |
| Client tests | `flutter test` | Widget/unit tests. |

`make build` adds the API image build (`docker compose build api`) and the web release
build (`flutter build web --release`). Each stage is independently runnable
(`make server-typecheck`, `make build-web`, …) so failures are easy to localize.

> Flutter is resolved from `PATH`, falling back to `~/flutter/bin` (see
> [`development.md`](development.md)). Ensure Flutter is installed before running the
> client stages.

## Migrations smoke

`make migrate` applies Drizzle migrations against the disposable local Postgres from the
EP-0003 compose stack (pass `DATABASE_URL`). Until the schema exists (EP-0007) it prints a
documented placeholder and is a no-op.

```sh
make up                                   # start Postgres/Redis/API
export DATABASE_URL=postgres://gopher:<pw>@localhost:5432/gopher   # if DB port is exposed
make migrate
```

## Pre-push hook (opt-in)

Install a git hook that runs `make verify` before every push:

```sh
bash scripts/install-hooks.sh
```

The hook blocks a push when verification fails. It can be bypassed with
`git push --no-verify` (discouraged) — the entrypoint, not the hook, is the source of
truth.

## Optional self-hosted runner (never required)

For teams wanting automated runs, execute the **same** entrypoint on a self-hosted runner
on the LAN — e.g. a cron job or container on `server.local` that runs `make check` on a
schedule or on push to a local mirror. There is no separate cloud-only path; the runner
calls exactly the commands above. After dependencies are fetched/mirrored once, the entire
pipeline runs offline with no external calls.

## Offline guarantee

Every stage uses locally installed toolchains and the local Docker stack. The only
outbound network use is the initial dependency fetch (`bun install`, `flutter pub get`,
Docker base images), which can be mirrored/vendored for a fully air-gapped build. Nothing
in the pipeline contacts a cloud CI service or requires sign-up for an external service.
