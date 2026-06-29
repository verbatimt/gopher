// Integration tests for the Task Replacement Model (EP-0021). Runs fully in-process on the embedded DB (pglite + ioredis-mock).

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';

const PORT = 3196;
const app = createApp();

const ownerEmail = 'tasks-owner@x.test';
const kidEmail = 'tasks-kid@x.test';
let ownerToken = '';
let kidToken = '';
let householdId = '';
let ownerMemberId = '';
let kidMemberId = '';

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
  for (const email of [ownerEmail, kidEmail]) {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    for (const u of rows) {
      const hh = sql`SELECT id FROM households WHERE created_by = ${u.id}`;
      await db.execute(
        sql`DELETE FROM task_workflow_steps WHERE task_id IN (SELECT t.id FROM tasks t JOIN scheduled_items s ON s.id = t.scheduled_item_id WHERE s.household_id IN (${hh}))`,
      );
      await db.execute(
        sql`DELETE FROM tasks WHERE scheduled_item_id IN (SELECT id FROM scheduled_items WHERE household_id IN (${hh}))`,
      );
      await db.execute(
        sql`DELETE FROM recurring_tasks WHERE scheduled_item_id IN (SELECT id FROM scheduled_items WHERE household_id IN (${hh}))`,
      );
      await db.execute(sql`DELETE FROM notifications WHERE household_id IN (${hh})`);
      await db.execute(sql`DELETE FROM scheduled_items WHERE household_id IN (${hh})`);
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
  ownerMemberId = members.body.result.members.find((m: { isOwner: boolean }) => m.isOwner).id;
  kidMemberId = members.body.result.members.find(
    (m: { displayName: string }) => m.displayName === 'Kid',
  ).id;
});

afterAll(async () => {
  await cleanup();
});

describe('recurring tasks', () => {
  it('creates a recurring chore with an RRULE and rotation pool atomically', async () => {
    const created = await call('POST', `/api/v1/households/${householdId}/recurring-tasks`, {
      token: ownerToken,
      body: {
        title: 'Dishes',
        startsAt: '2024-06-01T00:00:00.000Z',
        recurrence: { frequency: 'daily' },
        rotationPool: [ownerMemberId, kidMemberId],
        generateAheadDays: 7,
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.result.recurringTask.rotationPool).toEqual([ownerMemberId, kidMemberId]);
    expect(created.body.result.item.rrule).toContain('FREQ=DAILY');

    const list = await call('GET', `/api/v1/households/${householdId}/recurring-tasks`, {
      token: ownerToken,
    });
    expect(list.body.result.recurringTasks.length).toBeGreaterThanOrEqual(1);
  });
});

describe('ad-hoc task lifecycle', () => {
  it('creates and completes a task (status/at/by set)', async () => {
    const created = await call('POST', `/api/v1/households/${householdId}/tasks`, {
      token: ownerToken,
      body: {
        title: 'Take out trash',
        startsAt: '2024-06-02T00:00:00.000Z',
        assignedTo: ownerMemberId,
      },
    });
    expect(created.status).toBe(201);
    const taskId = created.body.result.task.id;

    const completed = await call(
      'POST',
      `/api/v1/households/${householdId}/tasks/${taskId}/complete`,
      { token: ownerToken },
    );
    expect(completed.body.result.task.status).toBe('completed');
    expect(completed.body.result.task.completedAt).not.toBeNull();
    expect(completed.body.result.task.completedBy).toBe(ownerMemberId);
  });

  it('rejects skipping an unskippable task', async () => {
    const created = await call('POST', `/api/v1/households/${householdId}/tasks`, {
      token: ownerToken,
      body: {
        title: 'Meds',
        startsAt: '2024-06-02T00:00:00.000Z',
        unskippable: true,
        assignedTo: ownerMemberId,
      },
    });
    const taskId = created.body.result.task.id;
    const skip = await call('PATCH', `/api/v1/households/${householdId}/tasks/${taskId}`, {
      token: ownerToken,
      body: { status: 'skipped' },
    });
    expect(skip.status).toBe(409);
  });
});

describe('workflow steps', () => {
  it('auto-completes the parent when all steps complete and renumbers on delete', async () => {
    const created = await call('POST', `/api/v1/households/${householdId}/tasks`, {
      token: ownerToken,
      body: { title: 'Routine', startsAt: '2024-06-03T00:00:00.000Z', assignedTo: ownerMemberId },
    });
    const taskId = created.body.result.task.id;
    const s1 = (
      await call('POST', `/api/v1/households/${householdId}/tasks/${taskId}/steps`, {
        token: ownerToken,
        body: { description: 'One' },
      })
    ).body.result.step;
    const s2 = (
      await call('POST', `/api/v1/households/${householdId}/tasks/${taskId}/steps`, {
        token: ownerToken,
        body: { description: 'Two' },
      })
    ).body.result.step;
    const s3 = (
      await call('POST', `/api/v1/households/${householdId}/tasks/${taskId}/steps`, {
        token: ownerToken,
        body: { description: 'Three' },
      })
    ).body.result.step;

    for (const s of [s1, s2, s3]) {
      await call('PATCH', `/api/v1/households/${householdId}/tasks/${taskId}/steps/${s.id}`, {
        token: ownerToken,
        body: { isCompleted: true },
      });
    }
    const afterAll = await call('GET', `/api/v1/households/${householdId}/tasks/${taskId}`, {
      token: ownerToken,
    });
    expect(afterAll.body.result.task.status).toBe('completed');

    // Delete the middle step → remaining renumber 1,2.
    const del = await call(
      'DELETE',
      `/api/v1/households/${householdId}/tasks/${taskId}/steps/${s2.id}`,
      { token: ownerToken },
    );
    const orders = (del.body.result.task.steps as Array<{ stepOrder: number }>)
      .map((x) => x.stepOrder)
      .sort();
    expect(orders).toEqual([1, 2]);
  });
});

describe('role scoping & approval', () => {
  it('a supervised user sees only their own tasks', async () => {
    await call('POST', `/api/v1/households/${householdId}/tasks`, {
      token: ownerToken,
      body: { title: 'KidTask', startsAt: '2024-06-04T00:00:00.000Z', assignedTo: kidMemberId },
    });
    await call('POST', `/api/v1/households/${householdId}/tasks`, {
      token: ownerToken,
      body: { title: 'OwnerTask', startsAt: '2024-06-04T00:00:00.000Z', assignedTo: ownerMemberId },
    });
    const kidList = await call('GET', `/api/v1/households/${householdId}/tasks`, {
      token: kidToken,
    });
    const titles = (kidList.body.result.tasks as Array<{ title: string }>).map((t) => t.title);
    expect(titles).toContain('KidTask');
    expect(titles).not.toContain('OwnerTask');
  });

  it('supervised completion requiring approval enters pending-verification until a supervisor approves', async () => {
    const created = await call('POST', `/api/v1/households/${householdId}/tasks`, {
      token: ownerToken,
      body: {
        title: 'NeedsApproval',
        startsAt: '2024-06-05T00:00:00.000Z',
        assignedTo: kidMemberId,
        requiresApproval: true,
      },
    });
    const taskId = created.body.result.task.id;

    const kidComplete = await call(
      'POST',
      `/api/v1/households/${householdId}/tasks/${taskId}/complete`,
      { token: kidToken },
    );
    expect(kidComplete.body.result.task.status).toBe('in_progress'); // pending verification

    const approve = await call('PATCH', `/api/v1/households/${householdId}/tasks/${taskId}`, {
      token: ownerToken,
      body: { status: 'completed' },
    });
    expect(approve.body.result.task.status).toBe('completed');
  });
});
