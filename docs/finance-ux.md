# Finance & Forecasting UX (EP-0035)

The Flutter finance experience in Material Design 3 over the EP-0033/0034 API. A clean-slate
reproduction of the capability's **logical flow** (manage accounts → enter transactions
referencing accounts → create a forecast → explore its detail) — not a markup copy of any
prior toolkit.

## Structure

- **`/finance`** — a tabbed host (`FinanceScreen`) with three tabs:
  - **Accounts** (`accounts_screen.dart`) — list with create/edit/delete dialogs (name, type,
    current balance, notes).
  - **Transactions** (`transactions_screen.dart`) — list with create/edit/delete and an
    **inline forecast-included `Switch`** that calls `PATCH …/transactions/:id/included` and
    updates the row in place. Account pickers are sourced from the Accounts tab's data.
  - **Forecasts** (`forecasts_screen.dart`) — list + a create flow (description, start, end)
    that generates a forecast and navigates to its detail; delete.
- **`/finance/forecasts/:id`** — `ForecastDetailScreen`: a five-tab view —
  **Summary** (forecast-summary metrics + the net-worth chart), **Accounts**, **Transactions**,
  **Categories** (per-group metric tables from EP-0034), and **Ledger** (the entry list).

## Presentation choices (MD3)

- **Lists over data tables.** On phone/web-narrow, dense `DataTable`s overflow; the finance
  grids are rendered as MD3 `ListTile` rows (one line of metrics each) which stay usable across
  breakpoints. The detail tabs use a scrollable `TabBar` so all five labels fit on narrow
  widths.
- **Dialogs for create/edit.** `AlertDialog` + `DropdownButtonFormField` for the enum fields
  (account type, category, transfer type, interval, ending) keeps the forms compact; the form
  scrolls inside the dialog on small screens.
- **Net-worth chart** (`widgets/net_worth_chart.dart`) is a `CustomPainter` line chart (one
  vertex per snapshot date) — deliberately **no external charting package**, consistent with
  the LAN-only / minimal-dependency posture. It consumes EP-0034's `series`.
- **Validation + errors.** Client-side checks mirror the server (name required; origin ≠
  destination) and block invalid submits; API failures surface as `SnackBar`s carrying the
  server message (the server remains authoritative).

## Access

The finance nav is hidden from `SupervisedUser` (the server also denies that role on every
finance endpoint), shown only to `supervising_user` / `unsupervised_user`.
