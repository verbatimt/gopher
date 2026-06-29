// Task Replacement Model business logic (EP-0021): recurring-task + ad-hoc task CRUD,
// completion (with supervised approval), workflow steps (auto-complete + contiguous
// reorder), role-aware listing, and WS/notification emissions.

import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { scopedToSelf } from '../../auth/visibility.ts';
import { db, type Tx, withTransaction } from '../../db/index.ts';
import { recurringTasks, scheduledItems, tasks, taskWorkflowSteps } from '../../db/schema/index.ts';
import { ConflictError, NotFoundError } from '../../http/errors.ts';
import { broadcast } from '../../realtime/bus.ts';
import { householdChannel, RealtimeEvents } from '../../realtime/events.ts';
import { toRRuleString } from '../../recurrence/rrule.ts';
import type { RecurrenceInput } from '../calendar/service.ts';
import { notify } from '../notifications/notify.ts';
import { NotificationTypes } from '../notifications/types.ts';
import { awardTaskCompletion } from '../rewards/service.ts';

/** Effective reward rule for a task: task-level overrides the recurring-series rule (EP-0028). */
async function resolveRuleId(tx: Tx, task: typeof tasks.$inferSelect): Promise<string | null> {
  if (task.rewardRuleId) return task.rewardRuleId;
  if (task.recurringTaskId) {
    const [rt] = await tx
      .select({ rid: recurringTasks.rewardRuleId })
      .from(recurringTasks)
      .where(eq(recurringTasks.id, task.recurringTaskId))
      .limit(1);
    return rt?.rid ?? null;
  }
  return null;
}

export interface ActorContext {
  userId: string;
  householdId: string;
  memberId: string | null;
  roles: string[];
}

const isSupervised = scopedToSelf;

function buildRrule(
  recurrence: RecurrenceInput,
  dtstart: Date,
): { rrule: string; until: Date | null } {
  const end = recurrence.end;
  const spec =
    end?.kind === 'until' && end.until
      ? {
          frequency: recurrence.frequency,
          interval: recurrence.interval,
          end: { kind: 'until' as const, until: new Date(end.until) },
        }
      : end?.kind === 'count' && end.count
        ? {
            frequency: recurrence.frequency,
            interval: recurrence.interval,
            end: { kind: 'count' as const, count: end.count },
          }
        : {
            frequency: recurrence.frequency,
            interval: recurrence.interval,
            end: { kind: 'ongoing' as const },
          };
  return {
    rrule: toRRuleString(spec, dtstart),
    until: end?.kind === 'until' && end.until ? new Date(end.until) : null,
  };
}

// --- Recurring tasks ---

export interface CreateRecurringInput {
  title: string;
  description?: string;
  startsAt: string;
  unskippable?: boolean;
  recurrence: RecurrenceInput;
  rotationPool?: string[];
  assignmentCount?: number;
  /** Fixed assignee used when there is no rotation pool. */
  assignedTo?: string;
  generateAheadDays?: number;
  rewardRuleId?: string;
}

export async function createRecurringTask(
  householdId: string,
  createdBy: string,
  input: CreateRecurringInput,
) {
  const startsAt = new Date(input.startsAt);
  const { rrule, until } = buildRrule(input.recurrence, startsAt);
  return withTransaction(async (tx) => {
    const [item] = await tx
      .insert(scheduledItems)
      .values({
        householdId,
        type: 'recurring_task',
        title: input.title,
        description: input.description ?? null,
        startsAt,
        allDay: true,
        rrule,
        rruleUntil: until,
        unskippable: input.unskippable ?? false,
        assigneeMemberId: input.assignedTo ?? null,
        createdBy,
      })
      .returning();
    const [recurring] = await tx
      .insert(recurringTasks)
      .values({
        scheduledItemId: item!.id,
        rotationPool: input.rotationPool ?? null,
        assignmentCount: input.assignmentCount ?? null,
        generateAheadDays: input.generateAheadDays ?? 30,
        rewardRuleId: input.rewardRuleId ?? null,
      })
      .returning();
    return { item: item!, recurring: recurring! };
  });
}

export async function listRecurringTasks(householdId: string) {
  return db
    .select({ recurring: recurringTasks, item: scheduledItems })
    .from(recurringTasks)
    .innerJoin(scheduledItems, eq(scheduledItems.id, recurringTasks.scheduledItemId))
    .where(and(eq(scheduledItems.householdId, householdId), eq(scheduledItems.isActive, true)));
}

