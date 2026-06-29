// Calendar & events business logic: event/appointment CRUD (transactional with the
// scheduled_items base), the three delete scopes, and range expansion that overlays
// occurrence overrides and applies role-aware visibility.

import { and, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { db, withTransaction } from '../../db/index.ts';
import { events, occurrenceOverrides, scheduledItems } from '../../db/schema/index.ts';
import { NotFoundError } from '../../http/errors.ts';
import { expandRRuleString, type RecurrenceSpec, toRRuleString } from '../../recurrence/rrule.ts';

export type ScheduledItemRow = typeof scheduledItems.$inferSelect;

export interface RecurrenceInput {
  frequency: RecurrenceSpec['frequency'];
  interval?: number;
  end?: { kind: 'ongoing' | 'until' | 'count'; until?: string; count?: number };
}

export interface CreateEventInput {
  type: 'event' | 'appointment';
  title: string;
  description?: string;
  startsAt: string;
  endsAt?: string;
  allDay?: boolean;
  visibility?: 'personal' | 'family';
  assigneeMemberId?: string;
  location?: string;
  url?: string;
  participants?: string[];
  reminderMinutesBefore?: number;
  recurrence?: RecurrenceInput;
}

function toSpec(recurrence: RecurrenceInput): RecurrenceSpec {
  const end = recurrence.end;
  let mappedEnd: RecurrenceSpec['end'] = { kind: 'ongoing' };
  if (end?.kind === 'until' && end.until) mappedEnd = { kind: 'until', until: new Date(end.until) };
  else if (end?.kind === 'count' && end.count) mappedEnd = { kind: 'count', count: end.count };
  return { frequency: recurrence.frequency, interval: recurrence.interval, end: mappedEnd };
}

export async function createEvent(
  householdId: string,
  createdBy: string,
  input: CreateEventInput,
): Promise<ScheduledItemRow> {
  const startsAt = new Date(input.startsAt);
  let rrule: string | null = null;
  let rruleUntil: Date | null = null;
  if (input.recurrence) {
    const spec = toSpec(input.recurrence);
    rrule = toRRuleString(spec, startsAt);
    if (input.recurrence.end?.kind === 'until' && input.recurrence.end.until) {
      rruleUntil = new Date(input.recurrence.end.until);
    }
  }

  return withTransaction(async (tx) => {
    const [item] = await tx
      .insert(scheduledItems)
      .values({
        householdId,
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        startsAt,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        allDay: input.allDay ?? false,
        rrule,
        rruleUntil,
        visibility: input.visibility ?? 'family',
        assigneeMemberId: input.assigneeMemberId ?? null,
        location: input.location ?? null,
        createdBy,
      })
      .returning();
    await tx.insert(events).values({
      scheduledItemId: item!.id,
      location: input.location ?? null,
      url: input.url ?? null,
      visibility: input.visibility ?? 'family',
      participants: input.participants ?? [],
      reminderMinutesBefore: input.reminderMinutesBefore ?? null,
    });
    return item!;
  });
}

export interface EventDetail {
  item: ScheduledItemRow;
  event: typeof events.$inferSelect | null;
}

export async function getEvent(householdId: string, eventId: string): Promise<EventDetail | null> {
  const [item] = await db
    .select()
    .from(scheduledItems)
    .where(
      and(
        eq(scheduledItems.id, eventId),
        eq(scheduledItems.householdId, householdId),
        eq(scheduledItems.isActive, true),
      ),
    )
    .limit(1);
  if (!item) return null;
  const [event] = await db
    .select()
    .from(events)
    .where(eq(events.scheduledItemId, eventId))
    .limit(1);
  return { item, event: event ?? null };
}

export interface EventPatch {
  title?: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  allDay?: boolean;
  visibility?: 'personal' | 'family';
  assigneeMemberId?: string;
  location?: string;
  url?: string;
  participants?: string[];
  reminderMinutesBefore?: number;
}

export async function updateEvent(
  householdId: string,
  eventId: string,
  patch: EventPatch,
): Promise<EventDetail | null> {
  const existing = await getEvent(householdId, eventId);
  if (!existing) throw new NotFoundError('Event not found.');

  const itemUpdates: Partial<typeof scheduledItems.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) itemUpdates.title = patch.title;
  if (patch.description !== undefined) itemUpdates.description = patch.description;
  if (patch.startsAt !== undefined) itemUpdates.startsAt = new Date(patch.startsAt);
  if (patch.endsAt !== undefined) itemUpdates.endsAt = new Date(patch.endsAt);
  if (patch.allDay !== undefined) itemUpdates.allDay = patch.allDay;
  if (patch.visibility !== undefined) itemUpdates.visibility = patch.visibility;
  if (patch.assigneeMemberId !== undefined) itemUpdates.assigneeMemberId = patch.assigneeMemberId;
  if (patch.location !== undefined) itemUpdates.location = patch.location;

  const eventUpdates: Partial<typeof events.$inferInsert> = {};
  if (patch.location !== undefined) eventUpdates.location = patch.location;
  if (patch.url !== undefined) eventUpdates.url = patch.url;
  if (patch.visibility !== undefined) eventUpdates.visibility = patch.visibility;
  if (patch.participants !== undefined) eventUpdates.participants = patch.participants;
  if (patch.reminderMinutesBefore !== undefined) {
    eventUpdates.reminderMinutesBefore = patch.reminderMinutesBefore;
  }

  await withTransaction(async (tx) => {
    await tx.update(scheduledItems).set(itemUpdates).where(eq(scheduledItems.id, eventId));
    if (Object.keys(eventUpdates).length > 0) {
      await tx.update(events).set(eventUpdates).where(eq(events.scheduledItemId, eventId));
    }
  });
  return getEvent(householdId, eventId);
}

