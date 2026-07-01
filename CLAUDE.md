# CLAUDE.md — Gopher

Modular household OS. Stack: Bun/TypeScript API (`src/server`, Elysia + Drizzle) + Flutter/CanvasKit web UI (`src/client`), Postgres + Redis. Deploy target: `server.local`.

## ⛔ Hard rules
- Never run, build-to-run, or deploy on localhost / `dev` (.5) — not the app, Postgres, or Redis. Only sanctioned running stack: prod on `server.local` (.4, ARM64).
- Clean slate: never copy/port code from prior projects (SPENDEM/famwise lineage is loose concept guidance only). Recorded in `docs/adr/ADR-0001-architecture-baseline.md` (#12).

## Hosts — shared `everyapp_macvlan` on eth0 (reuse; one macvlan per parent)
- `gopher.local` .53 (web/nginx, same-origin proxy) · `gopher-api.local` .54 · `gopher-db.local` .55 · `gopher-redis.local` .56
- `dev` .5 build host · `server.local` .4 deploy target (ARM64)

## Commits
- Commit on the current branch (no auto-branch off main unless told). Subject = what changed, not why. Never a `Co-Authored-By` (or any) trailer.

## Build / test / deploy
- Toolchain: `bun` + `make` on PATH; `flutter` is NOT on PATH — it lives at `~/flutter/bin` (`make` and `deploy.sh` fall back to it automatically).
- Verify entrypoint: `make` (local-first, no cloud CI) — `make check` (deps+types+lint+tests), `make test`, `make server-test`, `make client-test`, `make verify` (+ image/web builds).
- Deploy: `bash src/infra/scripts/deploy.sh` (dev → server.local). ~15 min; long quiet phase = Flutter wasm build, not a hang (watch `deploy.log` for `==> Deployment complete.`). Health: `curl http://gopher.local/health`.

## Tests
- Server suite fully embedded under `NODE_ENV=test`: pglite (in-proc Postgres WASM) + ioredis-mock; `test-setup.ts` migrates+seeds once. No localhost, no standalone engine.
- Rate-limit gotcha: shared ioredis-mock singleton + IP-less requests share `ratelimit:register:unknown` (register = 5/60s/IP) → 429 in full runs. Give each new test file a distinct `x-forwarded-for`.

## Sources of truth (local only — never web)
- Framework docs (exclusive): `.reference/docs/` — bun, elysia, flutter, material-spec.
- Execution plan (git-ignored): `.planning/execution-plan.md` + `.planning/execution/EP-0001..0042-*.md`.

## Playwright (Flutter web, arm64 Pi)
- App at `http://gopher.local` — login `/#/login`, app `/#/dashboard`. Test user `ttaber@gmail.com` / `test1234!`.
- chromium headless (chrome channel n/a on arm64; set in both playwright blocks in `~/.claude.json`, needs MCP restart); needs `libatk-bridge2.0-0`.
- CanvasKit = no real DOM: coordinate clicks + keyboard, not selectors; ~6s paint after nav. Screenshots → `.reference/media/screenshots/`.
