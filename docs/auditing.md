# Gopher — Auditing & Value-Change Tracking

The two-tier audit infrastructure required by context §6. Implemented in
`src/server/src/audit/` over two append-only tables.

## Two tiers

| Tier | Table | Purpose |
|---|---|---|
| Action log | `audit_logs` | One row per audited action: actor, action, entity, IP, user-agent, metadata. |
| Value-change history | `value_change_history` | One row per changed sensitive/critical field: from→to values. |

Both tables are **append-only and immutable** — no soft-delete, no updates, never purged
as part of normal operation.

### `audit_logs` columns

`id`, `household_id?` (null = system-level), `actor_user_id?`, `actor_member_id?`,
`action`, `entity_type?`, `entity_id?`, `metadata jsonb`, `ip_address inet?`,
`user_agent?`, `created_at`. Indexed by `(household_id, created_at)` and
`(entity_type, entity_id)`.

### `value_change_history` columns

`id`, `household_id?`, `entity_type`, `entity_id`, `field_name`, `old_value?`,
`new_value?`, `changed_by?`, `created_at`. Indexed by `(entity_type, entity_id)`.

## Helpers

```ts
import { auditLog, recordValueChange, recordValueChanges, AuditActions } from '../audit/index.ts';

// Tier 1 — action log (pass a tx to make it transactional with the change):
await auditLog({
  action: AuditActions.auth.login,        // ALWAYS a catalog constant, never a literal
  householdId, actorUserId, entityType: 'user', entityId: userId,
  ipAddress, userAgent, metadata: { method: 'password' },
}, tx);

// Tier 2 — value-change (single field):
await recordValueChange({ entityType: 'household_member', entityId, fieldName: 'role',
  oldValue: 'SupervisedUser', newValue: 'SupervisingUser', changedBy, householdId }, tx);

// Tier 2 — diff several fields at once; only changed fields are written:
await recordValueChanges({ entityType: 'user', entityId, changedBy, householdId,
  before, after, fields: ['email', 'passwordHash'], secretFields: ['passwordHash'] }, tx);
```

## When to log (tier 1)

Fire `auditLog` after: register, login, logout, token refresh, password reset, invite
created/accepted/revoked, member added, member role changed, member deactivated, household
settings updated. Each owning EP wires its own events using the `AuditActions.*` catalog —
**no action string literals at call sites** (grep-enforced).

## Which fields need value-change capture (tier 2)

The sensitive/critical fields: medication `dosage_amount`/`dosage_unit`, reward `balance`
adjustments, `household_members.role`, user `email`/`password_hash`, and critical finance
fields. Each owning EP wires its own captures around the write.

## Action naming

`<module>.<event>` (snake_case event), defined once in `src/audit/actions.ts`
(`AuditActions.auth.login` → `"auth.login"`). Modules append their own sections in their
EPs; call sites reference the constant.

## Integrity & performance

- **Transactional where it matters:** pass the active `tx` so the change and its audit
  rows commit together (e.g. role change + history). Otherwise audit writes are awaited on
  the happy path and may be made async for high-frequency actions.
- **Indexes:** `(household_id, created_at)` and `(entity_type, entity_id)` support the
  common audit queries.

## PII & secrets (never log)

- **Never store secret values.** For secret fields (`password_hash`, tokens) pass the
  field in `secretFields` so `recordValueChanges` records **presence-of-change**
  (`REDACTED`), not the value. `auditLog` metadata must never contain raw passwords,
  tokens, or full card numbers.
- Coverage against this catalog is re-checked in the EP-0038 hardening pass.

## Read API & compliance viewer (EP-0051)

EP-0009 builds the write path; EP-0051 adds **read-only** access and a Flutter "Activity log".

### Endpoints
- `GET /api/v1/households/:id/audit-logs?actor=&action=&entityType=&entityId=&from=&to=&page=`
  — household action log, newest-first, paginated (50/page).
- `GET /api/v1/households/:id/value-change-history?entityType=&entityId=&field=&from=&to=&page=`
  — value changes for the household's entities.
- `GET /api/v1/audit/system-logs?action=&from=&to=&page=` — system-level events
  (`household_id IS NULL`); **system roles only**.

### Access control (EP-0012)
Household reads require **`audit:read`**, granted to **Owner / `supervising_user`** and the
system roles. `unsupervised_user` / `supervised_user` get **403**. The system-logs endpoint
additionally requires a system actor.

### Enrichment
Rows are enriched with the actor's **display name** (member name preferred, else user name) and a
**friendly action label** derived from the action string (`household.invite_created` →
`Household · invite created`). `ip_address`/`user_agent` are included **only for privileged
viewers**.

### Redaction
- **Privileged** = a system actor or the household **Owner** — sees raw sensitive values + IP/UA.
- **Allowed-but-non-privileged** = a non-owner `supervising_user` — sensitive value-change fields
  (`valueNumeric`, `valueSecondary`, `dosageAmount`, finance amounts/balances, …) are masked to
  `<hidden>` (`redacted: true`).
- **`password_hash` is presence-only for everyone** — the write side already stores it redacted,
  so reads never expose a value.

Reads are strictly household-scoped (by `:id`); no cross-tenant rows are ever returned. This is an
inspection tool — lean, indexed, paginated — not a bulk export (export/retention/SIEM remain out
of scope, deferred to EP-0040/0038).
