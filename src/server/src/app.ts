// Composition root. Builds the Elysia application: OpenAPI, CORS, request-id + structured
// logging, centralized error handling (typed errors -> HTTP + envelope), the /health
// endpoint, and the versioned /api/v1 surface. Domain plugins are mounted under /api/v1.

import { cors } from '@elysiajs/cors';
import { openapi } from '@elysiajs/openapi';
import { Elysia } from 'elysia';
import { config } from './config.ts';
import { failure } from './http/envelope.ts';
import { AppError } from './http/errors.ts';
import { messages } from './http/messages.ts';
import { authPlugin } from './modules/auth/index.ts';
import { calendarPlugin } from './modules/calendar/routes.ts';
import { dashboardPlugin } from './modules/dashboard/routes.ts';
import { financePlugin } from './modules/finance/routes.ts';
import { financeExtPlugin } from './modules/finance-extensions/routes.ts';
import { householdsPlugin } from './modules/households/routes.ts';
import { mealsPlugin } from './modules/meals/routes.ts';
import { medicationsPlugin } from './modules/medications/routes.ts';
import { notificationsPlugin } from './modules/notifications/routes.ts';
import { rewardsPlugin } from './modules/rewards/routes.ts';
import { tasksPlugin } from './modules/tasks/routes.ts';
import { logger } from './observability/logger.ts';
import { recordRequest } from './observability/metrics.ts';
import { healthPlugin } from './plugins/health.ts';
import { metaPlugin } from './plugins/meta.ts';
import { metricsPlugin } from './plugins/metrics.ts';
import { wsPlugin } from './realtime/ws.ts';

// Per-request timing/id state, keyed by the Request object (auto-collected).
const requestState = new WeakMap<Request, { id: string; startedAt: number }>();

export function createApp() {
  return (
    new Elysia({ name: 'gopher' })
      .use(openapi())
      .use(
        cors({
          // Same-origin web client needs no CORS; only configured origins are allowed for
          // direct cross-origin browser access. Never a wildcard.
          origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
          credentials: true,
        }),
      )
      .onRequest(({ request, set }) => {
        const id = crypto.randomUUID();
        requestState.set(request, { id, startedAt: performance.now() });
        set.headers['x-request-id'] = id;
      })
      // Centralized error handling: map typed/known errors to the envelope; never leak
      // internals or stack traces.
      .onError(({ error, code, set, request }) => {
        let statusCode = 500;
        let message: string = messages.INTERNAL_ERROR;

        if (error instanceof AppError) {
          statusCode = error.statusCode;
          message = error.message;
        } else if (code === 'VALIDATION') {
          statusCode = 422;
          message = messages.INVALID_INPUT;
        } else if (code === 'NOT_FOUND') {
          statusCode = 404;
          message = messages.NOT_FOUND;
        } else if (code === 'PARSE') {
          statusCode = 400;
          message = messages.BAD_REQUEST;
        }

        if (statusCode >= 500) {
          const detail = error instanceof Error ? error.message : String(error);
          logger.error('unhandled request error', {
            code,
            detail,
            path: new URL(request.url).pathname,
          });
        }

        set.status = statusCode;
        return failure(statusCode, message);
      })
      .onAfterResponse(({ request, set }) => {
        const state = requestState.get(request);
        const status = typeof set.status === 'number' ? set.status : 200;
        recordRequest(status);
        logger.info('request', {
          requestId: state?.id,
          method: request.method,
          path: new URL(request.url).pathname,
          status,
          durationMs: state ? Math.round(performance.now() - state.startedAt) : undefined,
        });
      })
      // Unversioned diagnostics + real-time WebSocket endpoint.
      .use(healthPlugin())
      .use(metricsPlugin())
      .use(wsPlugin)
      // Versioned API surface.
      .group('/api/v1', (api) =>
        api
          .use(metaPlugin)
          .use(authPlugin)
          .use(householdsPlugin)
          .use(notificationsPlugin)
          .use(calendarPlugin)
          .use(tasksPlugin)
          .use(medicationsPlugin)
          .use(rewardsPlugin)
          .use(mealsPlugin)
          .use(dashboardPlugin)
          .use(financePlugin)
          .use(financeExtPlugin),
      )
  );
}
