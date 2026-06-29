# Gopher — Local Infrastructure

A one-command local stack — **PostgreSQL 18**, **Redis 7**, and the **API** — via Docker
Compose, modeling the eventual `server.local` topology so every data/feature EP can run
against real services. Files live in [`src/infra`](../src/infra).

## Bring it up / down

```sh
cd src/infra
cp .env.example .env                 # optional; defaults work for local dev

# Base stack only (no DB/Redis host ports — this is the CI/validation form):
docker compose -f docker-compose.yml up -d
docker compose -f docker-compose.yml ps          # postgres & redis show "healthy"
docker compose -f docker-compose.yml down        # stop; data persists in the volume

# Dev form (adds the watch overlay so the API live-reloads on source edits):
docker compose up -d                              # auto-loads docker-compose.override.yml
```

Tear down **and** delete data: `docker compose -f docker-compose.yml down -v`.

## Topology

| Service | Image | In-network alias | Host port | Notes |
|---|---|---|---|---|
| postgres | `postgres:18` | `gopher-db` | none | Named volume `gopher_pgdata`; `pg_isready` healthcheck. |
| redis | `redis:7-alpine` | `gopher-redis` | none | Named volume `gopher_redisdata`; `redis-cli ping` healthcheck. |
| api | built from `src/server/Dockerfile` | `gopher-api` | `${API_PORT:-3000}` | Waits for healthy DB+Redis (`depends_on`). |

All services share the `gopher_net` bridge network. The aliases match the production
hostnames (`gopher-db`, `gopher-redis`, `gopher-api`) so connection strings are portable
to `server.local` (EP-0041). **Only the API is published to the host**; Postgres and
Redis are reachable only inside the network.

## How the API reaches DB / Redis

The API resolves services by their in-network aliases:

```
DATABASE_URL = postgres://<user>:<pw>@gopher-db:5432/<db>
REDIS_URL    = redis://gopher-redis:6379
```

These are injected into the `api` service from the compose `environment:` block (built
from `.env`). `depends_on … condition: service_healthy` ensures the API only starts once
Postgres and Redis pass their healthchecks; the app should also retry/backoff on connect.

## Data persistence

Postgres data lives in the named volume `gopher_pgdata` and survives `down`/`up`. It is
destroyed only by an explicit `docker compose down -v` (or `docker volume rm`).

## Image

The API image is a multi-stage Bun build (`oven/bun:1.3.10-alpine`): a `deps` stage runs
`bun install --frozen-lockfile --production`, and the `runtime` stage copies only the
production `node_modules` plus source and runs as the non-root `bun` user. Targets
`linux/arm64` (the deployment host architecture). Measured image size: ~225 MB.
