# Gopher — Client Architecture

The Flutter client's foundation (EP-0006). Every feature EP slots into these layers and
conventions without exception.

## Layering

```
UI (screens / widgets)
   → provider (state: ChangeNotifier, exposes isBusy / error)
      → service (per-domain API calls)
         → ApiClient (transport: envelope parsing, ApiException, token injection)
```

UI never calls `ApiClient` directly; it goes through a provider and a service. Providers
extend `BaseProvider` for consistent loading/error handling and optimistic updates.

## Folder layout (`lib/`)

| Path | Contents |
|---|---|
| `core/constants.dart` | App name, build-time `API_BASE_URL`, breakpoints, module ids. |
| `core/theme/` | MD3 light/dark themes (`ColorScheme.fromSeed`). |
| `core/api/` | `ApiClient`, `Envelope`, `ApiException`, conditional `http` transport. |
| `core/storage/` | `TokenStore` abstraction (`SecureTokenStore`, `InMemoryTokenStore`). |
| `models/` | Plain data models (`fromJson`). |
| `services/` | Per-domain API services. |
| `providers/` | `BaseProvider` + feature providers (state). |
| `screens/<feature>/` | Feature screens; `screens/shell/` is the navigation shell. |
| `widgets/` | Shared widgets: `EmptyState`, `StatusBadge`, `MemberAvatar`, `ModuleGuard`. |

## Theming (Material 3)

`ThemeData(useMaterial3: true)` with light/dark `ColorScheme.fromSeed(seedColor: …)`.
Screens consume tokens via `Theme.of(context)` — **no hardcoded colors**. `themeMode` is
`system` so light/dark follow the device.

## Adaptive navigation

`AppShell` switches on MD3 breakpoints from a single source of truth
(`screens/shell/destinations.dart`):

- **Compact** (`width < 600`): bottom `NavigationBar`.
- **Medium/Expanded** (`width ≥ 600`): `NavigationRail`, **extended** (icon + label) at
  `width ≥ 1000`.

Both render the same destination list; selection is derived from the current route and
navigates via `go_router`.

## Canonical layouts (list-detail)

Breakpoint constants live in `core/constants.dart` and follow the MD3 window size classes:
`compactMaxWidth` (600), `mediumMinWidth` (600), `expandedMinWidth` (840), `largeMinWidth`
(1200), plus `extendedRailMinWidth` (1000) for the rail.

The list/detail features (recipes, inventory, vitals, tasks) use the canonical **list-detail**
layout via the shared `widgets/list_detail_layout.dart` (`ListDetailLayout`):

- **Compact / medium** (`width < expandedMinWidth`): single pane; tapping a row opens the detail
  as a full-screen `go_router` route (e.g. `/recipes/:id`), preserving deep links.
- **Expanded** (`width ≥ 840`): two panes — a fixed ~360dp list on the leading edge and the
  selected item's detail in the trailing pane; tapping a row selects in place (no push).

Each detail screen is split into a route wrapper (`XxxDetailScreen`, owns the `Scaffold`/`AppBar`)
and a pure `XxxDetailView` (no scaffold) so the same content renders full-screen or in a pane.
`ListDetailLayout.isTwoPane(context)` exposes the same `MediaQuery`-width decision the layout
uses, so list rows know whether to select-in-pane or push.

## Networking

`ApiClient` (transport) takes a base URL, an injectable `http.Client` (so it is testable
with `MockClient`), and a `TokenStore`. It:

- injects `Authorization: Bearer <token>` from the store,
- parses the `/api/v1` envelope and returns `result` (`getEnveloped` / `postEnveloped`),
- exposes `getRaw` for the non-enveloped `/health`,
- throws a typed `ApiException(statusCode, message)` on non-success or transport failure.

The transport is selected per platform via a conditional import
(`http_client_factory.dart` → `_io` / `_web`), so the same client works on native and web.
`API_BASE_URL` is supplied at build time (`--dart-define`), never hardcoded.

## State management

`BaseProvider` (a `ChangeNotifier`) exposes `isBusy`, `error`, `runGuarded` (loading +
typed-error capture) and `optimistic` (apply-then-rollback). Feature providers extend it
and are wired via `provider` (`MultiProvider` in `main.dart`).

## Secure storage

Tokens go through the `TokenStore` interface. Production uses `SecureTokenStore`
(flutter_secure_storage); tests/ephemeral use `InMemoryTokenStore`. The access token is the
only client-side secret; the refresh token lives in an httpOnly cookie (EP-0011).

## Routing & auth gate

`go_router` with an auth-gated `ShellRoute`. Unauthenticated users are redirected to
`/sign-in`; authenticated users land in `AppShell`. `AuthProvider` (token presence) is the
`refreshListenable`. The foundation ships a placeholder sign-in; the real credential flow
is EP-0015.

## Module gating

`ModuleGuard(module: …)` shows its child only when the household has that module active
(`ModuleProvider`, fed by the household's `active_modules` in EP-0014/0015); otherwise a
friendly empty state.

## How to add a feature

1. Add a `model` (`fromJson`), a `service` (calls `ApiClient`), and a `provider`
   (extends `BaseProvider`).
2. Add a `screens/<feature>/` screen; gate module-specific content with `ModuleGuard`.
3. Register the route in `screens/router.dart`; add a destination in
   `screens/shell/destinations.dart` if it is top-level.
4. Register the provider in `main.dart`.
5. Keep `flutter analyze` clean and add widget/unit tests.

## Offline / LAN constraints

All fonts and Material icons are bundled (tree-shaken at build) — nothing is fetched from
a CDN. The client runs on a LAN with no internet access; plain HTTP, same-origin in
production.
