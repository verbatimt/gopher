// Integration tests for the notifications subsystem. Runs fully in-process on the embedded DB (pglite + ioredis-mock). The WS-emit path (notify -> bus -> user channel) is exercised with an in-process fake socket.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { householdMembers, users } from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';
import { RealtimeEvents } from '../../realtime/events.ts';
import {
  closeConnection,
  handleWsMessage,
  openConnection,
  type SocketLike,
} from '../../realtime/ws.ts';
import { notify } from './notify.ts';
import { NotificationTypes } from './types.ts';

const PORT = 3198;
const app = createApp();

const ownerEmail = 'notif-owner@x.test';
let token = '';
let householdId = '';
let memberId = '';

function decodeJwt(t: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(t.split('.')[1] ?? '', 'base64url').toString());
}

async function call(method: string, path: string, opts: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await app.handle(
    new Request(`http://localhost:${PORT}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function cleanup(): Promise<void> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail));
  for (const u of rows) {
    await db.execute(
      sql`DELETE FROM notifications WHERE household_id IN (SELECT id FROM households WHERE created_by = ${u.id})`,
    );
    await db.execute(sql`DELETE FROM user_sessions WHERE user_id = ${u.id}`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${u.id}`);
    await db.execute(
      sql`DELETE FROM household_members WHERE household_id IN (SELECT id FROM households WHERE created_by = ${u.id}) OR user_id = ${u.id}`,
    );
    await db.execute(
      sql`DELETE FROM time_windows WHERE household_id IN (SELECT id FROM households WHERE created_by = ${u.id})`,
    );
    await db.execute(sql`DELETE FROM households WHERE created_by = ${u.id}`);
    await db.execute(sql`DELETE FROM audit_logs WHERE actor_user_id = ${u.id}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${u.id}`);
  }
}

beforeAll(async () => {
  await seedRoles();
  await cleanup();

  const reg = await call('POST', '/api/v1/auth/register', {
    body: { email: ownerEmail, password: 'password123', displayName: 'Notif Owner' },
  });
  token = reg.body.result.accessToken;
  householdId = decodeJwt(token).householdId as string;
  const [member] = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.isOwner, true)));
  memberId = member!.id;
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM notifications WHERE recipient_member_id = ${memberId}`);
});

afterAll(async () => {
  await cleanup();
});

describe('notify', () => {
  it('writes a row and emits notification.new to the recipient WS channel', async () => {
    // In-process WS: await the handshake so the user-channel subscription completes, then
    // notify() broadcasts synchronously (test-mode bus) to the subscribed fake socket.
    // biome-ignore lint/suspicious/noExplicitAny: test reads arbitrary WS JSON.
    const received: any[] = [];
    const ws: SocketLike = {
      id: 'notif-ws-1',
      send: (d) => received.push(JSON.parse(d)),
      close: () => {},
    };
    openConnection(ws);
    await handleWsMessage(ws, JSON.stringify({ type: 'auth', token }));
    expect(received.some((m) => m.type === 'auth_ok')).toBe(true);

    const row = await notify({
      householdId,
      recipientMemberId: memberId,
      type: NotificationTypes.taskAssigned,
      title: 'A task was assigned',
      body: 'Take out the trash',
    });
    expect(row.id).toBeTruthy();
    expect(row.isRead).toBe(false);

    expect(received.some((m) => m.type === RealtimeEvents.notificationNew)).toBe(true);
    closeConnection(ws);
  });
});

describe('GET /notifications', () => {
  it('lists newest-first with unread before read, and supports paging', async () => {
    const a = await notify({
      householdId,
      recipientMemberId: memberId,
      type: NotificationTypes.taskDue,
      title: 'A',
    });
    await Bun.sleep(5);
    const b = await notify({
      householdId,
      recipientMemberId: memberId,
      type: NotificationTypes.taskDue,
      title: 'B',
    });
    await Bun.sleep(5);
    await notify({
      householdId,
      recipientMemberId: memberId,
      type: NotificationTypes.taskDue,
      title: 'C',
    });

    // Mark the newest (C is newest; mark A read so it sinks below unread).
    await call('POST', '/api/v1/notifications/read', { token, body: { ids: [a.id] } });

    const page1 = await call('GET', '/api/v1/notifications', { token });
    expect(page1.status).toBe(200);
    const items = page1.body.result.notifications as Array<{ title: string; isRead: boolean }>;
    expect(items.length).toBe(3);
    // Unread first (B, C newest-first among unread) then the read one (A) last.
    expect(items[0]!.isRead).toBe(false);
    expect(items[2]!.title).toBe('A');
    expect(page1.body.result.unreadCount).toBe(2);

    const filtered = await call('GET', '/api/v1/notifications?isRead=false', { token });
    expect((filtered.body.result.notifications as unknown[]).length).toBe(2);

    const page2 = await call('GET', '/api/v1/notifications?page=2', { token });
    expect((page2.body.result.notifications as unknown[]).length).toBe(0);

    expect(b.id).toBeTruthy();
  });
});

describe('POST /notifications/read', () => {
  it('marks the given ids read and is idempotent', async () => {
    const a = await notify({
      householdId,
      recipientMemberId: memberId,
      type: NotificationTypes.rewardEarned,
      title: 'X',
    });

    const first = await call('POST', '/api/v1/notifications/read', {
      token,
      body: { ids: [a.id] },
    });
    expect(first.body.result.updated).toBe(1);

    // Re-marking is a no-op (already read), not an error.
    const second = await call('POST', '/api/v1/notifications/read', {
      token,
      body: { ids: [a.id] },
    });
    expect(second.body.result.updated).toBe(0);

    const list = await call('GET', '/api/v1/notifications', { token });
    const item = (
      list.body.result.notifications as Array<{
        id: string;
        isRead: boolean;
        readAt: string | null;
      }>
    )[0];
    expect(item!.isRead).toBe(true);
    expect(item!.readAt).not.toBeNull();
  });
});
