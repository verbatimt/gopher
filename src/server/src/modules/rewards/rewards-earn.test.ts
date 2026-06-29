// Integration tests for the task-completion earn hook + allowances (EP-0028). Runs in-process
// on the embedded DB. Covers: atomic earn on completion, no double-credit on re-complete,
// verified-completion gating (pending earn finalized on approval), and allowance grant cadence
// + idempotency.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { notifications, tasks, users, valueChangeHistory } from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';
import { grantAllowances } from '../../workers/allowance-granter.ts';
import { NotificationTypes } from '../notifications/types.ts';

const PORT = 3200;
const app = createApp();

const ownerEmail = 'earn-owner@x.test';
const kidEmail = 'earn-kid@x.test';
let ownerToken = '';
let kidToken = '';
let householdId = '';
let ownerMemberId = '';
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
      await db.execute(sql`DELETE FROM reward_allowances WHERE household_id IN (${hh})`);
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
  const list = members.body.result.members as Array<{
    id: string;
    isOwner: boolean;
    displayName: string;
  }>;
  ownerMemberId = list.find((m) => m.isOwner)!.id;
  kidMemberId = list.find((m) => m.displayName === 'Kid')!.id;
});

afterAll(async () => {
  await cleanup();
});

const base = () => `/api/v1/households/${householdId}`;

async function makeRule(points: number): Promise<string> {
  const r = await call('POST', `${base()}/reward-rules`, {
    token: ownerToken,
    body: { name: `Rule${points}`, points },
  });
  return r.body.result.rule.id;
}

async function balanceOf(memberId: string): Promise<number> {
  const r = await call('GET', `${base()}/rewards/${memberId}`, { token: ownerToken });
  return r.body.result.rewards.balance;
}

describe('task-completion earn hook', () => {
  it('credits the rule points atomically on completion (once) and records value-change', async () => {
    const ruleId = await makeRule(10);
    const task = await call('POST', `${base()}/tasks`, {
      token: ownerToken,
      body: { title: 'Chore', startsAt: '2024-06-01T00:00:00.000Z', assignedTo: ownerMemberId },
    });
    const taskId = task.body.result.task.id;
    await db.update(tasks).set({ rewardRuleId: ruleId }).where(eq(tasks.id, taskId));

    await call('POST', `${base()}/tasks/${taskId}/complete`, { token: ownerToken });
    expect(await balanceOf(ownerMemberId)).toBe(10);

    // Re-completing must not credit a second time.
    await call('POST', `${base()}/tasks/${taskId}/complete`, { token: ownerToken });
    expect(await balanceOf(ownerMemberId)).toBe(10);

    const changes = await db
      .select()
      .from(valueChangeHistory)
      .where(
        and(
          eq(valueChangeHistory.entityId, ownerMemberId),
          eq(valueChangeHistory.fieldName, 'balance'),
        ),
      );
    expect(changes.some((c) => c.newValue === '10')).toBe(true);

    const earned = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientMemberId, ownerMemberId),
          eq(notifications.type, NotificationTypes.rewardEarned),
        ),
      );
    expect(earned.length).toBeGreaterThanOrEqual(1);
  });

  it('credits a verification-required task only after supervisor approval', async () => {
    const ruleId = await makeRule(10);
    const task = await call('POST', `${base()}/tasks`, {
      token: ownerToken,
      body: {
        title: 'Approved chore',
        startsAt: '2024-06-02T00:00:00.000Z',
        assignedTo: kidMemberId,
        requiresApproval: true,
      },
    });
    const taskId = task.body.result.task.id;
    await db.update(tasks).set({ rewardRuleId: ruleId }).where(eq(tasks.id, taskId));

    // Kid completes → pending verification → no credit yet.
    const kidComplete = await call('POST', `${base()}/tasks/${taskId}/complete`, {
      token: kidToken,
    });
    expect(kidComplete.body.result.task.status).toBe('in_progress');
    expect(await balanceOf(kidMemberId)).toBe(0);

    // Supervisor approves → reserved earn is finalized.
    await call('PATCH', `${base()}/tasks/${taskId}`, {
      token: ownerToken,
      body: { status: 'completed' },
    });
    expect(await balanceOf(kidMemberId)).toBe(10);
  });
});

describe('allowances', () => {
  it('grants once per period across the window and is idempotent on re-run', async () => {
    const created = await call('POST', `${base()}/reward-allowances`, {
      token: ownerToken,
      body: { memberId: kidMemberId, points: 50, rrule: 'FREQ=WEEKLY', name: 'Weekly allowance' },
    });
    expect(created.status).toBe(201);
    const anchor = new Date(created.body.result.allowance.lastGrantedAt as string);
    const twoWeeks = new Date(anchor.getTime() + 14 * 24 * 60 * 60 * 1000);

    const before = await balanceOf(kidMemberId);
    const run = await grantAllowances({ now: twoWeeks, householdId });
    expect(run.granted).toBe(2); // two weekly occurrences in (anchor, anchor+14d]
    expect(await balanceOf(kidMemberId)).toBe(before + 100);

    // Immediate re-run at the same instant grants nothing.
    const rerun = await grantAllowances({ now: twoWeeks, householdId });
    expect(rerun.granted).toBe(0);
    expect(await balanceOf(kidMemberId)).toBe(before + 100);
  });
});
