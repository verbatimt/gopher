import { describe, expect, it } from 'bun:test';
import {
  expandRecurrence,
  getDatesBetween,
  localDateToUtc,
  occursOn,
  type RecurrenceSpec,
  toRRuleString,
} from './rrule.ts';

const utc = localDateToUtc;

describe('expandRecurrence — frequencies & intervals', () => {
  it('expands "every 3 weeks" with correct count and 21-day spacing', () => {
    const spec: RecurrenceSpec = { frequency: 'weekly', interval: 3 };
    const start = utc(2024, 1, 1);
    const occurrences = expandRecurrence(spec, start, utc(2024, 1, 1), utc(2024, 7, 1));
    // Jan 1 → Jul 1 is ~26 weeks; every 3 weeks → 9 occurrences.
    expect(occurrences.length).toBe(9);
    for (let i = 1; i < occurrences.length; i++) {
      const gapDays = (occurrences[i]!.getTime() - occurrences[i - 1]!.getTime()) / 86_400_000;
      expect(gapDays).toBe(21);
    }
  });

  it('expands daily, monthly, and yearly', () => {
    const start = utc(2024, 1, 1);
    expect(
      expandRecurrence({ frequency: 'daily' }, start, utc(2024, 1, 1), utc(2024, 1, 10)).length,
    ).toBe(10);
    expect(
      expandRecurrence({ frequency: 'monthly' }, start, utc(2024, 1, 1), utc(2024, 12, 31)).length,
    ).toBe(12);
    expect(
      expandRecurrence({ frequency: 'yearly' }, start, utc(2024, 1, 1), utc(2028, 1, 1)).length,
    ).toBe(5);
  });
});

describe('expandRecurrence — end conditions', () => {
  it('honors COUNT', () => {
    const spec: RecurrenceSpec = { frequency: 'daily', end: { kind: 'count', count: 4 } };
    const start = utc(2024, 1, 1);
    const occurrences = expandRecurrence(spec, start, utc(2024, 1, 1), utc(2025, 1, 1));
    expect(occurrences.length).toBe(4);
  });

  it('honors UNTIL', () => {
    const spec: RecurrenceSpec = {
      frequency: 'daily',
      end: { kind: 'until', until: utc(2024, 1, 5) },
    };
    const start = utc(2024, 1, 1);
    const occurrences = expandRecurrence(spec, start, utc(2024, 1, 1), utc(2025, 1, 1));
    // Jan 1..Jan 5 inclusive.
    expect(occurrences.length).toBe(5);
    expect(occurrences.at(-1)!.getUTCDate()).toBe(5);
  });

  it('Once yields exactly one occurrence regardless of frequency input', () => {
    const spec: RecurrenceSpec = {
      frequency: 'once',
      interval: 5,
      end: { kind: 'count', count: 99 },
    };
    const start = utc(2024, 3, 10);
    const occurrences = expandRecurrence(spec, start, utc(2024, 1, 1), utc(2025, 1, 1));
    expect(occurrences.length).toBe(1);
    expect(occurrences[0]!.getUTCDate()).toBe(10);
  });
});

describe('expandRecurrence — boundaries', () => {
  it('returns an empty list for a range with no occurrences', () => {
    const spec: RecurrenceSpec = { frequency: 'weekly' };
    const start = utc(2024, 1, 1);
    // A window entirely before dtstart.
    const occurrences = expandRecurrence(spec, start, utc(2023, 1, 1), utc(2023, 6, 1));
    expect(occurrences.length).toBe(0);
  });

  it('keeps the local day stable for an all-day monthly rule across a DST change', () => {
    // US DST starts 2024-03-10 and ends 2024-11-03. A floating all-day rule is unaffected.
    const spec: RecurrenceSpec = { frequency: 'monthly' };
    const start = utc(2024, 1, 15);
    const occurrences = expandRecurrence(spec, start, utc(2024, 1, 1), utc(2024, 12, 31));
    expect(occurrences.length).toBe(12);
    for (const occurrence of occurrences) {
      expect(occurrence.getUTCDate()).toBe(15); // day never shifts
    }
  });
});

describe('helpers', () => {
  it('getDatesBetween lists inclusive calendar days', () => {
    const days = getDatesBetween(utc(2024, 1, 1), utc(2024, 1, 5));
    expect(days.length).toBe(5);
    expect(days[0]!.getUTCDate()).toBe(1);
    expect(days[4]!.getUTCDate()).toBe(5);
  });

  it('occursOn detects an occurrence on a date', () => {
    const spec: RecurrenceSpec = { frequency: 'weekly' };
    const start = utc(2024, 1, 1); // a Monday
    expect(occursOn(spec, start, utc(2024, 1, 8))).toBe(true); // next Monday
    expect(occursOn(spec, start, utc(2024, 1, 9))).toBe(false);
  });

  it('toRRuleString produces an RRULE representation', () => {
    const str = toRRuleString({ frequency: 'weekly', interval: 2 }, utc(2024, 1, 1));
    expect(str).toContain('FREQ=WEEKLY');
    expect(str).toContain('INTERVAL=2');
  });
});
