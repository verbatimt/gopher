// Auth HTTP surface (/api/v1/auth/*): register, login, refresh, logout, me, password
// reset, and session management. JWT (HS256, 15-min) via the Elysia JWT plugin; refresh
// token in an httpOnly + SameSite=Lax cookie (no Secure — plain-HTTP LAN, same-origin).

import { type Cookie, Elysia, t } from 'elysia';
import { AuditActions } from '../../audit/actions.ts';
import { auditLog } from '../../audit/log.ts';
import { guard } from '../../auth/guard.ts';
import { config } from '../../config.ts';
import { success } from '../../http/envelope.ts';
import { UnauthorizedError } from '../../http/errors.ts';
import { messages } from '../../http/messages.ts';
import { resolveMemberId } from '../households/service.ts';
import { acceptInvite } from '../invites/service.ts';
import {
  authenticate,
  getUserById,
  getUserContext,
  registerUser,
  requestPasswordReset,
  resetPassword,
  toProfile,
  updateProfile,
} from './service.ts';
import {
  createRefreshSession,
  listSessions,
  revokeRefreshSession,
  revokeSessionById,
  rotateRefreshSession,
} from './session-store.ts';

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60; // seconds

type CookieJar = Record<string, Cookie<unknown>>;

function setRefreshCookie(cookie: CookieJar, raw: string): void {
  cookie[REFRESH_COOKIE]!.set({
    value: raw,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_MAX_AGE,
    // No `secure` flag: plain HTTP on the trusted LAN, served same-origin.
  });
}

function clearRefreshCookie(cookie: CookieJar): void {
  cookie[REFRESH_COOKIE]!.remove();
}

interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

function requestMeta(
  request: Request,
  server: { requestIP?: (r: Request) => { address: string } | null } | null,
): RequestMeta {
  const userAgent = request.headers.get('user-agent');
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded
    ? (forwarded.split(',')[0]?.trim() ?? null)
    : (server?.requestIP?.(request)?.address ?? null);
  return { ip: ip ?? null, userAgent: userAgent ?? null };
}

