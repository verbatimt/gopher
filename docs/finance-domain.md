# Finance & Forecasting Domain (EP-0032)

Gopher's **clean-slate** finance/forecasting data model. The earlier SPENDEM project informs
the *concept* only (accounts, transfers between an origin and destination account, recurrence-
driven balance projection via paired ledger entries); nothing is copied or ported. This
document is the source of truth for the entities, enums, groupings, and the money-type
decision that EP-0033 (engine) and EP-0034 (analytics) build on.

## Money type (single, documented decision)

All money in the **forecasting engine** subsystem (`finance_*` tables) is stored as
**`numeric(14, 2)`** — a fixed-precision decimal chosen for correctness (no binary-float
rounding). Arithmetic in EP-0033/0034 reads these as decimal strings, computes in JS `number`,
and applies **one rounding rule: round to 2 decimals** on every computed transfer amount and
balance before persisting. No other money representation is used anywhere in the engine.

**Boundary with EP-0036 (household finance extensions).** The day-to-day budgeting/expense
layer (`budgets`, `budget_categories`, `expenses`, …) is a **separate subsystem** with its own
money type **`numeric(12, 2)`**. The two are intentionally distinct (engine = projection/
forecasting; extensions = manual day-to-day budgeting) and are **not merged**. Their category
sets are *related, not shared*; any cross-feature reporting would need an explicit mapping.

> **Status (2026-06-30): EP-0036 retired from active scope.** Budgets/expenses/money-allowances
> were not requested and don't integrate with the forecasting engine, so their user-facing
> surface is removed — the client UI (`/budgets`, `/expenses`) and the server `financeExtPlugin`
> are gone/unmounted, and the money-allowance worker is no longer registered. The
> `numeric(12, 2)` tables are kept **dormant** (no destructive DROP migration; rows preserved).
> The forecasting engine described below is unaffected. See
> `docs/adr/ADR-0004-budgets-expenses-retired-dormant.md`.

## Naming notes

Two fields are renamed to avoid SQL reserved words (documented so callers aren't surprised):

- transaction `interval` → column **`interval_unit`** (the recurrence-interval enum); its
  multiplier is `frequency`.
- forecast `start` / `end` → columns **`start_date`** / **`end_date`**.

## Entities

| Table | Purpose | Household scope |
|---|---|---|
| `finance_accounts` | An account with a `current_balance` and a `type`. | `household_id` |
| `finance_transactions` | A recurring transfer: `origin_account_id` → `destination_account_id`, with category, transfer type/amount, recurrence (`ending`, `interval_unit`, `frequency`), and a `forecast_included` flag. | `household_id` |
| `finance_forecasts` | A projection over `[start_date, end_date]` with `generated_at`. | `household_id` |
| `finance_forecast_accounts` | Per-forecast account snapshot; carries the running `ending_balance` the engine projects. | via `forecast_id` |
| `finance_forecast_transactions` | Per-forecast transaction snapshot (terms frozen at generation). | via `forecast_id` |
| `finance_forecast_ledger_entries` | Paired origin (debit, −) + destination (credit, +) entries written per occurrence, with starting/ending balances. | via `forecast_id` |
| `finance_forecast_account_balances` | Daily per-account balance snapshot for net-worth charting. | via `forecast_id` |

`household_id` scopes `accounts`/`transactions`/`forecasts` directly (EP-0008); the forecast
child tables resolve their household through `forecast_id`.

## Enums (members, not wire-codes)

- **AccountType:** Checking, Savings, Credit, Vendor, Payroll, Individual, Investment, Loan, Interest.
- **TransactionCategory:** Auto, Food, Holidays, Home, Medical, Misc, Pay, Personal, Pet, Services, Subscriptions, Taxes, Utilities, Vacation, Payment, Interest, Transfer, Savings, Investment.
- **TransferType:** FixedAmount, OriginPercentage, DestinationPercentage.
- **TransactionEnding:** Ongoing, OnDate, AfterOccurrences.
- **RecurrenceInterval:** Once, Daily, Weekly, Monthly, Yearly.

Stored as their names in `text` columns guarded by `CHECK` constraints. Adding a member is a
migration, not a rewrite (`db/schema/finance/enums.ts` is the single source).

## Derived groupings

- **Assets** = {Checking, Savings, Investment} — positive net-worth contributors.
- **Liabilities** = {Credit, Loan} — balances are owed (held negative).
- **Net worth** = cash (assets) + credit (liabilities).
- **Category groups** (EP-0034 headline rollups): Earnings = {Pay}; Spending = {Auto, Food,
  Holidays, Home, Medical, Misc, Personal, Pet, Services, Subscriptions, Taxes, Utilities,
  Vacation}; Savings = {Savings, Transfer}; Investment = {Investment}; Credit & Loan Payments =
  {Payment}; Interest = {Interest}.

## Soft-delete + cascade

Soft-delete via `is_active` / `deleted_at` (rows are retained, never physically removed).
**Deactivating an account cascades a soft-deactivation to its transactions** (any transaction
whose origin or destination is that account) — implemented at the service layer (EP-0033) and
relied on by the engine, which only loads active accounts/transactions.
