# Biometrics & Vitals Domain (EP-0043)

Net-new Tier 8 health domain: per-member biometric/vitals tracking. LAN-only; no wearable or
cloud-health integration (master plan §2.17). Clean-slate — informed by no external material.

## Tables

| Table | Purpose |
|---|---|
| `measurement_types` | Catalog of measurement types: system defaults (`household_id IS NULL`, read-only) ∪ household-custom (`household_id` set). |
| `biometric_measurements` | Time-series of recorded readings per member. |
| `measurement_targets` | Optional per-member goal range for a type; unique `(member_id, type_id)`. |

### `measurement_types`
- `key` — slug (`^[a-z0-9_]+$`), e.g. `weight`, `blood_pressure`.
- `value_shape` — `single` (one component) or `dual` (two components, e.g. systolic/diastolic).
- `unit_default` — default unit (`kg`, `mmHg`, `bpm`, `mg/dL`, `°C`, `%`).
- `precision` — decimal places for display/rounding (0–6).
- `min_normal` / `max_normal` — **display banding only; not used for validation.**
- Uniqueness: a partial unique index on `(key)` where `household_id IS NULL` (one global per key)
  and on `(household_id, key)` where `household_id IS NOT NULL` (one per household per key).

Seeded with six system defaults: `weight` (kg, single), `blood_pressure` (mmHg, **dual**),
`heart_rate` (bpm, single), `blood_glucose` (mg/dL, single), `body_temperature` (°C, single),
`spo2` (%, single). Seeding is idempotent (`seedMeasurementTypes`, registered in `seed.ts` and
the test bootstrap).

### `biometric_measurements`
- `value_numeric numeric(10,2)` — primary component (e.g. weight, systolic).
- `value_secondary numeric(10,2)?` — second component for `dual` types (e.g. diastolic).
- `unit` — stored **per reading as entered**; no automatic conversion (see Risks).
- `measured_at timestamptz` — UTC; rendered in the household timezone at the boundary.
- `recorded_by` — the member who recorded the reading.
- Soft-delete (`is_active`/`deleted_at`); never hard-erased (health-data sensitivity).

## `value_shape` semantics & validation

- `single` types require `value_numeric` only; supplying `value_secondary` is rejected (422).
- `dual` types require **both** `value_numeric` and `value_secondary`; a missing second
  component is rejected (422) with a clear envelope message.
- **Range sanity** (not a medical judgment): values must be finite, non-negative, and below a
  generous per-type cap (`weight ≤ 2000`, `blood_pressure/heart_rate ≤ 400`,
  `blood_glucose ≤ 2000`, `body_temperature ≤ 250`, `spo2 ≤ 100`; custom types fall back to a
  universal `1,000,000` cap). `min_normal`/`max_normal` are NOT used for acceptance.

## Trends

`GET .../measurements/trends?typeKey=&from=&to=` aggregates a single type over `[from,to]`:
latest reading, min/max/avg (rounded to the type precision), sample count, an **ascending**
series (`measured_at`, `value`, `value_secondary?`) for charting, and **adherence %** = share
of readings whose primary value falls within the band. The band is the member's target range
if set, else the type's normal band; a `null` bound leaves that side open. An empty range
returns zeros / empty series without error.

## Privacy / visibility rules (mirrors EP-0024/0026 health posture)

- `supervising_user` / `system` — read & record for **any** member; manage household-custom
  types (create/update/delete; system defaults are read-only).
- `unsupervised_user` — read & record their **own** readings; may set their **own** target.
- `supervised_user` — read & record their **own** readings only; **cannot** set targets
  (supervisor-managed). Reading another member returns 404 (existence hidden).
- Recording for **another** member is supervisor-gated (403 otherwise).
- Permissions: `vitals:read` / `vitals:write` (granted to all three household roles; scoping is
  enforced in the service).

## Auditing

Measurement updates capture from→to on `value_numeric` / `value_secondary` in
`value_change_history` (EP-0009). Creation/deletion follow the soft-delete contract.
