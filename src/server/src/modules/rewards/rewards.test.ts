// Integration tests for the Rewards API (EP-0027). Runs fully in-process on the embedded DB
// (pglite + ioredis-mock). Covers adjust (mandatory notes + value-change), redemption
// (insufficient → 409, approve debits + cap, reject unchanged), cooldown, and reward-rule
// soft-deactivation preserving the rule id on referencing tasks.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import {
  rewardRules,
  rewardStoreItems,
  tasks,
  users,
  valueChangeHistory,
} from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';

const PORT = 3199;
const app = createApp();

const ownerEmail = 'rewards-owner@x.test';
const kidEmail = 'rewards-kid@x.test';
let ownerToken = '';
let kidToken = '';
let householdId = '';
let kidMemberId = '';

function decodeJwt(tok: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(tok.split('.')[1] ?? '', 'base64url').toString());
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
  for (const email of [ownerEmail, kidEmail]) {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    for (const u of rows) {
      const hh = sql`SELECT id FROM households WHERE created_by = ${u.id}`;
      await db.execute(sql`DELETE FROM reward_transactions WHERE household_id IN (${hh})`);
      await db.execute(sql`DELETE FROM rewards WHERE household_id IN (${hh})`);
      await db.execute(sql`DELETE FROM reward_store_items WHERE household_id IN (${hh})`);
      await db.execute(sql`DELETE FROM reward_rules WHERE household_id IN (${hh})`);
      await db.execute(
        sql`DELETE FROM tasks WHERE scheduled_item_id IN (SELECT id FROM scheduled_items WHERE household_id IN (${hh}))`,
      );
      await db.execute(sql`DELETE FROM scheduled_items WHERE household_id IN (${hh})`);
      await db.execute(sql`DELETE FROM value_change_history WHERE household_id IN (${hh})`);
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

  const members = await call('GET', `/api/v1/households/${householdId}/members`, {
    token: ownerToken,
  });
  kidMemberId = (members.body.result.members as Array<{ id: string; displayName: string }>).find(
    (m) => m.displayName === 'Kid',
  )!.id;
});

afterAll(async () => {
  await cleanup();
});

const rewardsBase = () => `/api/v1/households/${householdId}`;

