// Schema barrel: one file per aggregate, all re-exported here so the Drizzle client and
// drizzle-kit see the full schema. New aggregate files are added with an export line.

export * from './_demo.ts';
export * from './audit-logs.ts';
export * from './biometrics.ts';
export * from './finance/index.ts';
export * from './finance-ext/index.ts';
export * from './groceries.ts';
export * from './household-invites.ts';
export * from './households.ts';
export * from './inventory.ts';
export * from './meal-plans.ts';
export * from './medications.ts';
export * from './notifications.ts';
export * from './occurrence-overrides.ts';
export * from './recipes.ts';
export * from './reward-rules.ts';
export * from './rewards.ts';
export * from './role-permissions.ts';
export * from './roles.ts';
export * from './scheduled-items.ts';
export * from './scheduling-tags.ts';
export * from './tasks.ts';
export * from './time-windows.ts';
export * from './user-roles.ts';
export * from './user-sessions.ts';
export * from './users.ts';
export * from './value-change-history.ts';
