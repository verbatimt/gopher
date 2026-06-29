// Integration tests for the audit infrastructure. Runs fully in-process on the
// embedded DB (pglite). Cleans up its own rows.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import * as schema from '../db/schema/index.ts';
import { AuditActions } from './actions.ts';
import { auditLog } from './log.ts';
import { REDACTED, recordValueChange, recordValueChanges } from './value-change.ts';

const { auditLogs, valueChangeHistory } = schema;

const household = '00000000-0000-4000-8000-000000000009';
const actor = '00000000-0000-4000-8000-0000000000a1';
const entityRole = '00000000-0000-4000-8000-0000000000e1';
const entityUser = '00000000-0000-4000-8000-0000000000e2';

async function cleanup(): Promise<void> {
  await db.execute(
    sql`DELETE FROM audit_logs WHERE actor_user_id = ${actor} OR action = 'auth.logout'`,
  );
  await db.execute(
    sql`DELETE FROM value_change_history WHERE entity_id IN (${entityRole}, ${entityUser})`,
  );
}

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

describe('auditLog', () => {
  it('writes a correctly-shaped action-log row including IP and user-agent', async () => {
    await auditLog(
      {
        action: AuditActions.auth.login,
        householdId: household,
        actorUserId: actor,
        entityType: 'user',
        entityId: actor,
        ipAddress: '203.0.113.7',
        userAgent: 'tester/1.0',
        metadata: { method: 'password' },
      },
      db,
    );

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.actorUserId, actor));
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.action).toBe('auth.login');
    expect(row.householdId).toBe(household);
    expect(row.ipAddress).toBe('203.0.113.7');
    expect(row.userAgent).toBe('tester/1.0');
    expect(row.metadata).toEqual({ method: 'password' });
  });

  it('logs a system-level action with null household without error', async () => {
    await auditLog({ action: AuditActions.auth.logout, householdId: null, actorUserId: null }, db);
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, 'auth.logout'));
    expect(rows.some((r) => r.householdId === null)).toBe(true);
  });
});

describe('value-change history', () => {
  it('records a single sensitive-field change with accurate old/new', async () => {
    await recordValueChange(
      {
        entityType: 'household_member',
        entityId: entityRole,
        fieldName: 'role',
        oldValue: 'SupervisedUser',
        newValue: 'SupervisingUser',
        changedBy: actor,
        householdId: household,
      },
      db,
    );

    const rows = await db
      .select()
      .from(valueChangeHistory)
      .where(eq(valueChangeHistory.entityId, entityRole));
    expect(rows.length).toBe(1);
    expect(rows[0]!.fieldName).toBe('role');
    expect(rows[0]!.oldValue).toBe('SupervisedUser');
    expect(rows[0]!.newValue).toBe('SupervisingUser');
  });

  it('writes one row per changed field and redacts secrets', async () => {
    const count = await recordValueChanges(
      {
        entityType: 'user',
        entityId: entityUser,
        changedBy: actor,
        householdId: household,
        before: { email: 'a@x.test', passwordHash: 'OLDHASH', name: 'A' },
        after: { email: 'b@x.test', passwordHash: 'NEWHASH', name: 'A' },
        fields: ['email', 'passwordHash', 'name'],
        secretFields: ['passwordHash'],
      },
      db,
    );
    expect(count).toBe(2); // email + passwordHash changed; name unchanged

    const rows = await db
      .select()
      .from(valueChangeHistory)
      .where(eq(valueChangeHistory.entityId, entityUser));
    const email = rows.find((r) => r.fieldName === 'email')!;
    expect(email.oldValue).toBe('a@x.test');
    expect(email.newValue).toBe('b@x.test');

    const password = rows.find((r) => r.fieldName === 'passwordHash')!;
    expect(password.oldValue).toBe(REDACTED);
    expect(password.newValue).toBe(REDACTED); // never the real hash
  });
});
