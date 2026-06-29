// Task Replacement Model (context §5): recurring_tasks, tasks, task_workflow_steps — each
// 1:1 with a scheduled_items row. Recurring tasks carry generation boundaries
// (last_generated_at + generate_ahead_days) so the worker (EP-0022) never spawns duplicates.

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { householdMembers } from './households.ts';
import { scheduledItems } from './scheduled-items.ts';

export const recurringTasks = pgTable('recurring_tasks', {
  id: uuid().primaryKey().defaultRandom(),
  scheduledItemId: uuid()
    .notNull()
    .unique()
    .references(() => scheduledItems.id),
  rotationPool: uuid().array(), // ordered member ids; null ⇒ fixed assignment
  rotationIndex: integer().notNull().default(0),
  assignmentCount: integer(), // N for N-of-M assignment; null ⇒ single/all
  generateAheadDays: integer().notNull().default(30),
  lastGeneratedAt: timestamp({ withTimezone: true }),
  rewardRuleId: uuid(),
  isActive: boolean().notNull().default(true),
});

export const tasks = pgTable(
  'tasks',
  {
    id: uuid().primaryKey().defaultRandom(),
    scheduledItemId: uuid()
      .notNull()
      .unique()
      .references(() => scheduledItems.id),
    recurringTaskId: uuid().references(() => recurringTasks.id), // null ⇒ ad hoc/standalone
    occurrenceDate: date(),
    assignedTo: uuid().references(() => householdMembers.id),
    status: text().notNull().default('pending'),
    completedAt: timestamp({ withTimezone: true }),
    completedBy: uuid(),
    requiresApproval: boolean().notNull().default(false),
    rewardRuleId: uuid(), // overrides the recurring rule
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'tasks_status_chk',
      sql`${t.status} in ('pending','in_progress','completed','skipped','cancelled')`,
    ),
    // No duplicate generated instance per (recurring task, occurrence date).
    unique('tasks_recurring_occurrence_uq').on(t.recurringTaskId, t.occurrenceDate),
  ],
);

export const taskWorkflowSteps = pgTable(
  'task_workflow_steps',
  {
    id: uuid().primaryKey().defaultRandom(),
    taskId: uuid()
      .notNull()
      .references(() => tasks.id),
    stepOrder: integer().notNull(),
    description: text().notNull(),
    isCompleted: boolean().notNull().default(false),
    completedAt: timestamp({ withTimezone: true }),
    completedBy: uuid(),
    passive: boolean().notNull().default(false),
    durationMinutes: integer(),
  },
  (t) => [unique('task_workflow_steps_task_order_uq').on(t.taskId, t.stepOrder)],
);