describe('rewards lifecycle', () => {
  let item40 = '';

  it('redeeming with a zero balance returns 409', async () => {
    const created = await call('POST', `${rewardsBase()}/reward-store`, {
      token: ownerToken,
      body: { name: 'Movie night', pointCost: 40 },
    });
    item40 = created.body.result.item.id;
    const res = await call('POST', `${rewardsBase()}/reward-store/${item40}/redeem`, {
      token: kidToken,
    });
    expect(res.status).toBe(409);
  });

  it('adjust requires notes and records a balance value-change', async () => {
    const noNotes = await call('POST', `${rewardsBase()}/rewards/${kidMemberId}/adjust`, {
      token: ownerToken,
      body: { amount: 1000 },
    });
    expect(noNotes.status).toBe(422);

    const withNotes = await call('POST', `${rewardsBase()}/rewards/${kidMemberId}/adjust`, {
      token: ownerToken,
      body: { amount: 1000, notes: 'Birthday bonus' },
    });
    expect(withNotes.status).toBe(201);

    const balance = await call('GET', `${rewardsBase()}/rewards/${kidMemberId}`, {
      token: ownerToken,
    });
    expect(balance.body.result.rewards.balance).toBe(1000);

    const changes = await db
      .select()
      .from(valueChangeHistory)
      .where(
        and(
          eq(valueChangeHistory.entityId, kidMemberId),
          eq(valueChangeHistory.fieldName, 'balance'),
        ),
      );
    expect(changes.some((c) => c.newValue === '1000')).toBe(true);
  });

  it('redeem creates a pending tx; approve debits + increments count; reject leaves balance', async () => {
    const redeem = await call('POST', `${rewardsBase()}/reward-store/${item40}/redeem`, {
      token: kidToken,
    });
    expect(redeem.status).toBe(201);
    expect(redeem.body.result.transaction.status).toBe('pending');
    const txId = redeem.body.result.transaction.id;

    const approve = await call('PATCH', `${rewardsBase()}/reward-transactions/${txId}`, {
      token: ownerToken,
      body: { decision: 'approve' },
    });
    expect(approve.body.result.transaction.status).toBe('approved');

    const afterApprove = await call('GET', `${rewardsBase()}/rewards/${kidMemberId}`, {
      token: ownerToken,
    });
    expect(afterApprove.body.result.rewards.balance).toBe(960);
    expect(afterApprove.body.result.rewards.lifetimeRedeemed).toBe(40);

    const [item] = await db.select().from(rewardStoreItems).where(eq(rewardStoreItems.id, item40));
    expect(item!.redemptionCount).toBe(1);

    // A second redemption that gets rejected must not change the balance.
    const redeem2 = await call('POST', `${rewardsBase()}/reward-store/${item40}/redeem`, {
      token: kidToken,
    });
    const tx2 = redeem2.body.result.transaction.id;
    await call('PATCH', `${rewardsBase()}/reward-transactions/${tx2}`, {
      token: ownerToken,
      body: { decision: 'reject' },
    });
    const afterReject = await call('GET', `${rewardsBase()}/rewards/${kidMemberId}`, {
      token: ownerToken,
    });
    expect(afterReject.body.result.rewards.balance).toBe(960);
  });

  it('enforces the redemption cap', async () => {
    const created = await call('POST', `${rewardsBase()}/reward-store`, {
      token: ownerToken,
      body: { name: 'Capped treat', pointCost: 10, redemptionCap: 1 },
    });
    const itemId = created.body.result.item.id;

    const redeem = await call('POST', `${rewardsBase()}/reward-store/${itemId}/redeem`, {
      token: kidToken,
    });
    await call(
      'PATCH',
      `${rewardsBase()}/reward-transactions/${redeem.body.result.transaction.id}`,
      {
        token: ownerToken,
        body: { decision: 'approve' },
      },
    );

    const second = await call('POST', `${rewardsBase()}/reward-store/${itemId}/redeem`, {
      token: kidToken,
    });
    expect(second.status).toBe(409);
  });

  it('enforces the redemption cooldown', async () => {
    const created = await call('POST', `${rewardsBase()}/reward-store`, {
      token: ownerToken,
      body: { name: 'Snack', pointCost: 5, cooldownMinutes: 60 },
    });
    const itemId = created.body.result.item.id;

    const first = await call('POST', `${rewardsBase()}/reward-store/${itemId}/redeem`, {
      token: kidToken,
    });
    expect(first.status).toBe(201);
    const second = await call('POST', `${rewardsBase()}/reward-store/${itemId}/redeem`, {
      token: kidToken,
    });
    expect(second.status).toBe(409);
  });

  it('soft-deactivating a rule preserves its id on referencing tasks', async () => {
    const rule = await call('POST', `${rewardsBase()}/reward-rules`, {
      token: ownerToken,
      body: { name: 'Chore done', points: 10 },
    });
    const ruleId = rule.body.result.rule.id;

    const task = await call('POST', `${rewardsBase()}/tasks`, {
      token: ownerToken,
      body: { title: 'Sweep', startsAt: '2024-06-01T00:00:00.000Z' },
    });
    const taskId = task.body.result.task.id;
    await db.update(tasks).set({ rewardRuleId: ruleId }).where(eq(tasks.id, taskId));

    const del = await call('DELETE', `${rewardsBase()}/reward-rules/${ruleId}`, {
      token: ownerToken,
    });
    expect(del.status).toBe(200);

    const [rememberedRule] = await db.select().from(rewardRules).where(eq(rewardRules.id, ruleId));
    expect(rememberedRule!.isActive).toBe(false); // soft-deactivated, still resolvable

    const [linkedTask] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(linkedTask!.rewardRuleId).toBe(ruleId); // id preserved on the referencing task
  });
});
