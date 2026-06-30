// Audit read service (EP-0051). Read-only, household-scoped (and system-scoped for platform
// admins) access to the EP-0009 action log + value-change history — filtered, paginated,
// newest-first, with actor-name enrichment, friendly action labels, and field redaction. The
// write path lives in src/audit (EP-0009); this only reads.

import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { isSystemActor } from '../../auth/scope.ts';
import { db } from '../../db/index.ts';
import { auditLogs, householdMembers, users, valueChangeHistory } from '../../db/schema/index.ts';

export interface ActorContext {
  userId: string;
  householdId: string;
  memberId: string | null;
  roles: string[];
}

const PAGE_SIZE = 50;

// Value-change fields that are masked for non-privileged (but allowed) viewers. password_hash
// is already stored presence-only by the write side, so it reads as '<redacted>' for everyone.
const SENSITIVE_FIELDS = new Set([
  'password_hash',
  'passwordHash',
  'valueNumeric',
  'valueSecondary',
  'dosageAmount',
  'balance',
  'amount',
  'currentBalance',
  'availableBalance',
]);
const MASK = '<hidden>';

/** Privileged = a system actor or the household Owner (sees raw sensitive values + ip/ua). */
export async function isPrivileged(ctx: ActorContext): Promise<boolean> {
  if (isSystemActor(ctx.roles)) return true;
  if (!ctx.memberId) return false;
  const [member] = await db
    .select({ isOwner: householdMembers.isOwner })
    .from(householdMembers)
    .where(eq(householdMembers.id, ctx.memberId))
    .limit(1);
  return member?.isOwner === true;
}

/** Humanize an action string: 'household.invite_created' → 'Household · invite created'. */
function actionLabel(action: string): string {
  const [group, rest] = action.includes('.') ? action.split('.', 2) : ['', action];
  const human = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return group ? `${human(group)} · ${(rest ?? '').replace(/_/g, ' ')}` : human(action);
}

/** Resolve actor ids to a display name (member name preferred, else user name). */
async function nameResolver(
  memberIds: (string | null)[],
  userIds: (string | null)[],
): Promise<(memberId: string | null, userId: string | null) => string | null> {
  const mIds = [...new Set(memberIds.filter((v): v is string => !!v))];
  const uIds = [...new Set(userIds.filter((v): v is string => !!v))];
  const memberNames = new Map<string, string>();
  const userNames = new Map<string, string>();
  for (const id of mIds) {
    const [m] = await db
      .select({ name: householdMembers.displayName })
      .from(householdMembers)
      .where(eq(householdMembers.id, id))
      .limit(1);
    if (m) memberNames.set(id, m.name);
  }
  for (const id of uIds) {
    const [u] = await db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (u) userNames.set(id, u.name);
  }
  return (memberId, userId) =>
    (memberId ? memberNames.get(memberId) : null) ??
    (userId ? userNames.get(userId) : null) ??
    null;
}

export interface AuditLogFilter {
  actor?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page?: number;
}

export async function listAuditLogs(ctx: ActorContext, filter: AuditLogFilter) {
  const privileged = await isPrivileged(ctx);
  const conditions = [eq(auditLogs.householdId, ctx.householdId)];
  if (filter.action) conditions.push(eq(auditLogs.action, filter.action));
  if (filter.entityType) conditions.push(eq(auditLogs.entityType, filter.entityType));
  if (filter.entityId) conditions.push(eq(auditLogs.entityId, filter.entityId));
  if (filter.actor) conditions.push(eq(auditLogs.actorUserId, filter.actor));
  if (filter.from) conditions.push(gte(auditLogs.createdAt, new Date(filter.from)));
  if (filter.to) conditions.push(lte(auditLogs.createdAt, new Date(filter.to)));

  const page = Math.max(1, filter.page ?? 1);
  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const resolve = await nameResolver(
    rows.map((r) => r.actorMemberId),
    rows.map((r) => r.actorUserId),
  );
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actionLabel: actionLabel(r.action),
    actorName: resolve(r.actorMemberId, r.actorUserId),
    actorUserId: r.actorUserId,
    entityType: r.entityType,
    entityId: r.entityId,
    metadata: r.metadata,
    // IP / user-agent only for privileged viewers.
    ipAddress: privileged ? r.ipAddress : null,
    userAgent: privileged ? r.userAgent : null,
    createdAt: r.createdAt,
  }));
}

export interface ValueChangeFilter {
  entityType?: string;
  entityId?: string;
  field?: string;
  from?: string;
  to?: string;
  page?: number;
}

export async function listValueChanges(ctx: ActorContext, filter: ValueChangeFilter) {
  const privileged = await isPrivileged(ctx);
  const conditions = [eq(valueChangeHistory.householdId, ctx.householdId)];
  if (filter.entityType) conditions.push(eq(valueChangeHistory.entityType, filter.entityType));
  if (filter.entityId) conditions.push(eq(valueChangeHistory.entityId, filter.entityId));
  if (filter.field) conditions.push(eq(valueChangeHistory.fieldName, filter.field));
  if (filter.from) conditions.push(gte(valueChangeHistory.createdAt, new Date(filter.from)));
  if (filter.to) conditions.push(lte(valueChangeHistory.createdAt, new Date(filter.to)));

  const page = Math.max(1, filter.page ?? 1);
  const rows = await db
    .select()
    .from(valueChangeHistory)
    .where(and(...conditions))
    .orderBy(desc(valueChangeHistory.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const resolve = await nameResolver(
    [],
    rows.map((r) => r.changedBy),
  );
  return rows.map((r) => {
    const mask = SENSITIVE_FIELDS.has(r.fieldName) && !privileged;
    return {
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      fieldName: r.fieldName,
      oldValue: mask ? MASK : r.oldValue,
      newValue: mask ? MASK : r.newValue,
      redacted: mask,
      changedByName: resolve(null, r.changedBy),
      createdAt: r.createdAt,
    };
  });
}

export interface SystemLogFilter {
  action?: string;
  from?: string;
  to?: string;
  page?: number;
}

/** System-level events (household_id IS NULL) — only for system roles (gated at the route). */
export async function listSystemLogs(filter: SystemLogFilter) {
  const conditions = [isNull(auditLogs.householdId)];
  if (filter.action) conditions.push(eq(auditLogs.action, filter.action));
  if (filter.from) conditions.push(gte(auditLogs.createdAt, new Date(filter.from)));
  if (filter.to) conditions.push(lte(auditLogs.createdAt, new Date(filter.to)));
  const page = Math.max(1, filter.page ?? 1);
  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actionLabel: actionLabel(r.action),
    actorUserId: r.actorUserId,
    entityType: r.entityType,
    entityId: r.entityId,
    metadata: r.metadata,
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    createdAt: r.createdAt,
  }));
}
