# ADR-0002 — Web Token Storage on a Plain-HTTP Origin

- **Status:** Accepted
- **Date:** 2026-06-28
- **Supersedes:** — (refines ADR-0001 decisions 3, 17 and EP-0006's "secure token storage")

## Context

Gopher is served to the browser over **plain HTTP** at `http://gopher.local` — a deliberate
LAN-only, no-TLS decision (ADR-0001 §17; EP-0041). The Flutter client originally persisted the
access token with **`flutter_secure_storage`** on every platform (`main.dart` → `SecureTokenStore`).

On the **web** target, `flutter_secure_storage` encrypts values with the Web Crypto API
(`window.crypto.subtle`). Browsers expose `crypto.subtle` **only in a "secure context"** — HTTPS,
or `http://localhost`/`127.0.0.1`. `http://gopher.local` is plain HTTP and is **not** localhost, so
`crypto.subtle` is `undefined` and **every token read/write throws**.

Effect on the deployed web app: registration created the account server-side (HTTP 201) but the
client threw while persisting the token, so the UI errored and a retry returned 409; login received
HTTP 200 but the throw escaped the screen's `await`, leaving the spinner stuck ("spins forever").
Native targets (Android/Windows, via Keystore/DPAPI) were unaffected. The unit/widget tests use an
`InMemoryTokenStore`, and `flutter analyze`/`flutter test` never run in a browser at a non-secure
origin, so every CI gate passed while the real web client was unusable.

## Decision

Select the token store **per platform**, via the same conditional-import seam already used for the
HTTP client (`core/api/http_client_factory.dart`):

- **Native** (`dart.library.io`): keep `SecureTokenStore` (flutter_secure_storage — Keychain /
  Keystore / DPAPI; no secure-context requirement).
- **Web** (`dart.library.js_interop`): use `WebTokenStore`, backed by `localStorage` via
  `shared_preferences` (already a dependency; no `crypto.subtle` dependency).

Files: `core/storage/token_store_factory.dart` (conditional export) →
`token_store_factory_io.dart` / `token_store_factory_web.dart`; `core/storage/web_token_store.dart`.
`main.dart` calls `createTokenStore()` instead of constructing `SecureTokenStore` directly.

## Consequences

- **Security tradeoff (web):** only the **short-lived (15-minute) access token** is held in
  `localStorage`. The real secret — the **refresh token** — remains in an `httpOnly` cookie that
  JavaScript cannot read (EP-0011). This is consistent with the accepted trusted-LAN / plain-HTTP
  threat model: traffic on the LAN is already unencrypted by design, and the app bundles no
  third-party JavaScript. An XSS bug could read the access token from `localStorage`, but its
  15-minute lifetime and the JS-inaccessible refresh cookie bound the exposure.
- **Native is unchanged** — still hardware/OS-backed secure storage.
- **If TLS is ever added** (e.g. a local CA on the LAN), the web origin would become a secure
  context and `flutter_secure_storage` would work on web again; revisit this ADR then.
- **Testing gap closed by process, not code:** "tests pass + analyze clean" must be paired with a
  smoke test of the **web build against the plain-HTTP deployment** for auth-touching changes.
