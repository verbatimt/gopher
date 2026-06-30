// Integration tests for the Inventory API (EP-0048). Runs on the embedded DB. Covers atomic
// adjust + running-total logging, the low-stock filter, auto-add-to-grocery on threshold
// crossing (and not when disabled), over-consume rejection, soft-delete, and access control.
// Distinct x-forwarded-for for the shared rate-limit bucket.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';

const PORT = 3208;
const FWD = '203.0.113.48';
const app = createApp();

const ownerEmail = 'inv-owner@x.test';
const kidEmail = 'inv-kid@x.test';
let ownerToken = '';
let kidToken = '';
let householdId = '';

function decodeJwt(tok: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(tok.split('.')[1] ?? '', 'base64url').toString());
}

async function call(method: string, path: string, opts: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': FWD };
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
  for (const email of [ownerEmail, kidEmail]) {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    for (const u of rows) {
      const hh = sql`SELECT id FROM households WHERE created_by = ${u.id}`;
      const items = sql`SELECT id FROM inventory_items WHERE household_id IN (${hh})`;
      const gl = sql`SELECT id FROM grocery_lists WHERE household_id IN (${hh})`;
      await db.execute(sql`DELETE FROM inventory_adjustments WHERE item_id IN (${items})`);
      await db.execute(sql`DELETE FROM inventory_items WHERE household_id IN (${hh})`);
      await db.execute(sql`DELETE FROM grocery_items WHERE grocery_list_id IN (${gl})`);
      await db.execute(sql`DELETE FROM grocery_lists WHERE household_id IN (${hh})`);
      await db.execute(sql`DELETE FROM notifications WHERE household_id IN (${hh})`);
      await db.execute(sql`DELETE FROM time_windows WHERE household_id IN (${hh})`);
      await db.execute(sql`DELETE FROM household_invites WHERE household_id IN (${hh})`);
      await db.execute(sql`DELETE FROM user_sessions WHERE user_id = ${u.id}`);
      await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${u.id}`);
      await db.execute(
        sql`DELETE FROM household_members WHERE household_id IN (${hh}) OR user_id = ${u.id}`,
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
    body: { email: ownerEmail, password: 'password123', displayName: 'Owner' },
  });
  ownerToken = reg.body.result.accessToken;
  householdId = decodeJwt(ownerToken).householdId as string;

  const invite = await call('POST', `/api/v1/households/${householdId}/invites`, {
    token: ownerToken,
    body: { email: kidEmail, role: 'supervised_user' },
  });
  const accept = await call('POST', '/api/v1/auth/accept-invite', {
    body: { token: invite.body.result.token, password: 'password123', displayName: 'Kid' },
  });
  kidToken = accept.body.result.accessToken;
});

afterAll(async () => {
  await cleanup();
});

const H = () => `/api/v1/households/${householdId}/inventory`;

async function grocery() {
  const g = await call('GET', `/api/v1/households/${householdId}/grocery`, { token: ownerToken });
  return (g.body.result.items as Array<{ name: string }>).map((i) => i.name.toLowerCase());
}

describe('adjust + auto-grocery', () => {
  it('consume crossing the threshold logs a row and auto-adds to grocery', async () => {
    const created = await call('POST', H(), {
      token: ownerToken,
      body: { name: 'Paper Towels', unit: 'roll', quantity: 10, lowThreshold: 3 },
    });
    expect(created.status).toBe(201);
    const id = created.body.result.item.id;

    const adj = await call('POST', `${H()}/${id}/adjust`, {
      token: ownerToken,
      body: { delta: -8, reason: 'consume' },
    });
    expect(adj.status).toBe(201);
    expect(Number(adj.body.result.item.quantity)).toBe(2);
    expect(adj.body.result.item.isLowStock).toBe(true);
    expect(adj.body.result.groceryAdded).toBe(true);
    expect(Number(adj.body.result.adjustment.resultingQuantity)).toBe(2);

    expect(await grocery()).toContain('paper towels');
  });

  it('does not auto-add when auto_add_to_grocery is disabled', async () => {
    const created = await call('POST', H(), {
      token: ownerToken,
      body: {
        name: 'Dish Soap',
        unit: 'ea',
        quantity: 5,
        lowThreshold: 2,
        autoAddToGrocery: false,
      },
    });
    const id = created.body.result.item.id;
    const adj = await call('POST', `${H()}/${id}/adjust`, {
      token: ownerToken,
      body: { delta: -4, reason: 'consume' },
    });
    expect(adj.body.result.groceryAdded).toBe(false);
    expect(await grocery()).not.toContain('dish soap');

    // still low-stock listed
    const low = await call('GET', `${H()}/low-stock`, { token: ownerToken });
    const names = (low.body.result.items as Array<{ name: string }>).map((i) => i.name);
    expect(names).toContain('Dish Soap');
  });

  it('restock raises quantity; history shows running totals newest-first', async () => {
    const created = await call('POST', H(), {
      token: ownerToken,
      body: { name: 'Coffee', unit: 'g', quantity: 100, lowThreshold: 50 },
    });
    const id = created.body.result.item.id;
    await call('POST', `${H()}/${id}/adjust`, {
      token: ownerToken,
      body: { delta: -60, reason: 'consume' },
    });
    const restock = await call('POST', `${H()}/${id}/adjust`, {
      token: ownerToken,
      body: { delta: 80, reason: 'restock' },
    });
    expect(Number(restock.body.result.item.quantity)).toBe(120);

    const hist = await call('GET', `${H()}/${id}/adjustments`, { token: ownerToken });
    const rows = hist.body.result.adjustments as Array<{
      reason: string;
      resultingQuantity: string;
    }>;
    expect(rows.length).toBe(2);
    expect(rows[0]!.reason).toBe('restock'); // newest first
    expect(Number(rows[0]!.resultingQuantity)).toBe(120);
    expect(Number(rows[1]!.resultingQuantity)).toBe(40);
  });

  it('rejects over-consumption', async () => {
    const created = await call('POST', H(), {
      token: ownerToken,
      body: { name: 'Eggs', unit: 'ea', quantity: 6 },
    });
    const id = created.body.result.item.id;
    const adj = await call('POST', `${H()}/${id}/adjust`, {
      token: ownerToken,
      body: { delta: -10, reason: 'consume' },
    });
    expect(adj.status).toBe(422);
  });
});

describe('soft-delete + access control', () => {
  it('soft-deleted item leaves lists but resolves by id', async () => {
    const created = await call('POST', H(), { token: ownerToken, body: { name: 'TempItem' } });
    const id = created.body.result.item.id;
    await call('DELETE', `${H()}/${id}`, { token: ownerToken });
    const list = await call('GET', `${H()}?search=TempItem`, { token: ownerToken });
    expect((list.body.result.items as unknown[]).length).toBe(0);
    const byId = await call('GET', `${H()}/${id}`, { token: ownerToken });
    expect(byId.status).toBe(200);
    expect(byId.body.result.item.isActive).toBe(false);
  });

  it('a supervised user cannot create but can adjust + read', async () => {
    const created = await call('POST', H(), {
      token: ownerToken,
      body: { name: 'Shared Snacks', unit: 'ea', quantity: 10 },
    });
    const id = created.body.result.item.id;

    const kidCreate = await call('POST', H(), { token: kidToken, body: { name: 'KidItem' } });
    expect(kidCreate.status).toBe(403);

    const kidRead = await call('GET', H(), { token: kidToken });
    expect(kidRead.status).toBe(200);

    const kidAdjust = await call('POST', `${H()}/${id}/adjust`, {
      token: kidToken,
      body: { delta: -1, reason: 'consume' },
    });
    expect(kidAdjust.status).toBe(201);
    expect(Number(kidAdjust.body.result.item.quantity)).toBe(9);
  });
});
