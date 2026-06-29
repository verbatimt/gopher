// Rewards business logic (EP-0027): point rules, per-member balances, a redeemable catalog,
// and an approval-gated transaction ledger. Every balance mutation runs inside a row-locked
// transaction, writes `balance_after`, and records a value-change (sensitive field) so
// balances never go negative or diverge. `recordTransaction` is the shared primitive the
// task-completion earn hook + allowance granter (EP-0028) reuse.

import { and, desc, eq, gt, ne, sql } from 'drizzle-orm';
import { recordValueChange } from '../../audit/value-change.ts';
import { effectiveRole } from '../../auth/visibility.ts';
import { db, type Tx, withTransaction } from '../../db/index.ts';
import {
  householdMembers,
  rewardAllowances,
  rewardRules,
  rewardStoreItems,
  rewards,
  rewardTransactions,
} from '../../db/schema/index.ts';
import { ConflictError, ForbiddenError, InvalidError, NotFoundError } from '../../http/errors.ts';
import { broadcast } from '../../realtime/bus.ts';
import { RealtimeEvents, userChannel } from '../../realtime/events.ts';
import { withDtstart } from '../../recurrence/rrule.ts';
import { notify } from '../notifications/notify.ts';
import { NotificationTypes } from '../notifications/types.ts';

export interface ActorContext {
  userId: string;
  householdId: string;
  memberId: string | null;
  roles: string[];
}

const PAGE_SIZE = 50;

function isSupervisor(roles: string[]): boolean {
  const role = effectiveRole(roles);
  return role === 'supervising' || role === 'system';
}

function assertSupervisor(roles: string[]): void {
  if (!isSupervisor(roles)) throw new ForbiddenError('Only supervisors can manage rewards.');
}

async function assertMemberInHousehold(householdId: string, memberId: string): Promise<void> {
  const [m] = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(and(eq(householdMembers.id, memberId), eq(householdMembers.householdId, householdId)))
    .limit(1);
  if (!m) throw new NotFoundError('Member not found.');
}

// --- Balance primitive (shared with EP-0028) ---

/** Lock the member's rewards row (creating a zeroed one on first use). Must run in a tx. */
async function ensureRewards(database: Tx, householdId: string, memberId: string) {
  await database
    .insert(rewards)
    .values({ householdId, memberId })
    .onConflictDoNothing({ target: rewards.memberId });
  const [row] = await database
    .select()
    .from(rewards)
    .where(eq(rewards.memberId, memberId))
    .limit(1)
    .for('update');
  return row!;
}