export type DeleteScope = 'this' | 'future' | 'all';

export async function deleteEvent(
  householdId: string,
  eventId: string,
  scope: DeleteScope,
  date?: string,
): Promise<void> {
  const existing = await getEvent(householdId, eventId);
  if (!existing) throw new NotFoundError('Event not found.');

  if (scope === 'all') {
    await withTransaction(async (tx) => {
      await tx.delete(occurrenceOverrides).where(eq(occurrenceOverrides.scheduledItemId, eventId));
      await tx
        .update(scheduledItems)
        .set({ isActive: false, deletedAt: new Date() })
        .where(eq(scheduledItems.id, eventId));
    });
    return;
  }

  const day = date ?? existing.item.startsAt.toISOString().slice(0, 10);

  if (scope === 'this') {
    await db
      .insert(occurrenceOverrides)
      .values({ scheduledItemId: eventId, occurrenceDate: day, status: 'cancelled' })
      .onConflictDoUpdate({
        target: [occurrenceOverrides.scheduledItemId, occurrenceOverrides.occurrenceDate],
        set: { status: 'cancelled', updatedAt: new Date() },
      });
    return;
  }

  // scope === 'future': truncate the series just before the target date.
  const until = new Date(`${day}T00:00:00.000Z`);
  until.setUTCMilliseconds(until.getUTCMilliseconds() - 1);
  await db
    .update(scheduledItems)
    .set({ rruleUntil: until, updatedAt: new Date() })
    .where(eq(scheduledItems.id, eventId));
}

export interface CalendarOccurrence {
  itemId: string;
  type: string;
  title: string;
  date: string;
  startsAt: string;
  allDay: boolean;
  visibility: string;
  assigneeMemberId: string | null;
  status: string;
}

export interface VisibilityContext {
  memberId: string | null;
  userId: string;
  supervisedOnly: boolean;
}

function isVisible(item: ScheduledItemRow, ctx: VisibilityContext): boolean {
  if (ctx.supervisedOnly) return item.assigneeMemberId === ctx.memberId;
  if (item.visibility === 'family') return true;
  return item.assigneeMemberId === ctx.memberId || item.createdBy === ctx.userId;
}

export async function expandCalendar(
  householdId: string,
  from: Date,
  to: Date,
  ctx: VisibilityContext,
): Promise<CalendarOccurrence[]> {
  const items = (
    await db
      .select()
      .from(scheduledItems)
      .where(
        and(
          eq(scheduledItems.householdId, householdId),
          eq(scheduledItems.isActive, true),
          lte(scheduledItems.startsAt, to),
          or(isNull(scheduledItems.rruleUntil), gte(scheduledItems.rruleUntil, from)),
        ),
      )
  ).filter((item) => isVisible(item, ctx));

  if (items.length === 0) return [];

  const overrides = await db
    .select()
    .from(occurrenceOverrides)
    .where(
      inArray(
        occurrenceOverrides.scheduledItemId,
        items.map((i) => i.id),
      ),
    );
  const overrideMap = new Map<string, typeof occurrenceOverrides.$inferSelect>();
  for (const o of overrides) overrideMap.set(`${o.scheduledItemId}:${o.occurrenceDate}`, o);

  const occurrences: CalendarOccurrence[] = [];
  for (const item of items) {
    let dates: Date[];
    if (item.rrule) {
      const cappedTo = item.rruleUntil && item.rruleUntil < to ? item.rruleUntil : to;
      dates = expandRRuleString(item.rrule, from, cappedTo);
    } else {
      dates = item.startsAt >= from && item.startsAt <= to ? [item.startsAt] : [];
    }
    for (const date of dates) {
      const day = date.toISOString().slice(0, 10);
      const override = overrideMap.get(`${item.id}:${day}`);
      if (override?.status === 'cancelled') continue;
      occurrences.push({
        itemId: item.id,
        type: item.type,
        title: item.title,
        date: day,
        startsAt: date.toISOString(),
        allDay: item.allDay,
        visibility: item.visibility,
        assigneeMemberId: item.assigneeMemberId,
        status: override?.status ?? 'pending',
      });
    }
  }

  occurrences.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return occurrences;
}
