# Gopher — Client (`src/client`)

The Gopher client: a **Flutter + Material Design 3** application targeting **Windows,
Android, and Web**. It talks to the API over the versioned REST surface and WebSocket
channels, stores tokens in secure storage, and is designed to be offline-capable.

## Architecture (layered)

```
UI (screens / widgets)  →  provider (state)  →  service (per-domain API calls)  →  ApiClient (transport)
```

Folder layout: `core/` (api client, constants, theme), `providers/`, `services/`,
`models/`, `screens/<feature>/`, `widgets/`.

## Conventions

- Material 3 only: `ThemeData(useMaterial3: true)` with `ColorScheme.fromSeed`; screens
  consume theme tokens — no hardcoded colors.
- Adaptive navigation: bottom `NavigationBar` at compact width, `NavigationRail`/sidebar
  at expanded width.
- The API base URL is supplied at build time via `--dart-define=API_BASE_URL`
  (default `http://gopher-api.local`); hosts are never hardcoded.
- All fonts and icons are bundled with the app — nothing is fetched from a CDN; the
  client must run on a LAN with no internet access.

## How it is run

- `flutter pub get` then `flutter run -d chrome` (Web), `-d windows`, or an Android
  device/emulator.
- Web release build for deployment: `flutter build web --dart-define=API_BASE_URL=...`.

> The scaffold and dependencies are established in EP-0002; the architecture, theming,
> and navigation shell in EP-0006.