export interface RecordTxParams {
  householdId: string;
  memberId: string;
  type: 'earn' | 'redeem' | 'adjustment';
  amount: number; // signed: +earn/+adjustment, −redeem
  status?: 'pending' | 'approved';
  taskId?: string | null;
  storeItemId?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

/**
 * Append a reward transaction. For `approved` it mutates balance + lifetime totals (guarding
 * against negative balance) and records the from→to value-change; for `pending` it reserves
 * nothing yet (balance unchanged) and stamps the current balance as `balance_after`. Returns
 * the inserted transaction row and the resulting balance. Must run inside a transaction.
 */
export async function recordTransaction(database: Tx, params: RecordTxParams) {
  const reward = await ensureRewards(database, params.householdId, params.memberId);
  const status = params.status ?? 'approved';
  let newBalance = reward.balance;

  if (status === 'approved') {
    newBalance = reward.balance + params.amount;
    if (newBalance < 0) throw new ConflictError('Insufficient balance.');
    const set: Partial<typeof rewards.$inferInsert> = {
      balance: newBalance,
      updatedAt: new Date(),
    };
    if (params.type === 'earn') set.lifetimeEarned = reward.lifetimeEarned + params.amount;
    if (params.type === 'redeem')
      set.lifetimeRedeemed = reward.lifetimeRedeemed + Math.abs(params.amount);
    await database.update(rewards).set(set).where(eq(rewards.id, reward.id));
    await recordValueChange(
      {
        entityType: 'reward',
        entityId: params.memberId,
        fieldName: 'balance',
        oldValue: String(reward.balance),
        newValue: String(newBalance),
        changedBy: params.createdBy ?? null,
        householdId: params.householdId,
      },
      database,
    );
  }

  const [tx] = await database
    .insert(rewardTransactions)
    .values({
      householdId: params.householdId,
      memberId: params.memberId,
      type: params.type,
      amount: params.amount,
      balanceAfter: newBalance,
      taskId: params.taskId ?? null,
      storeItemId: params.storeItemId ?? null,
      status,
      notes: params.notes ?? null,
      createdBy: params.createdBy ?? null,
    })
    .returning();
  return { tx: tx!, balance: newBalance };
}

async function emitBalance(memberId: string, balance: number): Promise<void> {
  await broadcast(userChannel(memberId), {
    type: RealtimeEvents.rewardUpdated,
    payload: { memberId, balance },
  });
}

// --- Reward rules ---

export async function createRule(ctx: ActorContext, input: { name: string; points: number }) {
  assertSupervisor(ctx.roles);
  const [row] = await db
    .insert(rewardRules)
    .values({ householdId: ctx.householdId, name: input.name, points: input.points })
    .returning();
  return row!;
}

export async function listRules(ctx: ActorContext) {
  return db
    .select()
    .from(rewardRules)
    .where(and(eq(rewardRules.householdId, ctx.householdId), eq(rewardRules.isActive, true)));
}

/** Resolve a rule by id regardless of active state (referencing tasks must still resolve). */
export async function getRule(ctx: ActorContext, ruleId: string) {
  const [row] = await db
    .select()
    .from(rewardRules)
    .where(and(eq(rewardRules.id, ruleId), eq(rewardRules.householdId, ctx.householdId)))
    .limit(1);
  if (!row) throw new NotFoundError('Reward rule not found.');
  return row;
}

export async function updateRule(
  ctx: ActorContext,
  ruleId: string,
  patch: { name?: string; points?: number },
) {
  assertSupervisor(ctx.roles);
  const [row] = await db
    .update(rewardRules)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(rewardRules.id, ruleId), eq(rewardRules.householdId, ctx.householdId)))
    .returning();
  if (!row) throw new NotFoundError('Reward rule not found.');
  return row;
}

/** Soft-deactivate a rule; its id is preserved on any referencing tasks. */
export async function deleteRule(ctx: ActorContext, ruleId: string) {
  assertSupervisor(ctx.roles);
  const [row] = await db
    .update(rewardRules)
    .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(rewardRules.id, ruleId), eq(rewardRules.householdId, ctx.householdId)))
    .returning();
  if (!row) throw new NotFoundError('Reward rule not found.');
  return { deleted: true };
}

// --- Store catalog ---

export interface StoreItemInput {
  name: string;
  description?: string;
  pointCost: number;
  redemptionCap?: number;
  cooldownMinutes?: number;
}

export async function createItem(ctx: ActorContext, input: StoreItemInput) {
  assertSupervisor(ctx.roles);
  const [row] = await db
    .insert(rewardStoreItems)
    .values({
      householdId: ctx.householdId,
      name: input.name,
      description: input.description ?? null,
      pointCost: input.pointCost,
      redemptionCap: input.redemptionCap ?? null,
      cooldownMinutes: input.cooldownMinutes ?? null,
    })
    .returning();
  return row!;
}

export async function listItems(ctx: ActorContext) {
  return db
    .select()
    .from(rewardStoreItems)
    .where(
      and(eq(rewardStoreItems.householdId, ctx.householdId), eq(rewardStoreItems.isActive, true)),
    )
    .orderBy(rewardStoreItems.pointCost);
}

export async function updateItem(
  ctx: ActorContext,
  itemId: string,
  patch: Partial<StoreItemInput>,
) {
  assertSupervisor(ctx.roles);
  const [row] = await db
    .update(rewardStoreItems)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(rewardStoreItems.id, itemId), eq(rewardStoreItems.householdId, ctx.householdId)))
    .returning();
  if (!row) throw new NotFoundError('Store item not found.');
  return row;
}

