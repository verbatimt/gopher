// Integration tests for authentication & session management. Runs fully in-process on the
// embedded DB (pglite + ioredis-mock). Drives the real app through a cookie-jar harness.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { auditLogs, householdMembers, users } from '../../db/schema/index.ts';
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
  const payload = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString());
}

const password = 'password123';
const emails = {
  flow: 'auth-flow@x.test',
  dup: 'auth-dup@x.test',
  inactive: 'auth-inactive@x.test',
  rotate: 'auth-rotate@x.test',
  logout: 'auth-logout@x.test',
  reset: 'auth-reset@x.test',
  me: 'auth-me@x.test',
};

async function cleanup(): Promise<void> {
  for (const email of Object.values(emails)) {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    for (const u of rows) {
      await db.execute(sql`DELETE FROM user_sessions WHERE user_id = ${u.id}`);
      await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${u.id}`);
      await db.execute(
        sql`DELETE FROM household_members WHERE user_id = ${u.id} OR household_id IN (SELECT id FROM households WHERE created_by = ${u.id})`,
      );
      await db.execute(
        sql`DELETE FROM time_windows WHERE household_id IN (SELECT id FROM households WHERE created_by = ${u.id})`,
      );
      await db.execute(sql`DELETE FROM households WHERE created_by = ${u.id}`);
      await db.execute(sql`DELETE FROM value_change_history WHERE entity_id = ${u.id}`);
      await db.execute(sql`DELETE FROM audit_logs WHERE actor_user_id = ${u.id}`);
      await db.execute(sql`DELETE FROM users WHERE id = ${u.id}`);
    }
  }
}

async function register(email: string): Promise<{ client: Client; token: string }> {
  const client = new Client();
  const r = await client.req('POST', '/api/v1/auth/register', {
    body: { email, password, displayName: 'Test User' },
  });
  return { client, token: r.body.result.accessToken as string };
}

beforeAll(async () => {
  await seedRoles();
  await cleanup();
});

// Reset rate-limit windows between tests (all test requests share the 'unknown' IP).
beforeEach(async () => {
  const keys = await redis.keys('ratelimit:*');
  if (keys.length > 0) await redis.del(...keys);
});

afterAll(async () => {
  await cleanup();
});

describe('register', () => {
  it('creates user+household+owner atomically and returns a profile + cookie (201)', async () => {
    const client = new Client();
    const r = await client.req('POST', '/api/v1/auth/register', {
      body: { email: emails.flow, password, displayName: 'Flow User' },
    });
    expect(r.status).toBe(201);
    expect(r.body.result.user.email).toBe(emails.flow);
    expect(r.body.result.user.passwordHash).toBeUndefined();
    expect(r.body.result.accessToken).toBeTruthy();
    expect(client.cookies.refresh_token).toBeTruthy();

    // The household + owner member were created.
    const members = await db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.userId))
      .where(and(eq(users.email, emails.flow), eq(householdMembers.isOwner, true)));
    expect(members.length).toBe(1);
  });

  it('rejects a duplicate email with 409', async () => {
    await register(emails.dup);
    const r = await new Client().req('POST', '/api/v1/auth/register', {
      body: { email: emails.dup, password, displayName: 'Dup' },
    });
    expect(r.status).toBe(409);
    expect(r.body.success).toBe(false);
  });
});

describe('login', () => {
  it('returns an access token + cookie and a JWT with sub/householdId/roles', async () => {
    const r = await new Client().req('POST', '/api/v1/auth/login', {
      body: { email: emails.flow, password },
    });
    expect(r.status).toBe(200);
    const token = r.body.result.accessToken as string;
    const claims = decodeJwt(token);
    expect(claims.sub).toBeTruthy();
    expect(typeof claims.householdId).toBe('string');
    expect(claims.roles as string).toContain('supervising_user');
    expect(typeof claims.exp).toBe('number');
  });

  it('rejects an invalid password with 401', async () => {
    const r = await new Client().req('POST', '/api/v1/auth/login', {
      body: { email: emails.flow, password: 'wrongwrong' },
    });
    expect(r.status).toBe(401);
  });

  it('rejects an inactive account with 401', async () => {
    await register(emails.inactive);
    await db.update(users).set({ isActive: false }).where(eq(users.email, emails.inactive));
    const r = await new Client().req('POST', '/api/v1/auth/login', {
      body: { email: emails.inactive, password },
    });
    expect(r.status).toBe(401);
  });
});

describe('refresh rotation', () => {
  it('rotates the refresh token and rejects reuse of the old one', async () => {
    const { client } = await register(emails.rotate);
    const oldRefresh = client.cookies.refresh_token!;

    const refreshed = await client.req('POST', '/api/v1/auth/refresh');
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.result.accessToken).toBeTruthy();
    expect(client.cookies.refresh_token).not.toBe(oldRefresh); // rotated

    // Reusing the OLD refresh token is rejected.
    const replay = new Client();
    replay.cookies.refresh_token = oldRefresh;
    const reused = await replay.req('POST', '/api/v1/auth/refresh');
    expect(reused.status).toBe(401);
  });
});

describe('logout', () => {
  it('is idempotent (204) and invalidates the session', async () => {
    const { client } = await register(emails.logout);

    const out1 = await client.req('POST', '/api/v1/auth/logout');
    expect(out1.status).toBe(204);

    // Refresh after logout is rejected.
    const afterLogout = await client.req('POST', '/api/v1/auth/refresh');
    expect(afterLogout.status).toBe(401);

    // Logout again (no cookie) is still 204.
    const out2 = await new Client().req('POST', '/api/v1/auth/logout');
    expect(out2.status).toBe(204);
  });
});

describe('me', () => {
  it('requires a bearer token and updates profile preferences', async () => {
    const { client, token } = await register(emails.me);

    const noAuth = await client.req('GET', '/api/v1/auth/me');
    expect(noAuth.status).toBe(401);

    const meOk = await client.req('GET', '/api/v1/auth/me', { token });
    expect(meOk.status).toBe(200);
    expect(meOk.body.result.user.email).toBe(emails.me);

    const patched = await client.req('PATCH', '/api/v1/auth/me', {
      token,
      body: { timezone: 'America/New_York', currency: 'EUR' },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.result.user.timezone).toBe('America/New_York');
    expect(patched.body.result.user.currency).toBe('EUR');
  });
});

describe('password reset', () => {
  it('issues a single-use token, sets a new password, and invalidates sessions', async () => {
    const { client } = await register(emails.reset);

    const forgot = await client.req('POST', '/api/v1/auth/forgot-password', {
      body: { email: emails.reset },
    });
    expect(forgot.status).toBe(200);
    const resetToken = forgot.body.result.resetToken as string;
    expect(resetToken).toBeTruthy(); // returned in non-prod

    const reset = await client.req('POST', '/api/v1/auth/reset-password', {
      body: { token: resetToken, newPassword: 'newpassword456' },
    });
    expect(reset.status).toBe(200);

    // Token is single-use.
    const reuse = await client.req('POST', '/api/v1/auth/reset-password', {
      body: { token: resetToken, newPassword: 'another789' },
    });
    expect(reuse.status).toBe(401);

    // Old sessions were invalidated (refresh fails).
    const refresh = await client.req('POST', '/api/v1/auth/refresh');
    expect(refresh.status).toBe(401);

    // Login with the new password works.
    const login = await new Client().req('POST', '/api/v1/auth/login', {
      body: { email: emails.reset, password: 'newpassword456' },
    });
    expect(login.status).toBe(200);
  });
});

describe('audit', () => {
  it('records audit rows for register and login', async () => {
    const rows = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .innerJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(eq(users.email, emails.flow));
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('auth.register');
    expect(actions).toContain('auth.login');
  });
});
