// Notification type catalog (Gopher's). Modules pass one of these to `notify`; call sites
// reference the constant, never a literal.

export const NotificationTypes = {
  taskDue: 'task.due',
  taskAssigned: 'task.assigned',
  taskCompleted: 'task.completed',
  medicationReminder: 'medication.reminder',
  medicationRefillNeeded: 'medication.refill_needed',
  rewardEarned: 'reward.earned',
  rewardRedemptionStatus: 'reward.redemption_status',
  calendarReminder: 'calendar.reminder',
  invitationAccepted: 'invitation.accepted',
} as const;

export type NotificationType = (typeof NotificationTypes)[keyof typeof NotificationTypes];
