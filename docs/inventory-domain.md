# Household Inventory & Consumables Domain (EP-0048)

Net-new Tier 8 domain: track household consumables with a maintained on-hand quantity, an
append-only adjustment log, and a low-stock → grocery bridge. Clean-slate; LAN-only (the
`barcode` field is stored but there is no scanning/barcode-service dependency). Generalizes the
per-medication `stock_quantity` concept (EP-0024).

## Tables

| Table | Purpose |
|---|---|
| `inventory_items` | Items with a running `quantity` (numeric(12,2)), unit, category, location, low-stock threshold, optional expiry, and an `auto_add_to_grocery` flag. Soft-deleted. |
| `inventory_adjustments` | Append-only log: one row per change — `delta`, `reason`, `resulting_quantity`, `adjusted_by`. Immutable. |

## Adjustment semantics

`quantity` is **only** changed through `POST /inventory/:itemId/adjust` (never a raw write).
Each adjust is one transaction: the item row is locked (`FOR UPDATE`), the signed `delta` is
applied, the result is rejected if it would go **below zero** ("cannot consume more than on
hand"), the new running total is persisted, and an adjustment row is appended recording
`resulting_quantity`. `reason ∈ {restock, consume, correction, expired}`.

## Low-stock rule & grocery bridge

An item is **low stock** when `low_threshold IS NOT NULL AND quantity ≤ low_threshold`
(`isLowStock` is returned on every item DTO; `GET /inventory?lowStock=true` and
`GET /inventory/low-stock` filter on it).

When an adjustment **crosses** from above the threshold to at/below it and the item's
`auto_add_to_grocery` is true, a grocery line is merged into the household list. Merging is
**idempotent by item name** (case-insensitive, among active+unchecked lines) so repeated
low-stock crossings never spam duplicate lines. `POST /inventory/:itemId/add-to-grocery` does
the same merge on demand. The grocery list is the EP-0030 household list.

## Endpoints (`/api/v1/households/:id/...`)

- `GET /inventory?category=&location=&lowStock=&search=&expiringBefore=&page=` — filterable list.
- `POST /inventory`, `GET /inventory/:id`, `PATCH /inventory/:id`, `DELETE /inventory/:id` (soft).
- `POST /inventory/:id/adjust` — signed delta + reason (atomic running total + log row).
- `GET /inventory/:id/adjustments?page=` — history, newest-first.
- `GET /inventory/low-stock` — items at/below threshold.
- `POST /inventory/:id/add-to-grocery` — merge a grocery line for the item.

## Access

- **Item management** (create / update / delete): `inventory:write` — supervising/unsupervised.
- **Read + adjust** (consume / restock): `inventory:read` — granted to **all** member roles
  including `supervised_user`, so any member can record consumption/restock and browse stock.
- Gated client-side by the `inventory` feature module (`active_modules`).

## Cross-links (future, not built here)

- **Recipe-cook deduction** (EP-0045/0046): cooking a recipe could `consume` its ingredients
  from inventory — a documented future bridge.
- **Expiry surfacing**: `expires_at` + `GET ?expiringBefore=` / `reason=expired` support
  "expiring soon" without a scheduler.
