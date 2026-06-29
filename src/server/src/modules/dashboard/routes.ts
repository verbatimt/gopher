// Dashboard HTTP surface: GET /api/v1/dashboard. Household is taken from the caller's token
// (not a path param). Requires dashboard:read (held by every household role).

import { Elysia } from 'elysia';
import { guard } from '../../auth/guard.ts';
import { Permissions } from '../../auth/permissions.ts';
import { success } from '../../http/envelope.ts';
import { buildDashboard } from './service.ts';

export const dashboardPlugin = new Elysia({ name: 'dashboard' })
  .use(guard)
  .get('/dashboard', async ({ claims }) => success(await buildDashboard(claims!)), {
    requireAuth: true,
    requirePermissions: [Permissions.dashboardRead],
  });
