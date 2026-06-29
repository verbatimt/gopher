# Gopher — Tenancy & Deletion Contract

The authoritative, cross-cutting rules that keep every household's data isolated and make
deletion safe and reversible. This is the **data-layer guarantee** (defense-in-depth with
the EP-0012 HTTP middleware). Feature EPs must cite this contract; they declare
module-specific exceptions but never unify or override the rules here.

Implemented by `src/server/src/db/tenancy.ts` (scoping) and `db/deletion.ts` (deletion).

## Tenancy

- **Every household-owned table carries `household_id`.** No exceptions for household data.
- **All reads/writes go through `forHousehold(table, householdId)`** — a scoped repository
  that injects the household id on `create` and applies `WHERE household_id = …` on every
  read/update/soft-delete. A household therefore **cannot read, update, or delete another
  household's rows** through this surface (test-proven).
- **System-level access:** roles with `household_id IS NULL` (`system_admin`,
  `support_operator`) operate outside a single tenant for platform support. Such access
  bypasses the scoped factory deliberately, is authorized by EP-0012, and is audited
  (EP-0009 / EP-0038). It is the only sanctioned cross-tenant path.
- **One unscoped query = a tenancy breach.** Prefer the scoped factory so a bare query is
  hard to write; code review treats any unscoped household query as a defect.

## Deletion philosophy

**Hidden, not erased.** Almost everything is **soft-deleted** (`is_active = false`,
`deleted_at` set) and stays retrievable via `retrieveIncludingDeleted` / `restore`. Only
**junction/link rows** (no standalone meaning) are **hard-deleted**. **Append-only**
records (audit, ledgers, compliance logs) are never deleted. **Protected** rows (the
household owner) cannot be deleted at all (`assertDeletable`).

### Referential safety

- **Parent delete → relink children** to null ("uncategorized") via `relinkChildren`, so
  children survive and are not orphaned (test-proven for category→items).
- **Link delete →** `hardDeleteLinks` physically removes the join row only.
- **Member delete →** hide the member but preserve dependent data (their tasks, doses,
  ledger entries remain).
- **Owner →** `assertDeletable(isOwner)` rejects deletion (EP-0014 wires this).

## Deletion mode by entity (mandatory entities, context §7)

| Entity | Table(s) | Mode |
|---|---|---|
| Users | `users` | Soft-delete (deactivate). |
| Roles | `roles` | Soft-delete (role definitions). |
| Permissions | `role_permissions`, `user_roles` | **Hard-delete** (junction rows). |
| Households | `households` | Soft-delete. |
| Household Members | `household_members` | Soft-delete; **owner protected** (no delete). |
| — Invitations | `household_invites` | Soft-delete (status: pending/accepted/revoked). |
| Scheduled Items | `scheduled_items` | Soft-delete. |
| Events | `events` | Soft-delete (detail of a scheduled item). |
| Appointments | `scheduled_items` (`type='appointment'`) | Soft-delete. |
| Recurring Tasks | `recurring_tasks` | Soft-delete. |
| Tasks | `tasks`, `task_workflow_steps` | Soft-delete. |
| Rewards | `reward_rules` | Soft-delete. |
| — Reward ledger | `reward_transactions` | **Append-only** (never deleted). |
| Reward Catalog Items | `reward_store_items` | Soft-delete. |
| Medications | `medication_schedules`, `medication_refills` | Soft-delete. |
| Medication Logs | `medication_doses` | **Append-only / retained** (compliance history). |
| Financial Records | finance `accounts`, `transactions`, `forecasts`, `forecast_*` | Soft-delete; **account→transaction soft-delete cascade** (exception, EP-0032/0033); forecasts regenerate. |
| — Finance extensions | `budgets`, `budget_categories`, `expenses` | Soft-delete; categories relink children on delete; **expense deletion rule per EP-0036**. |
| Audit Records | `audit_logs`, `value_change_history` | **Append-only** (immutable; never deleted). |
| Notifications | `notifications` | Soft-delete (dismiss = inactive; retained). |
| — Pure join tables | e.g. tag links | **Hard-delete** (junction rows). |

### Documented exceptions (declared by owning EPs; not unified here)

- **Finance/forecasting (EP-0032/0033):** deactivating an `account` cascades a
  **soft-deactivation** to its `transactions`; forecasts are derived and regenerated, not
  soft-deleted individually.
- **Finance extensions (EP-0036):** defines its own `expenses` deletion semantics.

## Restore

Because data is retained, every soft-deletable repository exposes `restore(id)` to un-hide
a row. UIs may or may not surface it yet; the affordance exists at the data layer.