export async function deleteItem(ctx: ActorContext, itemId: string) {
  assertSupervisor(ctx.roles);
  const [row] = await db
    .update(rewardStoreItems)
    .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(rewardStoreItems.id, itemId), eq(rewardStoreItems.householdId, ctx.householdId)))
    .returning();
  if (!row) throw new NotFoundError('Store item not found.');
  return { deleted: true };
}

// --- Redemption ---

/** Member redeems an item for themselves → a `pending` redeem tx (or 409 if not allowed). */
export async function redeem(ctx: ActorContext, itemId: string) {
  const memberId = ctx.memberId;
  if (!memberId) throw new ForbiddenError('No member profile for this account.');

  const [item] = await db
    .select()
    .from(rewardStoreItems)
    .where(
      and(
        eq(rewardStoreItems.id, itemId),
        eq(rewardStoreItems.householdId, ctx.householdId),
        eq(rewardStoreItems.isActive, true),
      ),
    )
    .limit(1);
  if (!item) throw new NotFoundError('Store item not found.');

  if (item.redemptionCap !== null && item.redemptionCount >= item.redemptionCap) {
    throw new ConflictError('This reward has reached its redemption limit.');
  }
  if (item.cooldownMinutes !== null) {
    const since = new Date(Date.now() - item.cooldownMinutes * 60_000);
    const [recent] = await db
      .select({ id: rewardTransactions.id })
      .from(rewardTransactions)
      .where(
        and(
          eq(rewardTransactions.memberId, memberId),
          eq(rewardTransactions.storeItemId, itemId),
          eq(rewardTransactions.type, 'redeem'),
          gt(rewardTransactions.createdAt, since),
        ),
      )
      .limit(1);
    if (recent) throw new ConflictError('This reward was redeemed too recently. Try again later.');
  }

  return withTransaction(async (tx) => {
    const reward = await ensureRewards(tx, ctx.householdId, memberId);
    if (reward.balance < item.pointCost) {
      throw new ConflictError('Not enough points to redeem this reward.');
    }
    const result = await recordTransaction(tx, {
      householdId: ctx.householdId,
      memberId,
      type: 'redeem',
      amount: -item.pointCost,
      status: 'pending',
      storeItemId: itemId,
      createdBy: ctx.userId,
    });
    return result.tx;
  });
}

// --- Balance + history ---

function assertCanReadMember(ctx: ActorContext, memberId: string): void {
  if (!isSupervisor(ctx.roles) && ctx.memberId !== memberId) {
    throw new ForbiddenError('You can only view your own rewards.');
  }
}

export async function getBalance(ctx: ActorContext, memberId: string) {
  assertCanReadMember(ctx, memberId);
  const [row] = await db.select().from(rewards).where(eq(rewards.memberId, memberId)).limit(1);
  return {
    memberId,
    balance: row?.balance ?? 0,
    lifetimeEarned: row?.lifetimeEarned ?? 0,
    lifetimeRedeemed: row?.lifetimeRedeemed ?? 0,
  };
}

export async function listTransactions(ctx: ActorContext, memberId: string, page: number) {
  assertCanReadMember(ctx, memberId);
  return db
    .select()
    .from(rewardTransactions)
    .where(eq(rewardTransactions.memberId, memberId))
    .orderBy(desc(rewardTransactions.createdAt))
    .limit(PAGE_SIZE)
    .offset((Math.max(1, page) - 1) * PAGE_SIZE);
}

// --- Adjust (supervisor) ---

export async function adjust(
  ctx: ActorContext,
  memberId: string,
  input: { amount: number; notes: string },
) {
  assertSupervisor(ctx.roles);
  await assertMemberInHousehold(ctx.householdId, memberId);
  const result = await withTransaction((tx) =>
    recordTransaction(tx, {
      householdId: ctx.householdId,
      memberId,
      type: 'adjustment',
      amount: input.amount,
      status: 'approved',
      notes: input.notes,
      createdBy: ctx.userId,
    }),
  );
  await emitBalance(memberId, result.balance);
  return result.tx;
}

// --- Approve / reject pending transactions (supervisor) ---

