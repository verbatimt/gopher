// Calendar & events HTTP surface (/api/v1/households/:id/...). Writes require calendar:write;
// reads require calendar:read. Mutations broadcast `calendar.changed` to the household.

import { Elysia, t } from 'elysia';
import { guard } from '../../auth/guard.ts';
import { Permissions } from '../../auth/permissions.ts';
import { scopedToSelf } from '../../auth/visibility.ts';
import { success } from '../../http/envelope.ts';
import { BadRequestError, NotFoundError } from '../../http/errors.ts';
import { messages } from '../../http/messages.ts';
import { broadcast } from '../../realtime/bus.ts';
import { householdChannel, RealtimeEvents } from '../../realtime/events.ts';
import { resolveMemberId } from '../households/service.ts';
import {
  createEvent,
  type DeleteScope,
  deleteEvent,
  expandCalendar,
  getEvent,
  updateEvent,
} from './service.ts';

const recurrenceSchema = t.Object({
  frequency: t.Union([
    t.Literal('once'),
    t.Literal('daily'),
    t.Literal('weekly'),
    t.Literal('monthly'),
    t.Literal('yearly'),
  ]),
  interval: t.Optional(t.Integer({ minimum: 1, maximum: 365 })),
  end: t.Optional(
    t.Object({
      kind: t.Union([t.Literal('ongoing'), t.Literal('until'), t.Literal('count')]),
      until: t.Optional(t.String()),
      count: t.Optional(t.Integer({ minimum: 1 })),
    }),
  ),
});

async function emitChanged(householdId: string, itemId: string): Promise<void> {
  await broadcast(householdChannel(householdId), {
    type: RealtimeEvents.calendarChanged,
    payload: { itemId },
  });
}

const PAGE_SIZE = 200;

export const calendarPlugin = new Elysia({ name: 'calendar' })
  .use(guard)
  .post(
    '/households/:id/events',
    async ({ params, body, claims, set }) => {
      const item = await createEvent(params.id, claims!.userId, body);
      await emitChanged(params.id, item.id);
      set.status = 201;
      return success({ event: item }, { statusCode: 201, message: messages.CREATED });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.calendarWrite],
      body: t.Object({
        type: t.Union([t.Literal('event'), t.Literal('appointment')]),
        title: t.String({ minLength: 1, maxLength: 200 }),
        description: t.Optional(t.String({ maxLength: 2000 })),
        startsAt: t.String(),
        endsAt: t.Optional(t.String()),
        allDay: t.Optional(t.Boolean()),
        visibility: t.Optional(t.Union([t.Literal('personal'), t.Literal('family')])),
        assigneeMemberId: t.Optional(t.String()),
        location: t.Optional(t.String({ maxLength: 300 })),
        url: t.Optional(t.String({ maxLength: 500 })),
        participants: t.Optional(t.Array(t.String(), { maxItems: 100 })),
        reminderMinutesBefore: t.Optional(t.Integer({ minimum: 0, maximum: 10080 })),
        recurrence: t.Optional(recurrenceSchema),
      }),
    },
  )
  .get(
    '/households/:id/events/:eventId',
    async ({ params }) => {
      const detail = await getEvent(params.id, params.eventId);
      if (!detail) throw new NotFoundError('Event not found.');
      return success({ event: detail.item, detail: detail.event });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.calendarRead] },
  )
  .patch(
    '/households/:id/events/:eventId',
    async ({ params, body }) => {
      const updated = await updateEvent(params.id, params.eventId, body);
      await emitChanged(params.id, params.eventId);
      return success({ event: updated?.item, detail: updated?.event });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.calendarWrite],
      body: t.Object({
        title: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        description: t.Optional(t.String({ maxLength: 2000 })),
        startsAt: t.Optional(t.String()),
        endsAt: t.Optional(t.String()),
        allDay: t.Optional(t.Boolean()),
        visibility: t.Optional(t.Union([t.Literal('personal'), t.Literal('family')])),
        assigneeMemberId: t.Optional(t.String()),
        location: t.Optional(t.String({ maxLength: 300 })),
        url: t.Optional(t.String({ maxLength: 500 })),
        participants: t.Optional(t.Array(t.String(), { maxItems: 100 })),
        reminderMinutesBefore: t.Optional(t.Integer({ minimum: 0, maximum: 10080 })),
      }),
    },
  )
  .delete(
    '/households/:id/events/:eventId',
    async ({ params, query }) => {
      const scope = (query.scope ?? 'all') as DeleteScope;
      await deleteEvent(params.id, params.eventId, scope, query.date);
      await emitChanged(params.id, params.eventId);
      return success({ deleted: true, scope });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.calendarWrite],
      query: t.Object({
        scope: t.Optional(t.Union([t.Literal('this'), t.Literal('future'), t.Literal('all')])),
        date: t.Optional(t.String({ maxLength: 10 })),
      }),
    },
  )
  .get(
    '/households/:id/calendar',
    async ({ params, query, claims }) => {
      const from = query.from ? new Date(query.from) : null;
      const to = query.to ? new Date(query.to) : null;
      if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new BadRequestError('Valid `from` and `to` query parameters are required.');
      }
      const memberId = claims ? await resolveMemberId(claims.householdId, claims.userId) : null;
      const occurrences = await expandCalendar(params.id, from, to, {
        memberId,
        userId: claims!.userId,
        supervisedOnly: scopedToSelf(claims!.roles),
      });

      const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
      const start = (page - 1) * PAGE_SIZE;
      return success({
        occurrences: occurrences.slice(start, start + PAGE_SIZE),
        page,
        pageSize: PAGE_SIZE,
        total: occurrences.length,
      });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.calendarRead],
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        page: t.Optional(t.String({ maxLength: 8 })),
      }),
    },
  );