export async function deleteRecurringTask(householdId: string, recurringId: string): Promise<void> {
  const [row] = await db
    .select({ recurring: recurringTasks, item: scheduledItems })
    .from(recurringTasks)
    .innerJoin(scheduledItems, eq(scheduledItems.id, recurringTasks.scheduledItemId))
    .where(and(eq(recurringTasks.id, recurringId), eq(scheduledItems.householdId, householdId)))
    .limit(1);
  if (!row) throw new NotFoundError('Recurring task not found.');
  await withTransaction(async (tx) => {
    await tx
      .update(recurringTasks)
      .set({ isActive: false })
      .where(eq(recurringTasks.id, recurringId));
    await tx
      .update(scheduledItems)
      .set({ isActive: false, deletedAt: new Date() })
      .where(eq(scheduledItems.id, row.item.id));
  });
}

// --- Tasks ---

export interface CreateTaskInput {
  title: string;
  description?: string;
  startsAt: string;
  assignedTo?: string;
  unskippable?: boolean;
  requiresApproval?: boolean;
}

function taskDto(task: typeof tasks.$inferSelect, item: typeof scheduledItems.$inferSelect) {
  return {
    id: task.id,
    scheduledItemId: item.id,
    recurringTaskId: task.recurringTaskId,
    title: item.title,
    description: item.description,
    dueDate: item.startsAt,
    allDay: item.allDay,
    unskippable: item.unskippable,
    status: task.status,
    assignedTo: task.assignedTo,
    completedAt: task.completedAt,
    completedBy: task.completedBy,
    requiresApproval: task.requiresApproval,
  };
}

export async function createTask(householdId: string, createdBy: string, input: CreateTaskInput) {
  return withTransaction(async (tx) => {
    const [item] = await tx
      .insert(scheduledItems)
      .values({
        householdId,
        type: 'task',
        title: input.title,
        description: input.description ?? null,
        startsAt: new Date(input.startsAt),
        allDay: true,
        unskippable: input.unskippable ?? false,
        assigneeMemberId: input.assignedTo ?? null,
        createdBy,
      })
      .returning();
    const [task] = await tx
      .insert(tasks)
      .values({
        scheduledItemId: item!.id,
        assignedTo: input.assignedTo ?? null,
        requiresApproval: input.requiresApproval ?? false,
      })
      .returning();
    return taskDto(task!, item!);
  });
}

export interface TaskFilters {
  status?: string;
  assignedTo?: string;
  from?: string;
  to?: string;
  page?: number;
}