export async function decideTransaction(
  ctx: ActorContext,
  txId: string,
  decision: 'approve' | 'reject',
) {
  assertSupervisor(ctx.roles);
  const decided = await withTransaction(async (tx) => {
    const [pending] = await tx
      .select()
      .from(rewardTransactions)
      .where(
        and(eq(rewardTransactions.id, txId), eq(rewardTransactions.householdId, ctx.householdId)),
      )
      .limit(1)
      .for('update');
    if (!pending) throw new NotFoundError('Transaction not found.');
    if (pending.status !== 'pending') {
      throw new ConflictError('This transaction has already been decided.');
    }

    if (decision === 'reject') {
      const [row] = await tx
        .update(rewardTransactions)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(eq(rewardTransactions.id, txId))
        .returning();
      return { tx: row!, balance: null as number | null };
    }

    // Approve: apply the reserved balance change now (re-checking limits + funds).
    const row = await applyApproval(tx, pending, ctx.userId);
    return { tx: row, balance: row.balanceAfter };
  });

  // Notify the affected member of the outcome (live + inbox).
  await notify({
    householdId: ctx.householdId,
    recipientMemberId: decided.tx.memberId,
    type: NotificationTypes.rewardRedemptionStatus,
    title: decision === 'approve' ? 'Redemption approved' : 'Redemption rejected',
    body: null,
    sourceEntityType: 'reward_transaction',
    sourceEntityId: decided.tx.id,
  });
  if (decided.balance !== null) {
    await emitBalance(decided.tx.memberId, decided.balance);
  }
  return decided.tx;
}

// ─────────────────────────────────────────────────────────────────────────────
// EP-0028 — task-completion earn hook + allowances
// ─────────────────────────────────────────────────────────────────────────────

/** Apply a pending transaction's reserved balance change (shared by approve + earn hook). */
async function applyApproval(
  tx: Tx,
  pending: typeof rewardTransactions.$inferSelect,
  by: string | null,
) {
  const reward = await ensureRewards(tx, pending.householdId, pending.memberId);
  const newBalance = reward.balance + pending.amount;
  if (newBalance < 0) throw new ConflictError('Insufficient balance to approve this transaction.');

  if (pending.type === 'redeem' && pending.storeItemId) {
    const [item] = await tx
      .select()
      .from(rewardStoreItems)
      .where(eq(rewardStoreItems.id, pending.storeItemId))
      .limit(1)
      .for('update');
    if (item && item.redemptionCap !== null && item.redemptionCount >= item.redemptionCap) {
      throw new ConflictError('This reward has reached its redemption limit.');
    }
    await tx
      .update(rewardStoreItems)
      .set({ redemptionCount: sql`${rewardStoreItems.redemptionCount} + 1`, updatedAt: new Date() })
      .where(eq(rewardStoreItems.id, pending.storeItemId));
  }

  const set: Partial<typeof rewards.$inferInsert> = { balance: newBalance, updatedAt: new Date() };
  if (pending.type === 'earn') set.lifetimeEarned = reward.lifetimeEarned + pending.amount;
  if (pending.type === 'redeem') {
    set.lifetimeRedeemed = reward.lifetimeRedeemed + Math.abs(pending.amount);
  }
  await tx.update(rewards).set(set).where(eq(rewards.id, reward.id));
  await recordValueChange(
    {
      entityType: 'reward',
      entityId: pending.memberId,
      fieldName: 'balance',
      oldValue: String(reward.balance),
      newValue: String(newBalance),
      changedBy: by,
      householdId: pending.householdId,
    },
    tx,
  );
  const [row] = await tx
    .update(rewardTransactions)
    .set({ status: 'approved', balanceAfter: newBalance, updatedAt: new Date() })
    .where(eq(rewardTransactions.id, pending.id))
    .returning();
  return row!;
}

async function rulePoints(
  database: Tx,
  householdId: string,
  ruleId: string,
): Promise<number | null> {
  const [rule] = await database
    .select({ points: rewardRules.points })
    .from(rewardRules)
    .where(and(eq(rewardRules.id, ruleId), eq(rewardRules.householdId, householdId)))
    .limit(1);
  return rule?.points ?? null;
}

