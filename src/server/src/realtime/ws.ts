// Authenticated WebSocket endpoint (/ws). Protocol (Gopher's): handshake-first — the first
// frame must be {type:'auth', token}; an invalid/missing auth frame closes the socket with
// 4001. On success the socket auto-subscribes to household:{householdId} and
// user:{memberId} and gets ping/pong keepalive. Delivery comes from the Redis bus.

import { and, eq } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { jwtVerify } from 'jose';
import { config } from '../config.ts';
import { db } from '../db/index.ts';
import { householdMembers } from '../db/schema/index.ts';
import { logger } from '../observability/logger.ts';
import { wsClosed, wsOpened } from '../observability/metrics.ts';
import { onBusMessage } from './bus.ts';
import { householdChannel, type RealtimeEvent, userChannel } from './events.ts';

export interface SocketLike {
  id: string;
  send: (data: string) => unknown;
  close: (code?: number, reason?: string) => unknown;
}

interface Connection {
  ws: SocketLike;
  authed: boolean;
  channels: Set<string>;
}

// Local connection registry (this instance). channelSubs maps a channel to the connection
// ids subscribed to it on this instance.
const connections = new Map<string, Connection>();
const channelSubs = new Map<string, Set<string>>();

function subscribe(connId: string, channel: string): void {
  const conn = connections.get(connId);
  if (!conn) return;
  conn.channels.add(channel);
  let set = channelSubs.get(channel);
  if (!set) {
    set = new Set();
    channelSubs.set(channel, set);
  }
  set.add(connId);
}

function removeConnection(connId: string): void {
  const conn = connections.get(connId);
  if (!conn) return;
  for (const channel of conn.channels) {
    const set = channelSubs.get(channel);
    set?.delete(connId);
    if (set && set.size === 0) channelSubs.delete(channel);
  }
  connections.delete(connId);
}

/** Deliver a bus event to local sockets subscribed to the channel. */
function deliver(channel: string, event: RealtimeEvent): void {
  const subs = channelSubs.get(channel);
  if (!subs) return;
  const data = JSON.stringify(event);
  for (const connId of subs) {
    connections.get(connId)?.ws.send(data);
  }
}

onBusMessage(deliver);

const jwtKey = new TextEncoder().encode(config.jwtSecret);

async function resolveMemberId(userId: string, householdId: string): Promise<string | null> {
  const [member] = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.userId, userId),
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.isActive, true),
      ),
    )
    .limit(1);
  return member?.id ?? null;
}

function parse(message: unknown): Record<string, unknown> | null {
  try {
    if (typeof message === 'string') return JSON.parse(message) as Record<string, unknown>;
    if (message && typeof message === 'object') return message as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

/** Register a newly-opened socket (unauthenticated). */
export function openConnection(ws: SocketLike): void {
  connections.set(ws.id, { ws, authed: false, channels: new Set() });
  wsOpened();
}

/** Handle one inbound frame: handshake-first auth, then ping/pong. Exported so the protocol
 *  is testable in-process with a fake socket — no TCP listener required. */
export async function handleWsMessage(ws: SocketLike, rawMessage: unknown): Promise<void> {
  const conn = connections.get(ws.id);
  if (!conn) return;
  const msg = parse(rawMessage);

  if (!conn.authed) {
    const token = msg?.type === 'auth' ? msg.token : undefined;
    if (typeof token !== 'string') {
      ws.close(4001, 'unauthenticated');
      return;
    }
    let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
    try {
      ({ payload } = await jwtVerify(token, jwtKey));
    } catch {
      ws.close(4001, 'invalid token');
      return;
    }
    const userId = typeof payload.sub === 'string' ? payload.sub : '';
    const householdId = typeof payload.householdId === 'string' ? payload.householdId : '';
    conn.authed = true;
    if (householdId) subscribe(ws.id, householdChannel(householdId));
    // Acknowledge immediately; the user-channel subscription is best-effort and must not
    // block the handshake.
    ws.send(JSON.stringify({ type: 'auth_ok' }));
    if (userId && householdId) {
      const memberId = await resolveMemberId(userId, householdId).catch(() => null);
      if (memberId && connections.has(ws.id)) subscribe(ws.id, userChannel(memberId));
    }
    return;
  }

  if (msg?.type === 'ping') {
    ws.send(JSON.stringify({ type: 'pong' }));
  }
}

/** Tear down a closed socket and its channel subscriptions. */
export function closeConnection(ws: Pick<SocketLike, 'id'>): void {
  removeConnection(ws.id);
  wsClosed();
}

export const wsPlugin = new Elysia().ws('/ws', {
  open(ws) {
    openConnection(ws as SocketLike);
  },
  async message(ws, rawMessage) {
    await handleWsMessage(ws as SocketLike, rawMessage);
  },
  close(ws) {
    closeConnection(ws);
  },
});

export function activeConnectionCount(): number {
  return connections.size;
}

logger.debug('ws plugin initialized');