export async function listTasks(householdId: string, filters: TaskFilters, ctx: ActorContext) {
  const conditions = [
    eq(scheduledItems.householdId, householdId),
    eq(scheduledItems.isActive, true),
  ];
  if (filters.status) conditions.push(eq(tasks.status, filters.status));
  // Supervised users only ever see their own tasks (server is authoritative).
  if (isSupervised(ctx.roles)) {
    conditions.push(eq(tasks.assignedTo, ctx.memberId ?? '00000000-0000-0000-0000-000000000000'));
  } else if (filters.assignedTo) {
    conditions.push(eq(tasks.assignedTo, filters.assignedTo));
  }
  if (filters.from) conditions.push(gte(scheduledItems.startsAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(scheduledItems.startsAt, new Date(filters.to)));

  const pageSize = 50;
  const page = Math.max(1, filters.page ?? 1);
  const rows = await db
    .select({ task: tasks, item: scheduledItems })
    .from(tasks)
    .innerJoin(scheduledItems, eq(scheduledItems.id, tasks.scheduledItemId))
    .where(and(...conditions))
    .orderBy(asc(scheduledItems.startsAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return rows.map((r) => taskDto(r.task, r.item));
}

async function loadTask(householdId: string, taskId: string) {
  const [row] = await db
    .select({ task: tasks, item: scheduledItems })
    .from(tasks)
    .innerJoin(scheduledItems, eq(scheduledItems.id, tasks.scheduledItemId))
    .where(and(eq(tasks.id, taskId), eq(scheduledItems.householdId, householdId)))
    .limit(1);
  return row ?? null;
}

export async function getTask(householdId: string, taskId: string) {
  const row = await loadTask(householdId, taskId);
  if (!row) return null;
  const steps = await db
    .select()
    .from(taskWorkflowSteps)
    .where(eq(taskWorkflowSteps.taskId, taskId))
    .orderBy(asc(taskWorkflowSteps.stepOrder));
  return { ...taskDto(row.task, row.item), steps };
}

export interface TaskPatch {
  title?: string;
  description?: string;
  startsAt?: string;
  assignedTo?: string;
  status?: string;
}

export async function updateTask(householdId: string, taskId: string, patch: TaskPatch) {
  const row = await loadTask(householdId, taskId);
  if (!row) throw new NotFoundError('Task not found.');

  if (patch.status === 'skipped' && row.item.unskippable) {
    throw new ConflictError('This task cannot be skipped.');
  }

  await withTransaction(async (tx) => {
    const itemUpdates: Partial<typeof scheduledItems.$inferInsert> = { updatedAt: new Date() };
    if (patch.title !== undefined) itemUpdates.title = patch.title;
    if (patch.description !== undefined) itemUpdates.description = patch.description;
    if (patch.startsAt !== undefined) itemUpdates.startsAt = new Date(patch.startsAt);
    if (patch.assignedTo !== undefined) itemUpdates.assigneeMemberId = patch.assignedTo;
    await tx.update(scheduledItems).set(itemUpdates).where(eq(scheduledItems.id, row.item.id));

    const taskUpdates: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
    if (patch.assignedTo !== undefined) taskUpdates.assignedTo = patch.assignedTo;
    if (patch.status !== undefined) taskUpdates.status = patch.status;
    await tx.update(tasks).set(taskUpdates).where(eq(tasks.id, taskId));

    // Approving a task (status → completed, e.g. a supervisor verifying) finalizes any
    // reserved earn and credits points — atomic with the status change (EP-0028).
    if (patch.status === 'completed') {
      await awardTaskCompletion(tx, {
        householdId,
        taskId,
        memberId: patch.assignedTo ?? row.task.assignedTo,
        ruleId: await resolveRuleId(tx, row.task),
        asPending: false,
        by: null,
      });
    }
  });

  if (patch.assignedTo !== undefined && patch.assignedTo) {
    await notify({
      householdId,
      recipientMemberId: patch.assignedTo,
      type: NotificationTypes.taskAssigned,
      title: 'A task was assigned to you',
      body: row.item.title,
      sourceEntityType: 'task',
      sourceEntityId: taskId,
    });
    await broadcast(householdChannel(householdId), {
      type: RealtimeEvents.taskUpdated,
      payload: { taskId, event: 'assigned' },
    });
  }
  if (patch.status !== undefined) {
    await broadcast(householdChannel(householdId), {
      type: RealtimeEvents.taskUpdated,
      payload: { taskId, status: patch.status },
    });
  }
  return getTask(householdId, taskId);
}

/** Complete a task. Supervised users with `requiresApproval` enter pending-verification. */
export async function completeTask(householdId: string, taskId: string, ctx: ActorContext) {
  const row = await loadTask(householdId, taskId);
  if (!row) throw new NotFoundError('Task not found.');

  const pendingVerification = isSupervised(ctx.roles) && row.task.requiresApproval;
  const status = pendingVerification ? 'in_progress' : 'completed';
  await withTransaction(async (tx) => {
    await tx
      .update(tasks)
      .set({
        status,
        completedAt: pendingVerification ? null : new Date(),
        completedBy: ctx.memberId,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));

    // Credit reward points atomically with completion. A task requiring verification
    // reserves a pending earn (credited on approval); otherwise points land now. (EP-0028)
    await awardTaskCompletion(tx, {
      householdId,
      taskId,
      memberId: row.task.assignedTo ?? ctx.memberId,
      ruleId: await resolveRuleId(tx, row.task),
      asPending: pendingVerification,
      by: ctx.userId,
    });
  });

  await broadcast(householdChannel(householdId), {
    type: pendingVerification ? RealtimeEvents.taskUpdated : RealtimeEvents.notificationNew,
    payload: { taskId, status },
  });
  if (!pendingVerification) {
    await broadcast(householdChannel(householdId), {
      type: RealtimeEvents.taskUpdated,
      payload: { taskId, status: 'completed' },
    });
  }
  return getTask(householdId, taskId);
}

// --- Workflow steps ---

export async function addStep(
  householdId: string,
  taskId: string,
  input: { description: string; passive?: boolean; durationMinutes?: number },
) {
  const row = await loadTask(householdId, taskId);
  if (!row) throw new NotFoundError('Task not found.');
  const existing = await db
    .select({ stepOrder: taskWorkflowSteps.stepOrder })
    .from(taskWorkflowSteps)
    .where(eq(taskWorkflowSteps.taskId, taskId));
  const nextOrder = existing.reduce((max, s) => Math.max(max, s.stepOrder), 0) + 1;
  const [step] = await db
    .insert(taskWorkflowSteps)
    .values({
      taskId,
      stepOrder: nextOrder,
      description: input.description,
      passive: input.passive ?? false,
      durationMinutes: input.durationMinutes ?? null,
    })
    .returning();
  return step!;
}

/** Toggle a step; when all (non-passive) steps are complete, auto-complete the parent. */
export async function toggleStep(
  householdId: string,
  taskId: string,
  stepId: string,
  isCompleted: boolean,
  ctx: ActorContext,
) {
  const row = await loadTask(householdId, taskId);
  if (!row) throw new NotFoundError('Task not found.');
  await db
    .update(taskWorkflowSteps)
    .set({
      isCompleted,
      completedAt: isCompleted ? new Date() : null,
      completedBy: isCompleted ? ctx.memberId : null,
    })
    .where(and(eq(taskWorkflowSteps.id, stepId), eq(taskWorkflowSteps.taskId, taskId)));

  const steps = await db
    .select()
    .from(taskWorkflowSteps)
    .where(eq(taskWorkflowSteps.taskId, taskId));
  const active = steps.filter((s) => !s.passive);
  const allDone = active.length > 0 && active.every((s) => s.isCompleted);
  if (allDone && row.task.status !== 'completed') {
    await db
      .update(tasks)
      .set({
        status: 'completed',
        completedAt: new Date(),
        completedBy: ctx.memberId,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));
    await broadcast(householdChannel(householdId), {
      type: RealtimeEvents.taskUpdated,
      payload: { taskId, status: 'completed' },
    });
  }
  return getTask(householdId, taskId);
}

export async function reorderSteps(householdId: string, taskId: string, orderedStepIds: string[]) {
  const row = await loadTask(householdId, taskId);
  if (!row) throw new NotFoundError('Task not found.');
  await withTransaction(async (tx) => {
    // Two-phase to avoid unique collisions: offset, then set final 1..n.
    let offset = 1000;
    for (const id of orderedStepIds) {
      await tx
        .update(taskWorkflowSteps)
        .set({ stepOrder: offset++ })
        .where(and(eq(taskWorkflowSteps.id, id), eq(taskWorkflowSteps.taskId, taskId)));
    }
    let order = 1;
    for (const id of orderedStepIds) {
      await tx
        .update(taskWorkflowSteps)
        .set({ stepOrder: order++ })
        .where(and(eq(taskWorkflowSteps.id, id), eq(taskWorkflowSteps.taskId, taskId)));
    }
  });
  return getTask(householdId, taskId);
}

export async function deleteStep(householdId: string, taskId: string, stepId: string) {
  const row = await loadTask(householdId, taskId);
  if (!row) throw new NotFoundError('Task not found.');
  await withTransaction(async (tx) => {
    await tx
      .delete(taskWorkflowSteps)
      .where(and(eq(taskWorkflowSteps.id, stepId), eq(taskWorkflowSteps.taskId, taskId)));
    const remaining = await tx
      .select()
      .from(taskWorkflowSteps)
      .where(eq(taskWorkflowSteps.taskId, taskId))
      .orderBy(asc(taskWorkflowSteps.stepOrder));
    let offset = 1000;
    for (const s of remaining) {
      await tx
        .update(taskWorkflowSteps)
        .set({ stepOrder: offset++ })
        .where(eq(taskWorkflowSteps.id, s.id));
    }
    let order = 1;
    for (const s of remaining) {
      await tx
        .update(taskWorkflowSteps)
        .set({ stepOrder: order++ })
        .where(eq(taskWorkflowSteps.id, s.id));
    }
  });
  return getTask(householdId, taskId);
}
