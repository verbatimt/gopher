// Scheduling enums and type semantics (Gopher's design).

export const ScheduledItemTypes = {
  appointment: 'appointment',
  event: 'event',
  recurringTask: 'recurring_task',
  task: 'task',
} as const;

export const Visibility = {
  personal: 'personal',
  family: 'family',
} as const;

export const TimeOfDay = {
  anytime: 'anytime',
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
  custom: 'custom',
} as const;

/** Task occurrence/state values. Appointments & events cannot be completed/skipped. */
export const TaskStatus = {
  pending: 'pending',
  inProgress: 'in_progress',
  completed: 'completed',
  skipped: 'skipped',
  cancelled: 'cancelled',
} as const;

export type TaskStatusValue = (typeof TaskStatus)[keyof typeof TaskStatus];

/** Default standalone-task duration (minutes). */
export const DEFAULT_TASK_DURATION_MINUTES = 30;
