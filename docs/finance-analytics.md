# Finance Forecast Analytics (EP-0034)

Computed server-side from a generated forecast's **ledger entries** and **daily balance
snapshots** (EP-0033), sharing EP-0033's sign convention (origin = debit, negative;
destination = credit, positive) and the EP-0032 asset/liability groupings. Exposed at
`GET /api/v1/households/:id/finance/forecasts/:id/summary`. All money rounds to 2 decimals.

## Category groups (headline rollups)

| Group | Categories |
|---|---|
| Earnings | Pay |
| Spending | Auto, Food, Holidays, Home, Medical, Misc, Personal, Pet, Services, Subscriptions, Taxes, Utilities, Vacation |
| Savings | Savings, Transfer |
| Investment | Investment |
| Credit & Loan Payments | Payment |
| Interest | Interest |

A Pay transaction lands in **Earnings** (not Spending); a Payment lands in **Credit & Loan
Payments** (not Spending).

## Metric set (per account / per transaction / per category)

Computed over that group's ledger entries, ordered by the engine's `sequence`:

- **count** — number of ledger entries.
- **credit** — Σ `amount` on **credited** (destination, `origin = false`) entries (≥ 0).
- **debit** — Σ `amount` on **debited** (origin, `origin = true`) entries (≤ 0).
- **opening** — `starting_balance` of the first entry.
- **closing** — `ending_balance` of the last entry.
- **min / max** — min / max over every (`starting_balance`, `ending_balance`).
- **startDate / endDate** — first / last entry `date`.

Account summaries additionally carry `accountName`.

## Forecast summary

- **range** — `"{start_date} to {end_date}"`; `description`.
- **totals** — counts of snapshot accounts, snapshot transactions, ledger entries.
- **earned** — Σ credited amounts in **Earnings** categories.
- **spent** — Σ debited amounts in **Spending** categories (≤ 0).
- **saved / invested / creditLoanPayments / interest** — Σ credited amounts in the
  respective category groups.
- **startingCash / endingCash** — Σ `starting_balance` / `ending_balance` of **asset**
  snapshot accounts ({Checking, Savings, Investment}).
- **startingCredit / endingCredit** — Σ over **liability** snapshot accounts ({Credit, Loan}).
- **startingNetWorth / endingNetWorth** — cash + credit; **netWorthChange** = end − start.
- **series** — net-worth-over-time: one `{ date, netWorth }` point per snapshot date (the
  per-day `total` from `finance_forecast_account_balances`).

Cash and credit aggregate **only** the asset and liability account groups respectively (other
account types — Vendor, Payroll, Individual, Interest — are excluded from net worth).
