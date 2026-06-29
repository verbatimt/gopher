# Gopher — Recurring Task Generation

The background worker (EP-0022) materializes future task instances from recurring tasks,
the explicit mechanism context §5 requires of `RecurringTaskEntity`. Implemented in
`src/server/src/workers/recurring-task-generator.ts`.

## Cadence

`registerGenerationScheduler()` runs the worker on an interval (hourly by default),
registered at API startup (`index.ts`, only when run directly). The worker can also be
invoked directly (`generateRecurringTasks({ now?, householdId? })`).

## Boundary math (no duplicates)

For each active recurring task with an RRULE:

- **Horizon** = `now + generate_ahead_days`.
- **Window** = the half-open interval `(last_generated_at, horizon]` — `from` is
  `last_generated_at + 1 ms` (or the series start on first run). Occurrences at or before
  `last_generated_at` are never regenerated.
- Occurrences are expanded with the EP-0018 engine (tz-correct), and an existence check on
  `(recurring_task_id, occurrence_date)` plus the **unique constraint** of the same name are
  the duplicate backstop.
- After the window is processed, `last_generated_at` is advanced to the horizon.

A second immediate run therefore generates nothing (idempotent); advancing the clock a day
generates exactly the one new occurrence.

## Each instance

Per new occurrence date the worker creates, in one transaction:

1. a `scheduled_items` row (`type = task`, `starts_at` = the occurrence date, copying the
   template's title/description/unskippable), and
2. a `tasks` row linked to the recurring task (`recurring_task_id`, `occurrence_date`).

## Rotation

- With a `rotation_pool`, the instance is assigned `pool[rotation_index % pool.length]` and
  `rotation_index` is **advanced inside the same transaction** (fairness under retries),
  wrapping at the pool boundary.
- With a **null** pool, every instance uses the recurring task's fixed assignee.

## Concurrency

A Redis lock (`SET … NX EX`) guards the run so multiple API replicas don't double-generate.
The lock TTL exceeds the expected run time; each recurring task generates in its own
transaction so one failure doesn't block the others (logged and skipped).

## Emissions & observability

When a recurring task generates ≥1 instance, `calendar.changed` is broadcast to the
household so connected clients refetch. Each run logs per-run metrics: the number of
recurring tasks scanned, instances generated, and errors.
