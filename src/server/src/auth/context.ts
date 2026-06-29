// Shared auth context: the JWT plugin + a `claims` derive that decodes the bearer token
// into request-scoped auth claims. Every plugin that needs auth (the guard, auth routes,
// and domain plugins) uses this so JWT handling lives in one place.

import { jwt } from '@elysiajs/jwt';
import { Elysia } from 'elysia';
import { config } from '../config.ts';

export interface AuthClaims {
  userId: string;
  householdId: string;
  roles: string[];
}

export const authContext = new Elysia({ name: 'auth-context' })
  .use(jwt({ name: 'jwt', secret: config.jwtSecret, exp: '15m' }))
  .derive({ as: 'global' }, async ({ jwt, headers }) => {
    const header = headers.authorization;
    // biome-ignore lint/complexity/useOptionalChain: explicit form narrows `header` to string.
    if (!header || !header.startsWith('Bearer ')) {
      return { claims: null as AuthClaims | null };
    }
    const payload = await jwt.verify(header.slice(7));
    if (!payload || typeof payload.sub !== 'string') {
      return { claims: null as AuthClaims | null };
    }
    const roles = typeof payload.roles === 'string' ? payload.roles.split(',').filter(Boolean) : [];
    return {
      claims: {
        userId: payload.sub,
        householdId: typeof payload.householdId === 'string' ? payload.householdId : '',
        roles,
      } as AuthClaims | null,
    };
  });
