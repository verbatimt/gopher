# Gopher — Household Model

The tenancy root and its membership (EP-0013): `households`, `household_members`,
`household_invites`. Owns context §7's *Households* and *Household Members*.

## ER overview

```
users ──┐                          households ──< household_invites
        └──< household_members >── households
                 │ user_id NULL ⇒ managed/dependent profile (no login)
                 └── role_id → roles ; is_owner flag
```

| Table | Key columns |
|---|---|
| `households` | `name`, `timezone` (UTC default), `locale`, `active_modules text[]`, `reward_currency_name` (default "Points"), `created_by`, soft-delete |
| `household_members` | `household_id`, `user_id?` (NULL ⇒ managed), `display_name`, `avatar_url?`, `date_of_birth?`, `is_managed`, `is_owner`, `role_id`, soft-delete |
| `household_invites` | `household_id`, `invited_by?`, `email`, `token_hash` (unique), `role_id`, `accepted_at?`, `revoked_at?`, `expires_at`, `created_at` |

## Member states

| State | Meaning | Encoding |
|---|---|---|
| **Linked** | A login account is attached. | `user_id` set, `is_managed = false`. |
| **No Account** | Managed/dependent profile (e.g. a child). | `user_id = NULL`, `is_managed = true`. |
| **Invite Pending** | An invite exists but is not yet accepted. | a row in `household_invites` with `accepted_at IS NULL` (no member row yet, or a pending link). |

Auth never assumes a member has a login — `user_id = NULL` is first-class.

## Owner rule (Gopher decision)

The **owner** is encoded as an `is_owner` boolean flag on `household_members` (decision:
flag, not a separate grant). A **partial unique index** enforces **at most one owner per
household** (`WHERE is_owner = true`). Rules (enforced in EP-0014):

- Exactly one owner per household; a new household always has exactly one.
- The owner **cannot be removed** (`assertDeletable`).
- **Owner transfer** sets the new owner's flag and demotes the prior owner's role to
  `unsupervised_user`.

The owner is always a `supervising_user` (role linkage); see `identity-model.md`.

## Active modules

`active_modules` defaults to
`{calendar, tasks, medications, rewards, finance, meals}` (the gateable feature modules;
**dashboard is always-on** and not gated). It is editable by supervisors (EP-0014) and
drives client module gating (EP-0015). Module ids match the client `AppModules` ids
(`finance`, not "finances") so server and client agree.

## Invitations

- **Single-use**, hashed token (`token_hash` unique — the raw token is shared out-of-band,
  never stored).
- **Validity: 7 days** (Gopher default; a single config constant applied at creation,
  EP-0014). Expired → `410 Gone`; already-accepted → `409`.
- **No duplicate pending invite** per `(household, email)` — enforced by a partial unique
  index `WHERE accepted_at IS NULL AND revoked_at IS NULL`. After revoke/expiry a fresh
  invite is allowed.
- Carries a `role_id` (the role the invitee will receive) and an `expires_at`.

## Optional Individual triad (not required for MVP)

`household_members` could later be split into a reusable `individuals` person-record (one
person across multiple households) plus a per-household membership row referencing it. This
normalization is documented for the future; MVP keeps person attributes directly on
`household_members`.
