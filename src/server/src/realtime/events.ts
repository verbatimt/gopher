// Real-time event taxonomy + channel naming. Feature EPs emit these via `broadcast`
// (realtime/bus.ts); the single emission point keeps modules off the sockets directly.

export const RealtimeEvents = {
  taskUpdated: 'task.updated',
  calendarChanged: 'calendar.changed',
  medicationReminder: 'medication.reminder',
  rewardUpdated: 'reward.updated',
  notificationNew: 'notification.new',
  mealsChanged: 'meals.changed',
  financeChanged: 'finance.changed',
} as const;

export type RealtimeEventType = (typeof RealtimeEvents)[keyof typeof RealtimeEvents];

export interface RealtimeEvent {
  type: string;
  payload?: unknown;
}

export const householdChannel = (householdId: string) => `household:${householdId}`;
export const userChannel = (memberId: string) => `user:${memberId}`;
