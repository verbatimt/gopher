# Gopher — Identity & Access Model

The identity and access-control substrate (EP-0010): users, roles, permissions, role
grants, and sessions. Authentication (EP-0011) and authorization (EP-0012) build on this.

## Tables (ER overview)

```
users ──< user_roles >── roles ──< role_permissions
  │                         (household_id NULL = system-level grant)
  └──< user_sessions
```

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Login identities | `email` (unique), `password_hash`, `display_name`, `avatar_url?`, `timezone`, `currency`, `is_active` |
| `roles` | Role definitions (seeded) | `name` (unique), `description?` |
| `role_permissions` | Permission grants per role | `role_id` → roles, `permission`; unique `(role_id, permission)` |
| `user_roles` | Role grants to users | `user_id` → users, `role_id` → roles, `household_id?`, `granted_at`, `granted_by`; unique `(user_id, role_id, household_id)` |
| `user_sessions` | Refresh-token sessions / device tracking | `user_id` → users, `refresh_token_hash` (unique, **hash only**), `device_label?`, `push_endpoint?`, `expires_at`, `last_used_at?` |

UUID v4 PKs, `timestamptz` UTC, soft-delete on `users`/`roles`. `role_permissions` and
`user_roles` are junction-like (hard-deleted, per the tenancy/deletion contract).

## System-level vs household-level (`household_id = NULL`)

A row in `user_roles` with `household_id = NULL` is a **system-level** grant
(platform-wide, cross-tenant) — used by `system_admin` and `support_operator`. A non-null
`household_id` scopes the grant to one household. The unique `(user_id, role_id,
household_id)` constraint lets a user hold a system grant **and** per-household grants of
the same role simultaneously. The EP-0012 guard treats system roles specially (see below).

## Roles

| Role | Kind | Owner/Guest note |
|---|---|---|
| `supervising_user` | household | **Owner** is a `supervising_user` flagged at the member level (EP-0013); the owner cannot be removed and owner transfer demotes the prior owner to `unsupervised_user`. |
| `unsupervised_user` | household | Independent member (e.g. roommate, autonomous teen). |
| `supervised_user` | household | Dependent (e.g. child). No finance access. |
| `system_admin` | system | Cross-tenant administrator; holds the wildcard `*`. |
| `support_operator` | system | Cross-tenant, read-mostly support. |

**Guest** is represented as a constrained household grant (today `supervised_user`/
`unsupervised_user` with a narrow permission set); a distinct `guest` role can be added as
a seed addition if a unique permission set is needed — permissions are data, not code.

## Permissions

Strings follow `resource:action`. `*` is a wildcard held only by `system_admin` and
satisfies any permission check.

## Role → permission matrix

| Permission | supervising | unsupervised | supervised | system_admin | support_operator |
|---|:--:|:--:|:--:|:--:|:--:|
| `household:read` | ✓ | ✓ | ✓ | (`*`) | ✓ |
| `household:write` | ✓ | | | (`*`) | |
| `members:read` | ✓ | | | (`*`) | ✓ |
| `members:write` | ✓ | | | (`*`) | |
| `calendar:read` | ✓ | ✓ | ✓ | (`*`) | |
| `calendar:write` | ✓ | ✓ | | (`*`) | |
| `tasks:read` | ✓ | ✓ | ✓ | (`*`) | |
| `tasks:write` | ✓ | ✓ | ✓ | (`*`) | |
| `medications:read` | ✓ | ✓ | ✓ | (`*`) | |
| `medications:write` | ✓ | ✓ | | (`*`) | |
| `rewards:read` | ✓ | ✓ | ✓ | (`*`) | |
| `rewards:write` | ✓ | | | (`*`) | |
| `rewards:manage` | ✓ | | | (`*`) | |
| `meals:read` | ✓ | ✓ | | (`*`) | |
| `meals:write` | ✓ | ✓ | | (`*`) | |
| `finance:read` | ✓ | ✓ | | (`*`) | |
| `finance:write` | ✓ | ✓ | | (`*`) | |
| `dashboard:read` | ✓ | ✓ | ✓ | (`*`) | |
| `audit:read` | | | | (`*`) | ✓ |
| **count** | 18 | 13 | 7 | 1 (`*`) | 3 |

`system_admin` holds the single wildcard `*` (= every permission). The matrix is defined
once in `src/server/src/auth/permissions.ts` and seeded by `db/seeds/roles.ts`
(idempotent: upsert role by name, insert grants ignoring conflicts).

## Sessions

`user_sessions` stores only the **SHA-256 hash** of each refresh token (never the raw
token), supporting device listing/revocation and rotation (EP-0011). `push_endpoint` is an
optional self-hosted UnifiedPush endpoint reserved for EP-0042 (no third-party token).