// JWT signing/verification and `claims` come from the shared `guard` (→ authContext);
// the guard also provides the rateLimit macro applied to sensitive routes below.
export const authPlugin = new Elysia({ name: 'auth', prefix: '/auth' })
  .use(guard)
  .post(
    '/register',
    async ({ body, jwt, cookie, set, request, server }) => {
      const meta = requestMeta(request, server);
      const { user } = await registerUser(body);
      const context = await getUserContext(user.id);
      const householdId = context?.householdId ?? '';
      const roleNames = context?.roleNames ?? [];
      const accessToken = await jwt.sign({ sub: user.id, householdId, roles: roleNames.join(',') });
      const { raw } = await createRefreshSession(
        user.id,
        householdId || null,
        body.deviceLabel ?? meta.userAgent,
      );
      setRefreshCookie(cookie, raw);
      await auditLog({
        action: AuditActions.auth.register,
        householdId: householdId || null,
        actorUserId: user.id,
        entityType: 'user',
        entityId: user.id,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
      set.status = 201;
      return success(
        { user: toProfile(user), accessToken },
        { statusCode: 201, message: messages.CREATED },
      );
    },
    {
      rateLimit: { limit: 5, windowSeconds: 60, bucket: 'register' },
      body: t.Object({
        email: t.String({ pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', maxLength: 254 }),
        password: t.String({ minLength: 8, maxLength: 200 }),
        displayName: t.String({ minLength: 1, maxLength: 80 }),
        timezone: t.Optional(t.String({ maxLength: 64 })),
        deviceLabel: t.Optional(t.String({ maxLength: 120 })),
      }),
    },
  )
  .post(
    '/login',
    async ({ body, jwt, cookie, request, server }) => {
      const meta = requestMeta(request, server);
      const user = await authenticate(body.email, body.password);
      const context = await getUserContext(user.id);
      const householdId = context?.householdId ?? '';
      const roleNames = context?.roleNames ?? [];
      const accessToken = await jwt.sign({ sub: user.id, householdId, roles: roleNames.join(',') });
      const { raw } = await createRefreshSession(
        user.id,
        householdId || null,
        body.deviceLabel ?? meta.userAgent,
      );
      setRefreshCookie(cookie, raw);
      await auditLog({
        action: AuditActions.auth.login,
        householdId: householdId || null,
        actorUserId: user.id,
        entityType: 'user',
        entityId: user.id,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
      return success({ user: toProfile(user), accessToken });
    },
    {
      rateLimit: { limit: 10, windowSeconds: 60, bucket: 'login' },
      body: t.Object({
        email: t.String({ maxLength: 254 }),
        password: t.String({ maxLength: 200 }),
        deviceLabel: t.Optional(t.String({ maxLength: 120 })),
      }),
    },
  )
  .post('/refresh', async ({ cookie, jwt }) => {
    const raw = cookie[REFRESH_COOKIE]!.value as string | undefined;
    if (!raw) throw new UnauthorizedError('No refresh token.');
    const rotated = await rotateRefreshSession(raw);
    if (!rotated) throw new UnauthorizedError('Invalid or expired refresh token.');
    const context = await getUserContext(rotated.userId);
    const roleNames = context?.roleNames ?? [];
    const accessToken = await jwt.sign({
      sub: rotated.userId,
      householdId: rotated.householdId ?? '',
      roles: roleNames.join(','),
    });
    setRefreshCookie(cookie, rotated.raw);
    return success({ accessToken });
  })
  .post('/logout', async ({ cookie, set }) => {
    const raw = cookie[REFRESH_COOKIE]!.value as string | undefined;
    if (raw) {
      const revoked = await revokeRefreshSession(raw);
      if (revoked) {
        await auditLog({
          action: AuditActions.auth.logout,
          householdId: revoked.householdId,
          actorUserId: revoked.userId,
        });
      }
    }
    clearRefreshCookie(cookie);
    set.status = 204;
    return '';
  })
  .get('/me', async ({ claims }) => {
    if (!claims) throw new UnauthorizedError();
    const user = await getUserById(claims.userId);
    // biome-ignore lint/complexity/useOptionalChain: explicit form narrows `user` to non-null.
    if (!user || !user.isActive) throw new UnauthorizedError();
    // Expose the caller's household_members id so self-scoped clients (e.g. vitals, EP-0044)
    // can address their own member without needing members:read.
    const memberId = claims.householdId
      ? await resolveMemberId(claims.householdId, claims.userId)
      : null;
    return success({ user: { ...toProfile(user), memberId } });
  })
  .patch(
    '/me',
    async ({ claims, body }) => {
      if (!claims) throw new UnauthorizedError();
      const user = await updateProfile(claims.userId, body);
      if (!user) throw new UnauthorizedError();
      return success({ user: toProfile(user) });
    },
    {
      body: t.Object({
        displayName: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
        avatarUrl: t.Optional(t.String({ maxLength: 500 })),
        timezone: t.Optional(t.String({ maxLength: 64 })),
        currency: t.Optional(t.String({ maxLength: 8 })),
      }),
    },
  )
  .post(
    '/forgot-password',
    async ({ body }) => {
      const token = await requestPasswordReset(body.email);
      const result: { sent: true; resetToken?: string } = { sent: true };
      // Non-prod convenience: return the token for manual delivery (no email provider).
      if (token && !config.isProd) result.resetToken = token;
      return success(result);
    },
    { body: t.Object({ email: t.String({ maxLength: 254 }) }) },
  )
  .post(
    '/reset-password',
    async ({ body }) => {
      const userId = await resetPassword(body.token, body.newPassword);
      await auditLog({
        action: AuditActions.auth.passwordReset,
        actorUserId: userId,
        entityType: 'user',
        entityId: userId,
      });
      return success({ reset: true });
    },
    {
      body: t.Object({
        token: t.String({ minLength: 8, maxLength: 200 }),
        newPassword: t.String({ minLength: 8, maxLength: 200 }),
      }),
    },
  )
  .post(
    '/accept-invite',
    async ({ body, claims, jwt, cookie, request, server, set }) => {
      const meta = requestMeta(request, server);
      const { userId, householdId, memberId, linked } = await acceptInvite({
        token: body.token,
        userId: claims?.userId,
        password: body.password,
        displayName: body.displayName,
      });
      const context = await getUserContext(userId);
      const roleNames = context?.roleNames ?? [];
      const accessToken = await jwt.sign({ sub: userId, householdId, roles: roleNames.join(',') });
      const { raw } = await createRefreshSession(
        userId,
        householdId,
        body.deviceLabel ?? meta.userAgent,
      );
      setRefreshCookie(cookie, raw);
      await auditLog({
        action: AuditActions.household.inviteAccepted,
        householdId,
        actorUserId: userId,
        entityType: 'household_member',
        entityId: memberId,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
        metadata: { linked },
      });
      const user = await getUserById(userId);
      set.status = 201;
      return success(
        { user: user ? toProfile(user) : null, accessToken },
        { statusCode: 201, message: messages.CREATED },
      );
    },
    {
      body: t.Object({
        token: t.String({ minLength: 8, maxLength: 200 }),
        password: t.Optional(t.String({ minLength: 8, maxLength: 200 })),
        displayName: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
        deviceLabel: t.Optional(t.String({ maxLength: 120 })),
      }),
    },
  )
  .get('/sessions', async ({ claims }) => {
    if (!claims) throw new UnauthorizedError();
    return success({ sessions: await listSessions(claims.userId) });
  })
  .delete('/sessions/:id', async ({ claims, params }) => {
    if (!claims) throw new UnauthorizedError();
    const revoked = await revokeSessionById(claims.userId, params.id);
    return success({ revoked });
  });
