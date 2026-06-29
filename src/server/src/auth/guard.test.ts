// Integration tests for the authorization guard (permissions, household scoping, system
// bypass, rate limiting). Requires Redis (for rate limiting). Tokens are signed with the
// same secret the guard verifies with.

import { beforeEach, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { SignJWT } from 'jose';
import { config } from '../config.ts';
import { AppError } from '../http/errors.ts';
import { redis } from '../redis/client.ts';
import { guard } from './guard.ts';
import { Permissions, Roles } from './permissions.ts';
import { assertFinanceAccess, medicationScope, scopedToSelf } from './visibility.ts';

const testApp = new Elysia()
  .onError(({ error, set }) => {
    if (error instanceof AppError) {
      set.status = error.statusCode;
      return { message: error.message };
    }
    set.status = 500;
    return { message: 'error' };
  })
  .use(guard)
  .get('/protected', () => 'ok', { requirePermissions: [Permissions.membersWrite] })
  .get('/hh/:id', () => 'ok', { requireHousehold: 'id' })
  .get('/limited', () => 'ok', {
    rateLimit: { limit: 2, windowSeconds: 60, bucket: 'guard-test' },
  });

async function token(roles: string[], householdId = 'hh-A', userId = 'u-1'): Promise<string> {
  const secret = new TextEncoder().encode(config.jwtSecret);
  return new SignJWT({ householdId, roles: roles.join(',') })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setExpirationTime('15m')
    .sign(secret);
}

async function get(path: string, jwt?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (jwt) headers.authorization = `Bearer ${jwt}`;
  return testApp.handle(new Request(`http://localhost${path}`, { headers }));
}

beforeEach(async () => {
  const keys = await redis.keys('ratelimit:guard-test:*');
  if (keys.length > 0) await redis.del(...keys);
});

describe('permission guard', () => {
  it('allows an authorized role (200) and blocks an unauthorized one (403)', async () => {
    expect((await get('/protected', await token([Roles.supervisingUser]))).status).toBe(200);
    expect((await get('/protected', await token([Roles.supervisedUser]))).status).toBe(403);
  });

  it('requires a token (401)', async () => {
    expect((await get('/protected')).status).toBe(401);
  });

  it('system_admin wildcard satisfies any permission', async () => {
    expect((await get('/protected', await token([Roles.systemAdmin]))).status).toBe(200);
  });
});

describe('household scoping', () => {
  it('allows a matching household (200) and rejects a mismatch (403)', async () => {
    const tok = await token([Roles.supervisingUser], 'hh-A');
    expect((await get('/hh/hh-A', tok)).status).toBe(200);
    expect((await get('/hh/hh-B', tok)).status).toBe(403);
  });

  it('lets a system_admin cross tenants', async () => {
    const admin = await token([Roles.systemAdmin], 'hh-A');
    expect((await get('/hh/hh-B', admin)).status).toBe(200);
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After once the limit is exceeded', async () => {
    const tok = await token([Roles.supervisingUser]);
    expect((await get('/limited', tok)).status).toBe(200);
    expect((await get('/limited', tok)).status).toBe(200);
    const limited = await get('/limited', tok);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });
});

describe('role-aware visibility', () => {
  const claimsFor = (roles: string[]) => ({ userId: 'u', householdId: 'h', roles });

  it('blocks supervised users from finance; supervisors are allowed', () => {
    expect(() => assertFinanceAccess(claimsFor([Roles.supervisedUser]))).toThrow();
    expect(() => assertFinanceAccess(claimsFor([Roles.supervisingUser]))).not.toThrow();
  });

  it('scopes supervised users to their own items', () => {
    expect(scopedToSelf([Roles.supervisedUser])).toBe(true);
    expect(scopedToSelf([Roles.supervisingUser])).toBe(false);
  });

  it('narrows medication visibility for non-supervisors', () => {
    expect(medicationScope([Roles.supervisingUser])).toBe('all');
    expect(medicationScope([Roles.unsupervisedUser])).toBe('self');
  });
});
