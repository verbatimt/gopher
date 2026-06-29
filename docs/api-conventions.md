# Gopher — API Conventions

The contract every server EP follows. Implemented by the EP-0005 skeleton
(`src/server/src`); domain plugins are mounted under `/api/v1` in later EPs.

## Response envelope

Every `/api/v1` response — success **and** error — is the same shape, produced only via
the helpers in `http/envelope.ts` (never hand-rolled):

```json
{ "version": "v1", "statusCode": 200, "success": true, "message": "OK", "result": { } }
```

| Field | Meaning |
|---|---|
| `version` | API version (`v1`). |
| `statusCode` | Mirrors the HTTP status. |
| `success` | `true` on 2xx, `false` otherwise. |
| `message` | User-facing string (from the `messages.ts` catalog or a typed error). |
| `result` | Payload on success; `null` on error. |

Helpers:

```ts
success(result, { message?, statusCode? })   // 2xx, defaults 200 / "OK"
failure(statusCode, message)                  // non-2xx, result = null
```

## Error taxonomy → HTTP

Handlers `throw` a typed error (`http/errors.ts`); the centralized handler in `app.ts`
maps it to the status + envelope. Internal details and stack traces never reach the body.

| Error | Kind | HTTP |
|---|---|---|
| `BadRequestError` | BadRequest | 400 |
| `UnauthorizedError` | Unauthorized | 401 |
| `ForbiddenError` | Forbidden | 403 |
| `NotFoundError` | NotFound | 404 |
| `DuplicateError` | Duplicate | 409 |
| `InvalidError` | Invalid | 422 |
| `FailedOperationError` | FailedOperation | 500 |

Framework conditions map too: TypeBox `VALIDATION` → 422, unmatched route `NOT_FOUND` →
404, body `PARSE` failure → 400. 5xx are logged (with a request id); 4xx are not.

## Versioning & route modules

- All domain routes live under `/api/v1`. Household-scoped routes are
  `/api/v1/households/:id/<resource>` and pass through the tenancy guard (EP-0012).
- One Elysia plugin per domain (`new Elysia({ name }) … `), composed in `app.ts` via
  `.group('/api/v1', api => api.use(domainPlugin))`. Permission guards declare the
  permission they require (e.g. `tasks:write`).

## Validation

Validate at the route boundary with Elysia schema / TypeBox (`t.Object({...})`). Invalid
input yields a 422 envelope with `messages.INVALID_INPUT` — no schema internals leak.
Example (the `meta` plugin):

```ts
.post('/echo', ({ body }) => success({ echo: body.message }), {
  body: t.Object({ message: t.String({ minLength: 1, maxLength: 280 }) }),
})
```

## Health endpoint (documented envelope exception)

`GET /health` is a diagnostic endpoint with its **own** documented shape (not the
envelope):

```json
{ "status": "healthy", "services": { "database": true, "redis": true },
  "version": "v1", "uptime": 123 }
```

It checks Postgres (`SELECT 1`) and Redis (`PING`). Returns **200** when both are up,
**503 degraded** when either is down. This is the single deliberate exception to the
"all responses are envelopes" rule.

## OpenAPI

The spec is served by `@elysiajs/openapi` at `/openapi` (interactive) and
`/openapi/json` (raw). It documents `/health` and the `/api/v1` routes.

## CORS

The deployed web client is served **same-origin** (behind the `gopher.local` proxy,
EP-0041) and needs no CORS. Credentialed CORS is enabled only for the explicit origins in
`CORS_ORIGINS` (comma-separated, **never** a wildcard) to allow direct cross-origin
browser access during development.

## Request logging

Each request gets a `x-request-id` response header and a structured JSON log line
(`requestId`, `method`, `path`, `status`, `durationMs`). Logs are silent under
`NODE_ENV=test`.
