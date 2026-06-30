# ADR-0004 — Budgets & Expenses (EP-0036) retired from active scope, tables left dormant

- **Status:** Accepted
- **Date:** 2026-06-30
- **Context:** The household finance-extensions surface (EP-0036: budgets, budget
  categories, expenses, expense shares, money allowances) was not requested and does not
  integrate with the Finance **forecasting** module (EP-0032/0033/0034). This ADR records the
  decision to remove it from the user-facing surface and the chosen removal posture.

## Context

EP-0036 shipped a day-to-day budgeting/expense layer (`numeric(12,2)` tables: `budgets`,
`budget_categories`, `expenses`, `expense_shares`, `money_allowances`) with a Flutter UI
(`/budgets`, `/expenses`) and an Elysia plugin mounted under `/api/v1`. It is a **separate
subsystem** from the forecasting engine (`finance_*`, `numeric(14,2)`) — the two were always
documented as distinct and not merged (see `docs/finance-domain.md`, "Boundary with EP-0036").

Two facts drove the decision:

1. **Not requested / no integration.** Budgets/expenses are not part of the active product and
   share no data flow with forecasting; their category sets are *related, not shared*. The
   feature added a user-facing surface with no consumer.
2. **`.planning/execution-plan.md` §1.2 already de-scoped the adjacent shared-expense
   splitting/settle-up** (leaving its scaffolding *dormant pending later cleanup, not
   extended*). This decision **extends** that posture to the rest of EP-0036 — it is a new
   decision, not merely an alignment, since §1.2 as written kept budgets/expenses/money-
   allowances.

## Decision

1. **Remove the user-facing surface.**
   - **Client:** delete the "Budgets & expenses" *More* entry, the `/budgets` + `/expenses`
     routes, `BudgetsScreen`/`ExpensesScreen`, `BudgetProvider`/`BudgetService`/`Budget` model,
     and their wiring in `main.dart`. The Finance (forecasting) entry, `/finance` routes, and
     the `finance` feature-module toggle are **kept**; the module description drops "Budgets,
     expenses" wording.
   - **Server:** unmount `financeExtPlugin` in `app.ts`; stop registering the money-allowance
     granter worker in `index.ts`. No EP-0036 HTTP route is served and no scheduled job writes
     expenses.

2. **Leave the database dormant — no destructive migration.** The Drizzle schema
   (`db/schema/finance-ext/*`, re-exported by `db/schema/index.ts`) and the underlying tables
   are **kept as-is**. Migrations are forward-only (`docs/db-conventions.md`); a full removal
   would require a new **DROP** migration that permanently deletes any existing
   budgets/expenses/money-allowances rows. That irreversible step is **not** taken without
   explicit confirmation. The orphaned module/worker files are left in place (banner-commented
   `DORMANT`) pending a later cleanup, not extended.

3. **Money-allowances drop with the rest.** `money_allowances` is an EP-0036 table whose granter
   records rows into `expenses`; it is **distinct** from the EP-0028 reward (points) allowance
   (`reward_allowances`, rewards module), which is **unaffected** and stays registered.

## Consequences

- No Budgets/Expenses UI is reachable; the forecasting Finance module is untouched.
- The dormant tables retain any pre-existing rows; re-enabling is a remount (low effort), and no
  data was destroyed. A future cleanup task may DROP the tables via a forward migration **with**
  explicit confirmation.
- The server test `finance-ext.test.ts` and the client `budget_test.dart` are removed (their
  surface no longer exists); `finance_test.dart` (forecasting) is unaffected.
- No new external dependency; LAN-only and clean-slate constraints hold.
