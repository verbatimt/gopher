# Gopher — Infrastructure (`src/infra`)

Docker Compose stack and deployment assets for Gopher. Models the eventual
`server.local` topology so every data/feature EP can run against real services.

## Local stack

A one-command local stack brings up:

- **postgres** (`postgres:18`) — primary datastore, named volume for persistence.
- **redis** (`redis:7-alpine`) — cache, sessions, pub/sub, background queue.
- **api** — the Bun/Elysia API, built from [`../server/Dockerfile`](../server/README.md).

Services use in-network hostnames aligned to production naming (`gopher-db`,
`gopher-redis`, `gopher-api`) so connection strings are portable to `server.local`.
Postgres and Redis are **not** published to the host by default; only the API maps a
host port for local testing.

```sh
docker compose -f docker-compose.yml up -d        # bring the stack up
docker compose -f docker-compose.yml ps           # check health
docker compose -f docker-compose.yml down         # stop (data persists in the volume)
```

## Production topology (`server.local`)

The host is **ARM64**, so images target `linux/arm64`. The LAN reserves fixed
hostnames/IPs/MACs for `gopher.local`, `gopher-api.local`, `gopher-db.local`,
`gopher-redis.local`. Self-hosted, LAN-only, plain HTTP — no cloud dependency.

> Compose and the API Dockerfile are defined in EP-0003; CI/verification in EP-0004;
> the production network topology and deploy script in EP-0041.
