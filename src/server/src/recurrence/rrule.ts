// The one canonical recurrence engine: iCalendar RRULE expansion shared by scheduling
// (EP-0019/0020), recurring-task generation (EP-0022), medications (EP-0024/0025), and the
// finance forecast engine (EP-0033). Built on the `rrule` library.
//
// Timezone discipline (Gopher's): stored datetimes are UTC. ALL-DAY recurrence uses
// "floating" UTC-encoded local dates (a local calendar day is encoded as that day's UTC
// midnight); because the engine never applies a timezone offset, DST transitions never
// shift the local day. TIMED recurrence stores UTC and is converted to the household IANA
// timezone at the API/UI boundary. Expansion ALWAYS takes a bounded [from, to] window.

import { type Options, RRule } from 'rrule';

export type IntervalFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export type EndCondition =
  | { kind: 'ongoing' }
  | { kind: 'until'; until: Date }
  | { kind: 'count'; count: number };

/** Gopher's interval model — mapped to a single RRULE representation. */
export interface RecurrenceSpec {
  frequency: IntervalFrequency;
  /** Frequency multiplier (RRULE INTERVAL); defaults to 1. Ignored for `once`. */
  interval?: number;
  end?: EndCondition;
}

const FREQUENCY: Record<Exclude<IntervalFrequency, 'once'>, number> = {
  daily: RRule.DAILY,
  weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY,
  yearly: RRule.YEARLY,
};

function buildRule(spec: RecurrenceSpec, dtstart: Date): RRule {
  // `Once` → a single occurrence at dtstart (frequency/end ignored).
  if (spec.frequency === 'once') {
    return new RRule({ freq: RRule.DAILY, count: 1, dtstart });
  }
  const options: Partial<Options> = {
    freq: FREQUENCY[spec.frequency],
    interval: spec.interval && spec.interval > 0 ? spec.interval : 1,
    dtstart,
  };
  if (spec.end?.kind === 'count') options.count = spec.end.count;
  else if (spec.end?.kind === 'until') options.until = spec.end.until;
  return new RRule(options);
}

/** Expand a recurrence spec into ordered occurrences within [from, to] (inclusive). */
export function expandRecurrence(
  spec: RecurrenceSpec,
  dtstart: Date,
  from: Date,
  to: Date,
): Date[] {
  return buildRule(spec, dtstart).between(from, to, true);
}

/** The canonical RRULE string for a spec (for storage/inspection). */
export function toRRuleString(spec: RecurrenceSpec, dtstart: Date): string {
  return buildRule(spec, dtstart).toString();
}

/** Expand a raw RRULE string within [from, to] (inclusive). */
export function expandRRuleString(rruleString: string, from: Date, to: Date): Date[] {
  return RRule.fromString(rruleString).between(from, to, true);
}

/**
 * Return a self-contained RRULE string anchored at `dtstart`. A caller-supplied dosing
 * pattern (e.g. `FREQ=DAILY;BYHOUR=8,20`) often omits DTSTART; this normalizes it so later
 * `expandRRuleString` calls expand from the correct anchor (used by medications, EP-0024).
 * Throws if the pattern is not a parseable RRULE.
 */
export function withDtstart(rruleString: string, dtstart: Date): string {
  const options = RRule.parseString(rruleString);
  options.dtstart = dtstart;
  return new RRule(options).toString();
}

/** Inclusive list of UTC day-midnights from `start` to `end` (calendar days). */
export function getDatesBetween(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor.getTime() <= last.getTime()) {
    dates.push(new Date(cursor.getTime()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/** Does an occurrence fall on the given (UTC-encoded) calendar day? */
export function occursOn(spec: RecurrenceSpec, dtstart: Date, date: Date): boolean {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  return expandRecurrence(spec, dtstart, dayStart, dayEnd).length > 0;
}

/** Encode a local calendar date as a floating UTC midnight (for all-day recurrence). */
export function localDateToUtc(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day));
}
