// Tasks HTTP surface (/api/v1/households/:id/...). Reads require tasks:read; writes
// tasks:write. Supervised users are scoped to their own tasks server-side.

import { Elysia, t } from 'elysia';
import type { AuthClaims } from '../../auth/context.ts';
import { guard } from '../../auth/guard.ts';
import { Permissions } from '../../auth/permissions.ts';
import { success } from '../../http/envelope.ts';
import { NotFoundError } from '../../http/errors.ts';
import { messages } from '../../http/messages.ts';
import { resolveMemberId } from '../households/service.ts';
import {
  type ActorContext,
  addStep,
  completeTask,
  createRecurringTask,
  createTask,
  deleteRecurringTask,
  deleteStep,
  getTask,
  listRecurringTasks,
  listTasks,
  reorderSteps,
  toggleStep,
  updateTask,
} from './service.ts';

async function actor(claims: AuthClaims): Promise<ActorContext> {
  return {
    userId: claims.userId,
    householdId: claims.householdId,
    memberId: await resolveMemberId(claims.householdId, claims.userId),
    roles: claims.roles,
  };
}

const recurrenceSchema = t.Object({
  frequency: t.Union([
    t.Literal('once'),
    t.Literal('daily'),
    t.Literal('weekly'),
    t.Literal('monthly'),
    t.Literal('yearly'),
  ]),
  interval: t.Optional(t.Integer({ minimum: 1, maximum: 365 })),
  end: t.Optional(
    t.Object({
      kind: t.Union([t.Literal('ongoing'), t.Literal('until'), t.Literal('count')]),
      until: t.Optional(t.String()),
      count: t.Optional(t.Integer({ minimum: 1 })),
    }),
  ),
});

export const tasksPlugin = new Elysia({ name: 'tasks' })
  .use(guard)
  // --- recurring tasks ---
  .post(
    '/households/:id/recurring-tasks',
    async ({ params, body, claims, set }) => {
      const result = await createRecurringTask(params.id, claims!.userId, body);
      set.status = 201;
      return success(
        { recurringTask: result.recurring, item: result.item },
        { statusCode: 201, message: messages.CREATED },
      );
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.tasksWrite],
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 200 }),
        description: t.Optional(t.String({ maxLength: 2000 })),
        startsAt: t.String(),
        unskippable: t.Optional(t.Boolean()),
        recurrence: recurrenceSchema,
        rotationPool: t.Optional(t.Array(t.String(), { maxItems: 50 })),
        assignmentCount: t.Optional(t.Integer({ minimum: 1 })),
        assignedTo: t.Optional(t.String()),
        generateAheadDays: t.Optional(t.Integer({ minimum: 1, maximum: 365 })),
      }),
    },
  )
  .get(
    '/households/:id/recurring-tasks',
    async ({ params }) => success({ recurringTasks: await listRecurringTasks(params.id) }),
    { requireHousehold: 'id', requirePermissions: [Permissions.tasksRead] },
  )
  .delete(
    '/households/:id/recurring-tasks/:rid',
    async ({ params }) => {
      await deleteRecurringTask(params.id, params.rid);
      return success({ deleted: true });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.tasksWrite] },
  )
  // --- tasks ---
  .post(
    '/households/:id/tasks',
    async ({ params, body, claims, set }) => {
      const task = await createTask(params.id, claims!.userId, body);
      set.status = 201;
      return success({ task }, { statusCode: 201, message: messages.CREATED });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.tasksWrite],
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 200 }),
        description: t.Optional(t.String({ maxLength: 2000 })),
        startsAt: t.String(),
        assignedTo: t.Optional(t.String()),
        unskippable: t.Optional(t.Boolean()),
        requiresApproval: t.Optional(t.Boolean()),
      }),
    },
  )
  .get(
    '/households/:id/tasks',
    async ({ params, query, claims }) => {
      const items = await listTasks(
        params.id,
        {
          status: query.status,
          assignedTo: query.assignedTo,
          from: query.from,
          to: query.to,
          page: query.page ? Number.parseInt(query.page, 10) : 1,
        },
        await actor(claims!),
      );
      return success({ tasks: items });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.tasksRead],
      query: t.Object({
        status: t.Optional(t.String({ maxLength: 16 })),
        assignedTo: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        page: t.Optional(t.String({ maxLength: 8 })),
      }),
    },
  )
  .get(
    '/households/:id/tasks/:taskId',
    async ({ params }) => {
      const task = await getTask(params.id, params.taskId);
      if (!task) throw new NotFoundError('Task not found.');
      return success({ task });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.tasksRead] },
  )
  .patch(
    '/households/:id/tasks/:taskId',
    async ({ params, body }) => {
      const task = await updateTask(params.id, params.taskId, body);
      return success({ task });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.tasksWrite],
      body: t.Object({
        title: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        description: t.Optional(t.String({ maxLength: 2000 })),
        startsAt: t.Optional(t.String()),
        assignedTo: t.Optional(t.String()),
        status: t.Optional(
          t.Union([
            t.Literal('pending'),
            t.Literal('in_progress'),
            t.Literal('completed'),
            t.Literal('skipped'),
            t.Literal('cancelled'),
          ]),
        ),
      }),
    },
  )
  .post(
    '/households/:id/tasks/:taskId/complete',
    async ({ params, claims }) => {
      const task = await completeTask(params.id, params.taskId, await actor(claims!));
      return success({ task });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.tasksWrite] },
  )
  // --- workflow steps ---
  .post(
    '/households/:id/tasks/:taskId/steps',
    async ({ params, body, set }) => {
      const step = await addStep(params.id, params.taskId, body);
      set.status = 201;
      return success({ step }, { statusCode: 201, message: messages.CREATED });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.tasksWrite],
      body: t.Object({
        description: t.String({ minLength: 1, maxLength: 500 }),
        passive: t.Optional(t.Boolean()),
        durationMinutes: t.Optional(t.Integer({ minimum: 1, maximum: 1440 })),
      }),
    },
  )
  .patch(
    '/households/:id/tasks/:taskId/steps/:stepId',
    async ({ params, body, claims }) => {
      const task = await toggleStep(
        params.id,
        params.taskId,
        params.stepId,
        body.isCompleted,
        await actor(claims!),
      );
      return success({ task });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.tasksWrite],
      body: t.Object({ isCompleted: t.Boolean() }),
    },
  )
  .post(
    '/households/:id/tasks/:taskId/steps/reorder',
    async ({ params, body }) => {
      const task = await reorderSteps(params.id, params.taskId, body.orderedStepIds);
      return success({ task });
    },
    {
      requireHousehold: 'id',
      requirePermissions: [Permissions.tasksWrite],
      body: t.Object({ orderedStepIds: t.Array(t.String(), { maxItems: 100 }) }),
    },
  )
  .delete(
    '/households/:id/tasks/:taskId/steps/:stepId',
    async ({ params }) => {
      const task = await deleteStep(params.id, params.taskId, params.stepId);
      return success({ task });
    },
    { requireHousehold: 'id', requirePermissions: [Permissions.tasksWrite] },
  );
