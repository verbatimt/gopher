# Gopher — Development

How to get Gopher building and running on a developer machine. Toolchain versions are
pinned in [`.tool-versions`](../.tool-versions) — that file plus this doc are the single
source of truth for versions (the EP-0003 container image must match the Bun pin).

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Bun | 1.3.10 | Server runtime + package manager. Must match `oven/bun:<pin>-alpine` in EP-0003. |
| Flutter | stable | Client SDK (Dart bundled). Targets Web, Windows, Android. |
| Docker + Compose | 25+/v2 | Local stack (Postgres, Redis, API) — EP-0003. |
| PostgreSQL client | 17+ | `psql` for manual DB checks (server runs Postgres 18 in a container). |

The deployment host is **ARM64**; container images target `linux/arm64`.

## Server (`src/server`)

```sh
cd src/server
cp .env.example .env          # then fill in real values (file is git-ignored)
bun install                   # install deps from the lockfile
bun run dev                   # watch mode (bun --watch src/index.ts)
```

Other commands:

| Command | What it does |
|---|---|
| `bun run start` | Run the API once (no watch). |
| `bun run typecheck` | `tsc --noEmit` in strict mode. |
| `bun run check` | Biome lint + format check. |
| `bun run format` | Biome format-write. |
| `bun test` | Run server unit tests. |
| `bun run db:generate` | Generate Drizzle migrations (once schema exists, EP-0007+). |
| `bun run db:migrate` | Apply migrations to `DATABASE_URL`. |

The API reads all configuration from environment variables (see `.env.example`). No
secrets are hardcoded. Default `PORT` is `3000`.

## Client (`src/client`)

```sh
cd src/client
flutter pub get
flutter analyze                                   # static analysis (must be clean)
flutter test                                      # widget/unit tests

# Run per target (API base URL injected at build time, never hardcoded):
flutter run -d chrome  --dart-define=API_BASE_URL=http://localhost:3000
flutter run -d windows --dart-define=API_BASE_URL=http://localhost:3000
flutter run -d <android-device> --dart-define=API_BASE_URL=http://gopher-api.local

# Web release build (for deployment behind the gopher.local proxy):
flutter build web --release --dart-define=API_BASE_URL=http://gopher-api.local
```

The **Web** target is the minimum gate for CI. Windows requires the Windows toolchain
(Visual Studio + Desktop C++); Android requires the Android SDK + JDK. Those are
documented as optional local prerequisites; Web must always build and analyze clean.

## Installing Flutter (Linux ARM64)

Flutter is not distributed via apt on ARM64; install from the stable git channel:

```sh
git clone https://github.com/flutter/flutter.git -b stable --depth 1 ~/flutter
export PATH="$HOME/flutter/bin:$PATH"     # add to your shell profile
flutter --version                          # bootstraps the bundled Dart SDK
flutter config --enable-web                # ensure the web target is enabled
```

## Environment contract

The server consumes exactly the variables documented in `src/server/.env.example`:
`PORT`, `NODE_ENV`, `DATABASE_URL`, `POSTGRES_PASSWORD`, `REDIS_URL`, `JWT_SECRET`,
`COOKIE_DOMAIN`, `CORS_ORIGINS`. `.env` is git-ignored; `.env.example` carries
placeholders only. The client takes `API_BASE_URL` via `--dart-define`.
