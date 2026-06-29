// Inter-instance event bus over Redis pub/sub. `broadcast` publishes to a single Redis
// channel; every API instance runs a dedicated subscriber that relays incoming events to
// its locally-connected WebSocket subscribers (realtime/ws.ts). This gives horizontal
// fan-out: a broadcast from instance A reaches a client connected to instance B.

import { Redis } from 'ioredis';
import { config } from '../config.ts';
import { logger } from '../observability/logger.ts';
import { redis } from '../redis/client.ts';
import type { RealtimeEvent } from './events.ts';

const BUS_CHANNEL = 'gopher:bus';

type LocalHandler = (channel: string, event: RealtimeEvent) => void;
let localHandler: LocalHandler | null = null;

/** Register the local delivery handler (set by realtime/ws.ts). */
export function onBusMessage(handler: LocalHandler): void {
  localHandler = handler;
}

let subscriber: Redis | null = null;

/** Start the dedicated Redis subscriber that relays bus messages to local sockets. In test
 *  mode there is no separate subscriber — broadcast() delivers in-process (see below). */
export function startBus(): void {
  if (config.nodeEnv === 'test' || subscriber) return;
  subscriber = new Redis(config.redisUrl);
  subscriber.on('error', (err) => logger.warn('bus subscriber error', { error: err.message }));
  subscriber.subscribe(BUS_CHANNEL).catch((err) => {
    logger.error('bus subscribe failed', { error: String(err) });
  });
  subscriber.on('message', (_channel, payload) => {
    try {
      const { channel, event } = JSON.parse(payload) as { channel: string; event: RealtimeEvent };
      localHandler?.(channel, event);
    } catch {
      // Ignore malformed bus payloads.
    }
  });
}

export async function stopBus(): Promise<void> {
  if (subscriber) {
    await subscriber.quit().catch(() => {});
    subscriber = null;
  }
}

/** Single emission point: publish an event to a channel for cross-instance fan-out. In test
 *  mode (no Redis pub/sub) it delivers directly to the local handler, deterministically. */
export async function broadcast(channel: string, event: RealtimeEvent): Promise<void> {
  if (config.nodeEnv === 'test') {
    localHandler?.(channel, event);
    return;
  }
  await redis.publish(BUS_CHANNEL, JSON.stringify({ channel, event }));
}
