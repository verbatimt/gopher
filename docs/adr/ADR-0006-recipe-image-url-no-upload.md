# ADR-0006 — Recipe images via a stored URL (no upload pipeline yet)

- **Status:** Accepted
- **Date:** 2026-06-30
- **Context:** Recipes had no way to show a photo. The schema already carries
  `recipes.image_path` and the API already accepts/returns `imagePath` (create + update), but
  the client form had no image field and the detail/list rendered none. A storage approach had
  to be chosen before wiring the client.

## Context

The recipe domain (EP-0045) shipped `recipes.image_path` (free text) and the recipes API
validates + persists `imagePath` on create/update, but no image was ever entered or displayed.
The standing posture (ADR-0003, master plan §2.17) is **LAN-only, clean-slate, no external
service, no new dependency**, and an image **upload pipeline was deferred**.

Two options were considered:
- **(a)** Accept a path/URL on the recipe and render it (minimal; no server work).
- **(b)** Build an image-upload endpoint + storage on the API (LAN-only).

## Decision

Take **option (a)** — the minimal path. The recipe form gains an optional **"Image URL"**
field whose value is sent as `imagePath` (already part of the create/update contract; trimmed,
`null` when blank). The detail screen renders it as a banner and the list as a thumbnail via a
shared `RecipeImage` widget (`Image.network` with a placeholder/`errorBuilder` fallback), so a
missing, broken, or unreachable URL degrades to the recipe icon rather than crashing.

**No upload endpoint, no storage, no new dependency.** The image is expected to be a reachable
URL (typically LAN-served); cross-origin hosts must allow the image to load.

## Consequences

- A recipe can carry an image set by URL and it renders in the list + detail. No server, schema,
  or migration change was needed (the `imagePath` contract already existed end-to-end).
- The user supplies a URL; there is no in-app capture/upload. **Building a LAN image-upload
  endpoint + storage (option b) is the documented follow-up** if in-app upload is wanted.
- LAN-only / clean-slate / zero-external-dependency constraints hold; broken URLs fail safe.
