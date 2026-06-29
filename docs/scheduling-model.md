# Gopher — Scheduling Model

The shared scheduling foundation (EP-0019). One polymorphic base (`scheduled_items`) for
all four schedulable types, with detail tables for events and tasks (EP-0021).

## Tables

| Table | Purpose |
|---|---|
| `scheduled_items` | Polymorphic base: `type ∈ {appointment, event, recurring_task, task}`, `title`, `starts_at`, `ends_at?`, `all_day`, `rrule?`, `rrule_until?`, `visibility`, `assignee_member_id?`, `time_of_day`, `custom_window_id?`, `pinned_time?`, `duration_minutes?`, `location`, `unskippable`, soft-delete. |
| `events` | 1:1 detail for events/appointments: `location?`, `url?`, `visibility`, `participants uuid[]`, `reminder_minutes_before?`. |
| `scheduling_tags` + `scheduled_item_tags` | Household tags + item↔tag junction (hard-deleted). |
| `time_windows` | Household-defined time-of-day windows (`start_minute`/`end_minute` 0–1439, `start < end`). |
| `occurrence_overrides` | Per-(item, date) deviations: `status`, `time_override`, `note`. |

`rrule_until` denormalizes the series upper bound; `(household_id, starts_at, rrule_until)`
is indexed for range queries.

## Type semantics

| Type | Completable? | Notes |
|---|---|---|
| `appointment` | no | Requires the presence/participation of ≥1 attendee. |
| `event` | no | Proceeds regardless of attendees. |
| `task` | yes (complete/skip/cancel) | Assignee is reward-eligible (EP-0028). |
| `recurring_task` | — | Template; generates `task` instances (EP-0022). Routine = recurring task + ordered steps (EP-0021). |

**Assignee vs attendee:** assignment (task) is reward-eligible; attendance (event
participant) is presence-only and not reward-eligible.

## Occurrence model

Per context §5, recurring tasks **generate** future instances in the background (EP-0022)
with generation boundaries to prevent duplicates. The `occurrence_overrides` table stores
per-date deviations (status/time/note) created only on interaction — it overlays both
generated instances and on-the-fly calendar expansion (EP-0020). Default occurrence state
is **Pending**. (The on-the-fly-only alternative is recorded as a documented option for
read-heavy calendars but is not the chosen path.)

## Visibility

`personal` items are visible only to the owner/assignee; `family` items to all members.
`SupervisedUser` sees only items assigned to them (enforced via the EP-0012 visibility
helper before serialization).

## Time-of-day & windows

`time_of_day ∈ {anytime, morning, afternoon, evening, custom}`. The default
Morning/Afternoon/Evening windows are seeded per household (rows in `time_windows`,
idempotent on `(household, name)`); `custom` references a `custom_window_id`. Standalone
task duration defaults to 30 minutes (5-min increments); routine-step durations use 1-min
increments.

## Tags

Updating an item's tag set **replaces the whole set**; deleting an item removes all its tag
links (hard delete of junction rows) while the tags themselves are retained.
