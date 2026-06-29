// Dashboard aggregation (EP-0031). Assembles each active module's at-a-glance data into one
// payload, composing from existing module services. Sections are conditionally included by the
// household's active_modules and the caller's role; each section is computed independently and
// degrades to empty/omitted on failure (one slow/failing section never fails the whole
// response). Payloads are lean (ids + summaries) — deep data lives behind the module screens.

import { and, desc, eq } from 'drizzle-orm';
import type { AuthClaims } from '../../auth/context.ts';
import { hasPermission, Permissions, permissionsForRoles } from '../../auth/permissions.ts';
import { medicationScope, scopedToSelf } from '../../auth/visibility.ts';
import { db } from '../../db/index.ts';
import {
  households,
  mealPlanEntries,
  mealPlans,
  medicationSchedules,
  notifications,
  rewardTransactions,
} from '../../db/schema/index.ts';
import { expandRRuleString } from '../../recurrence/rrule.ts';
import { expandCalendar } from '../calendar/service.ts';
import { resolveMemberId } from '../households/service.ts';
import { getBalance } from '../rewards/service.ts';
import { listTasks } from '../tasks/service.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Run a section builder, degrading to `fallback` (omitted later if null) on any error. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function weekStartOf(date: Date): string {
  const sunday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - date.getUTCDay()),
  );
  return sunday.toISOString().slice(0, 10);
}

export interface DashboardResult {
  sections: Record<string, unknown>;
}

export async function buildDashboard(claims: AuthClaims): Promise<DashboardResult> {
  const householdId = claims.householdId;
  const roles = claims.roles;
  const memberId = householdId ? await resolveMemberId(householdId, claims.userId) : null;
  const supervisedOnly = scopedToSelf(roles);

  const [household] = householdId
    ? await db.select().from(households).where(eq(households.id, householdId)).limit(1)
    : [];
  const active = new Set(household?.activeModules ?? []);
  const granted = permissionsForRoles(roles);

  const now = new Date();
  const sections: Record<string, unknown> = {};

  // --- Notifications (foundation; always present) ---
  sections.notifications = await safe(
    async () => {
      if (!memberId) return { unreadCount: 0, recent: [] };
      const recent = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientMemberId, memberId))
        .orderBy(desc(notifications.createdAt))
        .limit(5);
      const unreadCount = recent.filter((n) => !n.isRead).length;
      return {
        unreadCount,
        recent: recent.map((n) => ({ id: n.id, type: n.type, title: n.title, isRead: n.isRead })),
      };
    },
    { unreadCount: 0, recent: [] },
  );

  // --- Calendar: next 7 days ---
  if (active.has('calendar')) {
    sections.calendar = await safe(
      async () => {
        const occ = await expandCalendar(householdId, now, new Date(now.getTime() + 7 * DAY_MS), {
          memberId,
          userId: claims.userId,
          supervisedOnly,
        });
        return { upcoming: occ.slice(0, 10) };
      },
      { upcoming: [] },
    );
  }

  // --- Tasks: pending/overdue ---
  if (active.has('tasks')) {
    sections.tasks = await safe(
      async () => {
        const pending = await listTasks(
          householdId,
          { status: 'pending' },
          { userId: claims.userId, householdId, memberId, roles },
        );
        const overdue = pending.filter(
          (t) => t.dueDate != null && new Date(t.dueDate) < now,
        ).length;
        return { pendingCount: pending.length, overdueCount: overdue, items: pending.slice(0, 5) };
      },
      { pendingCount: 0, overdueCount: 0, items: [] },
    );
  }

  // --- Medications: reminders in the next 24h (RRULE-derived, read-only) ---
  if (active.has('medications')) {
    sections.medications = await safe(
      async () => {
        const scope = medicationScope(roles);
        const conditions = [
          eq(medicationSchedules.householdId, householdId),
          eq(medicationSchedules.isActive, true),
        ];
        if (scope === 'self') {
          conditions.push(
            eq(medicationSchedules.memberId, memberId ?? '00000000-0000-0000-0000-000000000000'),
          );
        }
        const schedules = await db
          .select()
          .from(medicationSchedules)
          .where(and(...conditions));
        const upcoming: Array<{ scheduleId: string; medicationName: string; scheduledAt: string }> =
          [];
        for (const s of schedules) {
          for (const at of expandRRuleString(s.rrule, now, new Date(now.getTime() + DAY_MS))) {
            upcoming.push({
              scheduleId: s.id,
              medicationName: s.medicationName,
              scheduledAt: at.toISOString(),
            });
          }
        }
        upcoming.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
        return { dueCount: upcoming.length, items: upcoming.slice(0, 5) };
      },
      { dueCount: 0, items: [] },
    );
  }

  // --- Rewards: balance + pending redemptions ---
  if (active.has('rewards')) {
    sections.rewards = await safe(
      async () => {
        if (!memberId) return { balance: 0, pendingRedemptions: 0 };
        const balance = await getBalance(
          { userId: claims.userId, householdId, memberId, roles },
          memberId,
        );
        const pending = await db
          .select({ id: rewardTransactions.id })
          .from(rewardTransactions)
          .where(
            and(
              eq(rewardTransactions.memberId, memberId),
              eq(rewardTransactions.type, 'redeem'),
              eq(rewardTransactions.status, 'pending'),
            ),
          );
        return { balance: balance.balance, pendingRedemptions: pending.length };
      },
      { balance: 0, pendingRedemptions: 0 },
    );
  }

  // --- Meals: today + tomorrow ---
  if (active.has('meals')) {
    sections.meals = await safe(
      async () => {
        const weekStart = weekStartOf(now);
        const [plan] = await db
          .select()
          .from(mealPlans)
          .where(
            and(eq(mealPlans.householdId, householdId), eq(mealPlans.weekStartDate, weekStart)),
          )
          .limit(1);
        if (!plan) return { entries: [] };
        const today = now.getUTCDay();
        const tomorrow = (today + 1) % 7;
        const entries = await db
          .select()
          .from(mealPlanEntries)
          .where(eq(mealPlanEntries.mealPlanId, plan.id));
        return {
          entries: entries
            .filter((e) => e.dayOfWeek === today || e.dayOfWeek === tomorrow)
            .map((e) => ({ dayOfWeek: e.dayOfWeek, mealType: e.mealType, mealName: e.mealName })),
        };
      },
      { entries: [] },
    );
  }

  // --- Finance: headline (only with finance:read; module built in Tier 6) ---
  if (active.has('finance') && hasPermission(granted, Permissions.financeRead)) {
    sections.finance = await safe(async () => ({ available: false, netWorth: null }), {
      available: false,
      netWorth: null,
    });
  }

  return { sections };
}
