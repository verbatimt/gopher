// Meta/diagnostic routes mounted under /api/v1. They demonstrate the two conventions every
// domain plugin follows: TypeBox validation at the boundary and the success() envelope.
// Domain plugins (auth, households, tasks, …) are added under /api/v1 in later EPs.

import { Elysia, t } from 'elysia';
import { config } from '../config.ts';
import { success } from '../http/envelope.ts';

export const metaPlugin = new Elysia({ name: 'meta' })
  .get('/', () => success({ name: 'gopher-api', version: config.apiVersion }), {
    detail: { summary: 'API index' },
  })
  .post('/echo', ({ body }) => success({ echo: body.message }), {
    body: t.Object({
      message: t.String({ minLength: 1, maxLength: 280 }),
    }),
    detail: { summary: 'Validation + envelope example' },
  });
