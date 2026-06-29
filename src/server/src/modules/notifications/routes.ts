// Notification endpoints (/api/v1/notifications). Recipient-scoped: a member only sees
// their own. List is newest-first with unread-first ordering for the initial load; mark-read
// is a batch, idempotent operation.

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import { guard } from '../../auth/guard.ts';
import { db } from '../../db/index.ts';
import { notifications } from '../../db/schema/index.ts';
import { success } from '../../http/envelope.ts';
import { resolveMemberId } from '../households/service.ts';

const PAGE_SIZE = 20;

function toDto(row: typeof notifications.$inferSelect) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    isRead: row.isRead,
    readAt: row.readAt,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    createdAt: row.createdAt,
  };
}

export const notificationsPlugin = new Elysia({ name: 'notifications' })
  .use(guard)
  .get(
    '/notifications',
    async ({ claims, query }) => {
      const memberId = claims ? await resolveMemberId(claims.householdId, claims.userId) : null;
      const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
      if (!memberId) {
        return success({ notifications: [], page, pageSize: PAGE_SIZE, unreadCount: 0 });
      }

      const conditions = [eq(notifications.recipientMemberId, memberId)];
      if (query.isRead === 'true') conditions.push(eq(notifications.isRead, true));
      if (query.isRead === 'false') conditions.push(eq(notifications.isRead, false));

      const rows = await db
        .select()
        .from(notifications)
        .where(and(...conditions))
        // Unread first, then newest first.
        .orderBy(asc(notifications.isRead), desc(notifications.createdAt))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE);

      const [unread] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.recipientMemberId, memberId), eq(notifications.isRead, false)));

      return success({
        notifications: rows.map(toDto),
        page,
        pageSize: PAGE_SIZE,
        unreadCount: unread?.count ?? 0,
      });
    },
    {
      requireAuth: true,
      query: t.Object({
        isRead: t.Optional(t.String({ maxLength: 8 })),
        page: t.Optional(t.String({ maxLength: 8 })),
      }),
    },
  )
  .post(
    '/notifications/read',
    async ({ claims, body }) => {
      const memberId = claims ? await resolveMemberId(claims.householdId, claims.userId) : null;
      if (!memberId || body.ids.length === 0) return success({ updated: 0 });

      const updated = await db
        .update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(
          and(
            eq(notifications.recipientMemberId, memberId),
            inArray(notifications.id, body.ids),
            eq(notifications.isRead, false),
          ),
        )
        .returning({ id: notifications.id });

      return success({ updated: updated.length });
    },
    {
      requireAuth: true,
      body: t.Object({ ids: t.Array(t.String({ maxLength: 64 }), { maxItems: 200 }) }),
    },
  );
