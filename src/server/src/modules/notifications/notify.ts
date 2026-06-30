// notify(): the single creation point for notifications (like auditLog). Inserts a row and
// emits a `notification.new` real-time event to the recipient's user channel.

import { type Database, db as defaultDb, type Tx } from '../../db/index.ts';
import { notifications } from '../../db/schema/index.ts';
import { broadcast } from '../../realtime/bus.ts';
import { RealtimeEvents, userChannel } from '../../realtime/events.ts';

export type NotificationRow = typeof notifications.$inferSelect;

export interface NotifyInput {
  householdId: string;
  recipientMemberId: string;
  type: string;
  title: string;
  body?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
}

export async function notify(
  input: NotifyInput,
  database: Database | Tx = defaultDb,
): Promise<NotificationRow> {
  const [row] = await database
    .insert(notifications)
    .values({
      householdId: input.householdId,
      recipientMemberId: input.recipientMemberId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      sourceEntityType: input.sourceEntityType ?? null,
      sourceEntityId: input.sourceEntityId ?? null,
    })
    .returning();

  await broadcast(userChannel(input.recipientMemberId), {
    type: RealtimeEvents.notificationNew,
    payload: {
      id: row!.id,
      type: row!.type,
      title: row!.title,
      body: row!.body,
      // Routing context so a live notification is deep-linkable without a reload.
      sourceEntityType: row!.sourceEntityType,
      sourceEntityId: row!.sourceEntityId,
      createdAt: row!.createdAt,
    },
  });

  return row!;
}
