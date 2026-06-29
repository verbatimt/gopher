// Tests for the WebSocket infrastructure. The protocol is exercised in-process with fake
// sockets via the exported handlers (openConnection/handleWsMessage/closeConnection) — no TCP
// listener. In test mode the bus delivers broadcasts synchronously to subscribed sockets, so
// fan-out is observable without Redis.

import { describe, expect, it } from 'bun:test';
import { SignJWT } from 'jose';
import { config } from '../config.ts';
import { broadcast } from './bus.ts';
import { householdChannel, RealtimeEvents } from './events.ts';
import { closeConnection, handleWsMessage, openConnection, type SocketLike } from './ws.ts';

// biome-ignore lint/suspicious/noExplicitAny: test reads arbitrary WS JSON.
type Msg = Record<string, any>;

function makeToken(householdId: string): Promise<string> {
  return new SignJWT({ householdId, roles: 'supervising_user' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('00000000-0000-4000-8000-0000000000ff')
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(config.jwtSecret));
}

function fakeSocket(id: string) {
  const received: Msg[] = [];
  let closeCode = 0;
  const ws: SocketLike = {
    id,
    send: (d) => received.push(JSON.parse(d)),
    close: (code) => {
      closeCode = code ?? 0;
    },
  };
  return { ws, received, getCloseCode: () => closeCode };
}

describe('websocket handshake', () => {
  it('closes a socket that does not authenticate first with 4001', async () => {
    const { ws, getCloseCode } = fakeSocket('ws-noauth');
    openConnection(ws);
    await handleWsMessage(ws, JSON.stringify({ type: 'hello' }));
    expect(getCloseCode()).toBe(4001);
  });

  it('returns auth_ok for a valid token', async () => {
    const { ws, received } = fakeSocket('ws-authok');
    openConnection(ws);
    await handleWsMessage(
      ws,
      JSON.stringify({ type: 'auth', token: await makeToken('hh-ws-test') }),
    );
    expect(received.some((m) => m.type === 'auth_ok')).toBe(true);
    closeConnection(ws);
  });
});

describe('websocket delivery', () => {
  it('delivers a household broadcast to the subscribed socket', async () => {
    const { ws, received } = fakeSocket('ws-deliver');
    openConnection(ws);
    await handleWsMessage(
      ws,
      JSON.stringify({ type: 'auth', token: await makeToken('hh-ws-test') }),
    );

    await broadcast(householdChannel('hh-ws-test'), {
      type: RealtimeEvents.notificationNew,
      payload: { n: 1 },
    });
    const event = received.find((m) => m.type === RealtimeEvents.notificationNew);
    expect(event?.payload.n).toBe(1);
    closeConnection(ws);
  });

  it('does not deliver to a socket subscribed to a different household', async () => {
    const { ws, received } = fakeSocket('ws-other');
    openConnection(ws);
    await handleWsMessage(ws, JSON.stringify({ type: 'auth', token: await makeToken('hh-other') }));

    await broadcast(householdChannel('hh-ws-test'), {
      type: RealtimeEvents.notificationNew,
      payload: { n: 2 },
    });
    expect(received.some((m) => m.type === RealtimeEvents.notificationNew)).toBe(false);
    closeConnection(ws);
  });

  it('responds to ping with pong', async () => {
    const { ws, received } = fakeSocket('ws-ping');
    openConnection(ws);
    await handleWsMessage(
      ws,
      JSON.stringify({ type: 'auth', token: await makeToken('hh-ws-test') }),
    );
    await handleWsMessage(ws, JSON.stringify({ type: 'ping' }));
    expect(received.some((m) => m.type === 'pong')).toBe(true);
    closeConnection(ws);
  });
});
