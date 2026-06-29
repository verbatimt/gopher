// Integration tests for the household & member management API (EP-0014). Runs fully in-process on the embedded
// DB (pglite + ioredis-mock). Drives the real app through a cookie-jar harness.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';
import { redis } from '../../redis/client.ts';

const app = createApp();

interface Reply {
  status: number;
  // biome-ignore lint/suspicious/noExplicitAny: test reads arbitrary JSON.
  body: any;
}

class Client {
  cookies: Record<string, string> = {};
  async req(
    method: string,
    path: string,
    opts: { body?: unknown; token?: string } = {},
  ): Promise<Reply> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    const cookieHeader = Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookieHeader) headers.cookie = cookieHeader;
    const res = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      }),
    );
    for (const setCookie of res.headers.getSetCookie()) {
      const pair = setCookie.split(';')[0] ?? '';
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '') delete this.cookies[name];
      else this.cookies[name] = value;
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
}

function decodeJwt(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString());
}

const emails = {
  owner: 'hh-api-owner@x.test',
  invitee: 'hh-api-invitee@x.test',
  invitee2: 'hh-api-invitee2@x.test',
};

async function cleanup(): Promise<void> {
  for (const email of Object.values(emails)) {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    for (const u of rows) {
      await db.execute(
        sql`DELETE FROM value_change_history WHERE household_id IN (SELECT id FROM households WHERE created_by = ${u.id}) OR changed_by = ${u.id} OR entity_id = ${u.id}`,
      );
      await db.execute(
        sql`DELETE FROM household_invites WHERE household_id IN (SELECT id FROM households WHERE created_by = ${u.id})`,
      );
      await db.execute(sql`DELETE FROM user_sessions WHERE user_id = ${u.id}`);
      await db.execute(
        sql`DELETE FROM household_members WHERE household_id IN (SELECT id FROM households WHERE created_by = ${u.id}) OR user_id = ${u.id}`,
      );
      await db.execute(
        sql`DELETE FROM time_windows WHERE household_id IN (SELECT id FROM households WHERE created_by = ${u.id})`,
      );
      await db.execute(sql`DELETE FROM households WHERE created_by = ${u.id}`);
      await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${u.id}`);
      await db.execute(sql`DELETE FROM audit_logs WHERE actor_user_id = ${u.id}`);
      await db.execute(sql`DELETE FROM users WHERE id = ${u.id}`);
    }
  }
}

async function register(
  email: string,
): Promise<{ client: Client; token: string; householdId: string }> {
  const client = new Client();
  const r = await client.req('POST', '/api/v1/auth/register', {
    body: { email, password: 'password123', displayName: 'Owner' },
  });
  const token = r.body.result.accessToken as string;
  const householdId = decodeJwt(token).householdId as string;
  return { client, token, householdId };
}

let ownerToken: string;
let householdId: string;
let inviteeToken: string;
let ownerMemberId: string;
let inviteeMemberId: string;
let firstInviteToken: string;

beforeAll(async () => {
  await seedRoles();
  await cleanup();
});

beforeEach(async () => {
  const keys = await redis.keys('ratelimit:*');
  if (keys.length > 0) await redis.del(...keys);
});

afterAll(async () => {
  await cleanup();
});

describe('household settings', () => {
  it('owner reads and updates settings (active_modules persists)', async () => {
    const owner = await register(emails.owner);
    ownerToken = owner.token;
    householdId = owner.householdId;

    const read = await owner.client.req('GET', `/api/v1/households/${householdId}`, {
      token: ownerToken,
    });
    expect(read.status).toBe(200);
    expect(read.body.result.household.name).toBeTruthy();

    const patched = await owner.client.req('PATCH', `/api/v1/households/${householdId}`, {
      token: ownerToken,
      body: { activeModules: ['calendar', 'tasks'], name: 'The Burrow' },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.result.household.activeModules).toEqual(['calendar', 'tasks']);
    expect(patched.body.result.household.name).toBe('The Burrow');
  });
});

describe('members', () => {
  it('creates a managed child with the supervised_user role', async () => {
    const client = new Client();
    const created = await client.req('POST', `/api/v1/households/${householdId}/members`, {
      token: ownerToken,
      body: { displayName: 'Kiddo', dateOfBirth: '2015-05-01' },
    });
    expect(created.status).toBe(201);
    expect(created.body.result.member.role).toBe('supervised_user');
    expect(created.body.result.member.isManaged).toBe(true);
    expect(created.body.result.member.hasLogin).toBe(false);

    const members = await client.req('GET', `/api/v1/households/${householdId}/members`, {
      token: ownerToken,
    });
    expect(
      members.body.result.members.some((m: { displayName: string }) => m.displayName === 'Kiddo'),
    ).toBe(true);
    ownerMemberId = members.body.result.members.find((m: { isOwner: boolean }) => m.isOwner).id;
  });
});

describe('invites', () => {
  it('creates an invite (token returned), rejects a duplicate, lists pending', async () => {
    const client = new Client();
    const created = await client.req('POST', `/api/v1/households/${householdId}/invites`, {
      token: ownerToken,
      body: { email: emails.invitee, role: 'unsupervised_user' },
    });
    expect(created.status).toBe(201);
    expect(created.body.result.token).toBeTruthy();
    firstInviteToken = created.body.result.token;

    const dup = await client.req('POST', `/api/v1/households/${householdId}/invites`, {
      token: ownerToken,
      body: { email: emails.invitee, role: 'unsupervised_user' },
    });
    expect(dup.status).toBe(409);

    const pending = await client.req(
      'GET',
      `/api/v1/households/${householdId}/invites?status=pending`,
      { token: ownerToken },
    );
    expect(
      pending.body.result.invites.some((i: { email: string }) => i.email === emails.invitee),
    ).toBe(true);
  });

  it('accepts an invite by creating an account and joins the household', async () => {
    const inviteeClient = new Client();
    const accepted = await inviteeClient.req('POST', '/api/v1/auth/accept-invite', {
      body: { token: firstInviteToken, password: 'password123', displayName: 'Invitee' },
    });
    expect(accepted.status).toBe(201);
    inviteeToken = accepted.body.result.accessToken;
    expect(decodeJwt(inviteeToken).householdId).toBe(householdId);

    const members = await new Client().req('GET', `/api/v1/households/${householdId}/members`, {
      token: ownerToken,
    });
    const invitee = members.body.result.members.find(
      (m: { displayName: string }) => m.displayName === 'Invitee',
    );
    expect(invitee.role).toBe('unsupervised_user');
    inviteeMemberId = invitee.id;
  });

  it('rejects re-accepting an already-accepted invite (409)', async () => {
    const r = await new Client().req('POST', '/api/v1/auth/accept-invite', {
      body: { token: firstInviteToken, password: 'password123', displayName: 'Invitee' },
    });
    expect(r.status).toBe(409);
  });

  it('rejects an expired invite (410)', async () => {
    const created = await new Client().req('POST', `/api/v1/households/${householdId}/invites`, {
      token: ownerToken,
      body: { email: emails.invitee2, role: 'supervised_user' },
    });
    const token = created.body.result.token as string;
    const inviteId = created.body.result.invite.id as string;
    await db.execute(
      sql`UPDATE household_invites SET expires_at = now() - interval '1 day' WHERE id = ${inviteId}`,
    );

    const r = await new Client().req('POST', '/api/v1/auth/accept-invite', {
      body: { token, password: 'password123', displayName: 'Late' },
    });
    expect(r.status).toBe(410);
  });
});

describe('authorization & invariants', () => {
  it('a non-supervisor cannot update settings (403)', async () => {
    const r = await new Client().req('PATCH', `/api/v1/households/${householdId}`, {
      token: inviteeToken,
      body: { name: 'Nope' },
    });
    expect(r.status).toBe(403);
  });

  it('rejects demoting the owner (only supervisor) with 409', async () => {
    const r = await new Client().req(
      'PATCH',
      `/api/v1/households/${householdId}/members/${ownerMemberId}`,
      {
        token: ownerToken,
        body: { role: 'unsupervised_user' },
      },
    );
    expect(r.status).toBe(409);
  });

  it('allows demoting a non-owner supervisor once a second supervisor exists', async () => {
    const client = new Client();
    // Promote the invitee to supervisor (now two supervisors).
    const promote = await client.req(
      'PATCH',
      `/api/v1/households/${householdId}/members/${inviteeMemberId}`,
      {
        token: ownerToken,
        body: { role: 'supervising_user' },
      },
    );
    expect(promote.status).toBe(200);
    // Demote the invitee (not the last supervisor) → succeeds.
    const demote = await client.req(
      'PATCH',
      `/api/v1/households/${householdId}/members/${inviteeMemberId}`,
      {
        token: ownerToken,
        body: { role: 'unsupervised_user' },
      },
    );
    expect(demote.status).toBe(200);
    expect(demote.body.result.member.role).toBe('unsupervised_user');
  });

  it('rejects deleting the owner (409) but deactivates a normal member', async () => {
    const client = new Client();
    const owner = await client.req(
      'DELETE',
      `/api/v1/households/${householdId}/members/${ownerMemberId}`,
      { token: ownerToken },
    );
    expect(owner.status).toBe(409);

    const member = await client.req(
      'DELETE',
      `/api/v1/households/${householdId}/members/${inviteeMemberId}`,
      { token: ownerToken },
    );
    expect(member.status).toBe(200);

    const members = await client.req('GET', `/api/v1/households/${householdId}/members`, {
      token: ownerToken,
    });
    expect(members.body.result.members.some((m: { id: string }) => m.id === inviteeMemberId)).toBe(
      false,
    );
  });
});
