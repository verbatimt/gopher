# Gopher — Deployment Guide (server.local)

Self-hosted, LAN-only, ARM64, **plain HTTP (no TLS)**, no external services. Build the
images on the dev machine, ship them to `server.local`, and run the production stack there.

## Topology

| Role | Hostname | IP | MAC | Container |
|---|---|---|---|---|
| Web / nginx | `gopher.local` | `192.168.50.53` | `02:EA:C0:A8:32:35` | `gopher_web` |
| API (Bun/Elysia) | `gopher-api.local` | `192.168.50.54` | `02:EA:C0:A8:32:36` | `gopher_api` |
| Postgres 18 | `gopher-db.local` | `192.168.50.55` | `02:EA:C0:A8:32:37` | `gopher_db` |
| Redis 7 | `gopher-redis.local` | `192.168.50.56` | `02:EA:C0:A8:32:38` | `gopher_redis` |

- **Build host:** `dev` (192.168.50.5). **Deploy target:** `server.local` (192.168.50.4,
  ARM64) over key-based SSH.
- **Same-origin web:** the browser only talks to `gopher.local`; nginx serves the Flutter
  web bundle and reverse-proxies `/api`, `/ws`, and `/health` to the API over the internal
  bridge. The refresh cookie stays first-party over plain HTTP — no CORS, no TLS.
- Backend (DB/Redis↔API and nginx→API) runs on the internal bridge `gopher_internal`.

## Network: shared macvlan (the one-macvlan-per-parent constraint)

Docker permits **one macvlan per parent interface**. On `server.local`, `eth0` already hosts
a single shared LAN macvlan, **`everyapp_macvlan`** (subnet `192.168.50.0/24`, gw `.1`),
used by the other apps on the host (Loom, EveryApp, …). A second `gopher_macvlan` on `eth0`
would fail.

Per **EP-0041 §7(c)**, Gopher therefore **reuses the existing shared macvlan** with its own
reserved IPs/MACs (`.53–.56`) rather than creating a new one — exactly the posture the Loom
deploy uses. `docker-compose.prod.yml` declares `everyapp_macvlan` as `external: true` and
does not disturb the other apps' containers (`.50–.52`, `.220–.222`, `.226–.227`).

> If this host is ever rebuilt so Gopher is the *only* macvlan consumer, create a dedicated
> `gopher_macvlan` (resolution a); if multiple apps must coexist on one parent, prefer a
> neutral shared name like `lan_macvlan` (resolution c) and point all apps at it. The
> reserved IPs are the source of truth regardless of the network's name.

## Name resolution

The router provides DNS + DHCP reservations mapping the reserved MACs → `.53–.56` and the
`*.local` names, so `gopher.local` etc. resolve LAN-wide. A `hosts`-file fallback works too.
No public domain/DNS/registrar. (Note: the macvlan *host* — `server.local` itself — can't
reach its own macvlan IPs without a shim; other LAN devices can. Backend traffic uses the
internal bridge regardless.)

## Deploy

```sh
cp src/infra/.env.prod.example src/infra/.env   # set POSTGRES_PASSWORD + JWT_SECRET
bash src/infra/scripts/deploy.sh
```

The script: builds `gopher-api` (linux/arm64) and the Flutter web bundle
(`--dart-define=API_BASE_URL=http://gopher.local`), builds the `gopher-web` nginx image,
`docker save | gzip` both, `scp`s them + the compose file + `.env` to
`server.local:~/gopher`, `docker load`s them, verifies the shared macvlan exists,
`docker compose -f docker-compose.prod.yml up -d --remove-orphans`, then runs migrations and
the role/permission seed inside the API container. Overridable via `REMOTE_HOST`,
`REMOTE_USER`, `PLATFORM`, `API_BASE_URL`, `MACVLAN_NET`.

## Web caching (cache busting)

`nginx.conf` sets `Cache-Control` per asset type so a redeploy is picked up without a manual
cache clear:

- `index.html`, `flutter_bootstrap.js`, `flutter.js`, `main.dart.js`,
  `flutter_service_worker.js`, `version.json`, and other `*.js`/`*.wasm`/`*.json` →
  **revalidate** (`no-cache`/`no-store, must-revalidate`). The browser always re-fetches these,
  so the new build — and the new `serviceWorkerVersion` baked into `flutter_bootstrap.js` (a
  per-build hash) — loads on the next visit; the updated service worker then refreshes its
  cached resources.
- `canvaskit/*` (SDK-versioned, immutable) → `public, max-age=31536000, immutable`.
- media/fonts/icons (`png|jpg|svg|ico|ttf|woff2|…`) → `public, max-age=86400`.

No build-id stamp is added to `deploy.sh` — Flutter's `serviceWorkerVersion` already changes
every build and the entrypoints are no-cache, which is the cache key. Verify with
`curl -I http://gopher.local/main.dart.js` (expect `no-cache`) and
`curl -I http://gopher.local/canvaskit/canvaskit.js` (expect `immutable`).

## Client configuration

- **Web** is served same-origin from `gopher.local` (calls relative `/api`, `/ws`).
- **Native** (Android/Windows) builds bake `--dart-define=API_BASE_URL=http://gopher.local`
  (all calls go through the nginx proxy on port 80). The API is also directly reachable at
  `http://gopher-api.local:3000` for debugging.

## First-run runbook

1. `bash src/infra/scripts/deploy.sh` → all four services healthy.
2. Migrations + role seed run automatically (re-runnable/idempotent).
3. Create the first household + owner by registering through the web UI
   (`http://gopher.local`) or `POST http://gopher.local/api/v1/auth/register`.
4. The entire stack runs offline-on-LAN after images are built (no runtime internet).

## Backup / restore (Postgres)

```sh
# Backup (run on server.local)
docker compose -f docker-compose.prod.yml exec -T gopher_db \
  pg_dump -U gopher gopher | gzip > gopher-$(date +%F).sql.gz

# Restore into a clean volume
gunzip -c gopher-YYYY-MM-DD.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T gopher_db psql -U gopher -d gopher
```

The Postgres data lives in the named volume `gopher_pg_data` and survives container
restarts; it is destroyed only by an explicit `docker volume rm` / `compose down -v`.

## Verify

```sh
curl http://gopher.local/                 # web UI (200)
curl http://gopher.local/health           # API health via nginx (200, healthy)
curl http://gopher.local/api/v1           # API index via nginx (envelope)
curl http://gopher-api.local:3000/health  # direct API on the macvlan (200)
```