/** Emit a `reward.earned` notification + `reward.updated` balance event to the member. */
async function emitEarned(
  tx: Tx,
  householdId: string,
  memberId: string,
  balance: number,
  taskId: string,
): Promise<void> {
  await notify(
    {
      householdId,
      recipientMemberId: memberId,
      type: NotificationTypes.rewardEarned,
      title: 'Points earned!',
      body: null,
      sourceEntityType: 'task',
      sourceEntityId: taskId,
    },
    tx,
  );
  await broadcast(userChannel(memberId), {
    type: RealtimeEvents.rewardUpdated,
    payload: { memberId, balance },
  });
}

export interface AwardTaskOpts {
  householdId: string;
  taskId: string;
  memberId: string | null;
  ruleId: string | null;
  /** True when the completion still needs supervisor verification (credit on approval). */
  asPending: boolean;
  by: string | null;
}

/**
 * Idempotently award points for a completed/approved reward-linked task. Runs in the
 * caller's transaction so the credit is atomic with the completion. A task credits at most
 * once: an existing non-rejected earn is left alone (or, when a pending earn is now verified,
 * finalized). (EP-0028)
 */
export async function awardTaskCompletion(tx: Tx, opts: AwardTaskOpts): Promise<void> {
  if (!opts.ruleId || !opts.memberId) return;

  const [existing] = await tx
    .select()
    .from(rewardTransactions)
    .where(
      and(
        eq(rewardTransactions.taskId, opts.taskId),
        eq(rewardTransactions.type, 'earn'),
        ne(rewardTransactions.status, 'rejected'),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.status === 'pending' && !opts.asPending) {
      const row = await applyApproval(tx, existing, opts.by);
      await emitEarned(tx, opts.householdId, opts.memberId, row.balanceAfter, opts.taskId);
    }
    return; // already credited, or still awaiting verification
  }

  const points = await rulePoints(tx, opts.householdId, opts.ruleId);
  if (!points || points <= 0) return;
  const status = opts.asPending ? 'pending' : 'approved';
  const result = await recordTransaction(tx, {
    householdId: opts.householdId,
    memberId: opts.memberId,
    type: 'earn',
    amount: points,
    status,
    taskId: opts.taskId,
    createdBy: opts.by,
  });
  if (status === 'approved') {
    await emitEarned(tx, opts.householdId, opts.memberId, result.balance, opts.taskId);
  }
}

// --- Allowances (recurring point grants) ---

export interface CreateAllowanceInput {
  memberId: string;
  points: number;
  rrule: string;
  name?: string;
}

export async function createAllowance(ctx: ActorContext, input: CreateAllowanceInput) {
  assertSupervisor(ctx.roles);
  await assertMemberInHousehold(ctx.householdId, input.memberId);
  const now = new Date();
  let rrule: string;
  try {
    rrule = withDtstart(input.rrule, now);
  } catch {
    throw new InvalidError('Invalid allowance cadence (RRULE).');
  }
  // last_granted_at = creation time so the first grant window excludes the anchor occurrence.
  const [row] = await db
    .insert(rewardAllowances)
    .values({
      householdId: ctx.householdId,
      memberId: input.memberId,
      name: input.name ?? null,
      points: input.points,
      rrule,
      lastGrantedAt: now,
    })
    .returning();
  return row!;
}

export async function listAllowances(ctx: ActorContext) {
  assertSupervisor(ctx.roles);
  return db
    .select()
    .from(rewardAllowances)
    .where(
      and(eq(rewardAllowances.householdId, ctx.householdId), eq(rewardAllowances.isActive, true)),
    );
}

export async function deleteAllowance(ctx: ActorContext, allowanceId: string) {
  assertSupervisor(ctx.roles);
  const [row] = await db
    .update(rewardAllowances)
    .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(rewardAllowances.id, allowanceId), eq(rewardAllowances.householdId, ctx.householdId)),
    )
    .returning();
  if (!row) throw new NotFoundError('Allowance not found.');
  return { deleted: true };
}
