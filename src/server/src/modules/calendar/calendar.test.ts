// Integration tests for the calendar & events API (EP-0020). Runs fully in-process on the embedded DB (pglite + ioredis-mock).

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';
import {
  closeConnection,
  handleWsMessage,
  openConnection,
  type SocketLike,
} from '../../realtime/ws.ts';

const PORT = 3197;
const app = createApp();

const ownerEmail = 'calendar-owner@x.test';
const inviteeEmail = 'calendar-kid@x.test';
let ownerToken = '';
let supervisedToken = '';
let householdId = '';
let supervisedMemberId = '';

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
  for (const email of [ownerEmail, inviteeEmail]) {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    for (const u of rows) {
      await db.execute(
        sql`DELETE FROM occurrence_overrides WHERE scheduled_item_id IN (SELECT id FROM scheduled_items WHERE household_id IN (SELECT id FROM households WHERE created_by = ${u.id}))`,
      );
      await db.execute(
        sql`DELETE FROM events WHERE scheduled_item_id IN (SELECT id FROM scheduled_items WHERE household_id IN (SELECT id FROM households WHERE created_by = ${u.id}))`,
      );
      await db.execute(
        sql`DELETE FROM scheduled_items WHERE household_id IN (SELECT id FROM households WHERE created_by = ${u.id})`,
      );
      await db.execute(
        sql`DELETE FROM time_windows WHERE household_id IN (SELECT id FROM households WHERE created_by = ${u.id})`,
      );
      await db.execute(
        sql`DELETE FROM household_invites WHERE household_id IN (SELECT id FROM households WHERE created_by = ${u.id})`,
      );
      await db.execute(sql`DELETE FROM user_sessions WHERE user_id = ${u.id}`);
      await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${u.id}`);
      await db.execute(
        sql`DELETE FROM household_members WHERE household_id IN (SELECT id FROM households WHERE created_by = ${u.id}) OR user_id = ${u.id}`,
      );
      await db.execute(sql`DELETE FROM households WHERE created_by = ${u.id}`);
      await db.execute(sql`DELETE FROM audit_logs WHERE actor_user_id = ${u.id}`);
      await db.execute(sql`DELETE FROM users WHERE id = ${u.id}`);
    }
  }
}

beforeAll(async () => {
  await seedRoles();
  await cleanup();

  const reg = await call('POST', '/api/v1/auth/register', {
    body: { email: ownerEmail, password: 'password123', displayName: 'Cal Owner' },
  });
  ownerToken = reg.body.result.accessToken;
  householdId = decodeJwt(ownerToken).householdId as string;

  // Invite a supervised member and accept.
  const invite = await call('POST', `/api/v1/households/${householdId}/invites`, {
    token: ownerToken,
    body: { email: inviteeEmail, role: 'supervised_user' },
  });
  const accept = await call('POST', '/api/v1/auth/accept-invite', {
    body: { token: invite.body.result.token, password: 'password123', displayName: 'Kid' },
  });
  supervisedToken = accept.body.result.accessToken;
  const members = await call('GET', `/api/v1/households/${householdId}/members`, {
    token: ownerToken,
  });
  supervisedMemberId = members.body.result.members.find(
    (m: { displayName: string }) => m.displayName === 'Kid',
  ).id;
});

afterAll(async () => {
  await cleanup();
});

describe('event CRUD + calendar.changed', () => {
  it('creates an event, broadcasts calendar.changed, and reads/updates it', async () => {
    // In-process WS: drive the handler directly with a fake socket (no TCP listener). The
    // test-mode bus delivers broadcasts synchronously to subscribed sockets.
    // biome-ignore lint/suspicious/noExplicitAny: test reads arbitrary WS JSON.
    const received: any[] = [];
    const ws: SocketLike = {
      id: 'calendar-ws-1',
      send: (d) => received.push(JSON.parse(d)),
      close: () => {},
    };
    openConnection(ws);
    await handleWsMessage(ws, JSON.stringify({ type: 'auth', token: ownerToken }));
    expect(received.some((m) => m.type === 'auth_ok')).toBe(true);

    const created = await call('POST', `/api/v1/households/${householdId}/events`, {
      token: ownerToken,
      body: { type: 'event', title: 'Picnic', startsAt: '2024-06-03T10:00:00.000Z' },
    });
    expect(created.status).toBe(201);
    const eventId = created.body.result.event.id;

    expect(received.some((m) => m.type === 'calendar.changed')).toBe(true);
    closeConnection(ws);

    const read = await call('GET', `/api/v1/households/${householdId}/events/${eventId}`, {
      token: ownerToken,
    });
    expect(read.body.result.event.title).toBe('Picnic');

    const patched = await call('PATCH', `/api/v1/households/${householdId}/events/${eventId}`, {
      token: ownerToken,
      body: { title: 'Big Picnic' },
    });
    expect(patched.body.result.event.title).toBe('Big Picnic');
  });
});

describe('calendar range expansion', () => {
  it('expands a weekly event across a month', async () => {
    await call('POST', `/api/v1/households/${householdId}/events`, {
      token: ownerToken,
      body: {
        type: 'event',
        title: 'Weekly standup',
        startsAt: '2024-07-01T09:00:00.000Z', // a Monday
        recurrence: { frequency: 'weekly' },
      },
    });
    const cal = await call(
      'GET',
      `/api/v1/households/${householdId}/calendar?from=2024-07-01T00:00:00.000Z&to=2024-07-31T23:59:59.000Z`,
      { token: ownerToken },
    );
    const weekly = (cal.body.result.occurrences as Array<{ title: string }>).filter(
      (o) => o.title === 'Weekly standup',
    );
    expect(weekly.length).toBe(5); // Jul 1, 8, 15, 22, 29
  });

  it('rejects a missing range with 400', async () => {
    const res = await call('GET', `/api/v1/households/${householdId}/calendar`, {
      token: ownerToken,
    });
    expect(res.status).toBe(400);
  });
});

describe('delete scopes', () => {
  async function weeklyEvent(title: string): Promise<string> {
    const created = await call('POST', `/api/v1/households/${householdId}/events`, {
      token: ownerToken,
      body: {
        type: 'event',
        title,
        startsAt: '2024-08-05T09:00:00.000Z',
        recurrence: { frequency: 'weekly' },
      },
    });
    return created.body.result.event.id;
  }
  async function occurrenceDates(title: string): Promise<string[]> {
    const cal = await call(
      'GET',
      `/api/v1/households/${householdId}/calendar?from=2024-08-01T00:00:00.000Z&to=2024-08-31T23:59:59.000Z`,
      { token: ownerToken },
    );
    return (cal.body.result.occurrences as Array<{ title: string; date: string }>)
      .filter((o) => o.title === title)
      .map((o) => o.date);
  }

  it('scope=this drops a single occurrence', async () => {
    const id = await weeklyEvent('ThisScope');
    await call(
      'DELETE',
      `/api/v1/households/${householdId}/events/${id}?scope=this&date=2024-08-12`,
      { token: ownerToken },
    );
    const dates = await occurrenceDates('ThisScope');
    expect(dates).not.toContain('2024-08-12');
    expect(dates).toContain('2024-08-05');
  });

  it('scope=future truncates later occurrences', async () => {
    const id = await weeklyEvent('FutureScope');
    await call(
      'DELETE',
      `/api/v1/households/${householdId}/events/${id}?scope=future&date=2024-08-19`,
      { token: ownerToken },
    );
    const dates = await occurrenceDates('FutureScope');
    expect(dates).toContain('2024-08-05');
    expect(dates).toContain('2024-08-12');
    expect(dates).not.toContain('2024-08-19');
    expect(dates).not.toContain('2024-08-26');
  });

  it('scope=all hides the whole series', async () => {
    const id = await weeklyEvent('AllScope');
    await call('DELETE', `/api/v1/households/${householdId}/events/${id}?scope=all`, {
      token: ownerToken,
    });
    const dates = await occurrenceDates('AllScope');
    expect(dates.length).toBe(0);
  });
});

describe('visibility', () => {
  it('a SupervisedUser sees only items assigned to them', async () => {
    await call('POST', `/api/v1/households/${householdId}/events`, {
      token: ownerToken,
      body: {
        type: 'event',
        title: 'KidEvent',
        startsAt: '2024-09-02T09:00:00.000Z',
        assigneeMemberId: supervisedMemberId,
      },
    });
    await call('POST', `/api/v1/households/${householdId}/events`, {
      token: ownerToken,
      body: {
        type: 'event',
        title: 'OwnerOnly',
        startsAt: '2024-09-03T09:00:00.000Z',
        visibility: 'personal',
      },
    });

    const range = '?from=2024-09-01T00:00:00.000Z&to=2024-09-30T23:59:59.000Z';
    const kidView = await call('GET', `/api/v1/households/${householdId}/calendar${range}`, {
      token: supervisedToken,
    });
    const kidTitles = (kidView.body.result.occurrences as Array<{ title: string }>).map(
      (o) => o.title,
    );
    expect(kidTitles).toContain('KidEvent');
    expect(kidTitles).not.toContain('OwnerOnly');

    const ownerView = await call('GET', `/api/v1/households/${householdId}/calendar${range}`, {
      token: ownerToken,
    });
    const ownerTitles = (ownerView.body.result.occurrences as Array<{ title: string }>).map(
      (o) => o.title,
    );
    expect(ownerTitles).toContain('KidEvent');
    expect(ownerTitles).toContain('OwnerOnly');
  });
});
