# Gopher — Recurrence Engine

One canonical recurrence engine (`src/server/src/recurrence/rrule.ts`), shared by scheduling
(EP-0019/0020), recurring-task generation (EP-0022), medications (EP-0024/0025), and the
finance forecast engine (EP-0033). No module reimplements recurrence or timezone logic.

## Interval model

Gopher exposes a simple interval model that maps to a single RRULE representation:

```ts
interface RecurrenceSpec {
  frequency: 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;     // frequency multiplier (RRULE INTERVAL); default 1
  end?:
    | { kind: 'ongoing' }
    | { kind: 'until'; until: Date }
    | { kind: 'count'; count: number };
}
```

## RRULE mapping

| Gopher | RRULE |
|---|---|
| `once` | `FREQ=DAILY;COUNT=1` (single occurrence at dtstart; frequency/end ignored) |
| `daily` / `weekly` / `monthly` / `yearly` | `FREQ=DAILY/WEEKLY/MONTHLY/YEARLY` |
| `interval: n` | `INTERVAL=n` |
| `end: { kind: 'count', count: n }` | `COUNT=n` |
| `end: { kind: 'until', until: d }` | `UNTIL=d` |
| `end: { kind: 'ongoing' }` | no terminator (bounded only by the query window) |

## API

```ts
expandRecurrence(spec, dtstart, from, to): Date[]   // ordered occurrences in [from, to]
expandRRuleString(rrule, from, to): Date[]          // expand a raw RRULE string
toRRuleString(spec, dtstart): string                // canonical RRULE for storage
getDatesBetween(start, end): Date[]                  // inclusive calendar-day list
occursOn(spec, dtstart, date): boolean              // occurrence-on-date predicate
localDateToUtc(year, month1, day): Date             // encode a local date as floating UTC
```

**Expansion always takes a bounded `[from, to]` window** — ongoing rules are never expanded
unbounded.

## Timezone discipline

- **Stored datetimes are UTC.**
- **All-day recurrence is "floating":** a local calendar day is encoded as that day's UTC
  midnight (`localDateToUtc`). The engine never applies a timezone offset, so **DST
  transitions never shift the local day** of an all-day occurrence (test-proven across the
  2024 US DST boundaries). Read the occurrence's UTC date as the local day.
- **Timed recurrence stores UTC** and is converted to the household/user IANA timezone at
  the API/UI boundary. (A timed event's wall-clock time may shift across DST unless the
  caller re-anchors it; all-day scheduling — the common case for tasks, medications, and
  forecasts — is DST-stable by construction.)

## Edge cases

- **Monthly on day 31:** the underlying RRULE library skips months without a 31st (no Feb
  31). Callers that need "last day of month" semantics should encode that explicitly; the
  default is RFC-standard skip behavior.
- **Empty windows** return `[]` (never an error).
- **`Once`** ignores `frequency`, `interval`, and `end` and yields exactly one occurrence at
  `dtstart`.
