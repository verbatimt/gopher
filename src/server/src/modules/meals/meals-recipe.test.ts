// Integration tests for recipe-integrated meal planning + ingredient-derived grocery
// (EP-0046). Runs on the embedded DB. Covers entry↔recipe linking with meal_name defaulting,
// grocery derivation with cross-meal aggregation, servings scaling, recipe-delete nulling the
// link, and merge-on-re-derive. Distinct x-forwarded-for for the shared rate-limit bucket.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';

const PORT = 3206;
const FWD = '203.0.113.46';
const app = createApp();

const ownerEmail = 'mealrec-owner@x.test';
let ownerToken = '';
let householdId = '';

function decodeJwt(tok: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(tok.split('.')[1] ?? '', 'base64url').toString());
}

async function call(method: string, path: string, opts: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': FWD };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await app.handle(
    new Request(`http://localhost:${PORT}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function cleanup(): Promise<void> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail));
  for (const u of rows) {
    const hh = sql`SELECT id FROM households WHERE created_by = ${u.id}`;
    const rec = sql`SELECT id FROM recipes WHERE household_id IN (${hh})`;
    const gl = sql`SELECT id FROM grocery_lists WHERE household_id IN (${hh})`;
    const mp = sql`SELECT id FROM meal_plans WHERE household_id IN (${hh})`;
    await db.execute(sql`DELETE FROM grocery_items WHERE grocery_list_id IN (${gl})`);
    await db.execute(sql`DELETE FROM grocery_lists WHERE household_id IN (${hh})`);
    await db.execute(sql`DELETE FROM meal_plan_entries WHERE meal_plan_id IN (${mp})`);
    await db.execute(sql`DELETE FROM meal_plans WHERE household_id IN (${hh})`);
    await db.execute(sql`DELETE FROM recipe_ingredients WHERE recipe_id IN (${rec})`);
    await db.execute(sql`DELETE FROM recipe_steps WHERE recipe_id IN (${rec})`);
    await db.execute(sql`DELETE FROM recipes WHERE household_id IN (${hh})`);
    await db.execute(sql`DELETE FROM notifications WHERE household_id IN (${hh})`);
    await db.execute(sql`DELETE FROM time_windows WHERE household_id IN (${hh})`);
    await db.execute(sql`DELETE FROM household_invites WHERE household_id IN (${hh})`);
    await db.execute(sql`DELETE FROM user_sessions WHERE user_id = ${u.id}`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${u.id}`);
    await db.execute(
      sql`DELETE FROM household_members WHERE household_id IN (${hh}) OR user_id = ${u.id}`,
    );
    await db.execute(sql`DELETE FROM households WHERE created_by = ${u.id}`);
    await db.execute(sql`DELETE FROM audit_logs WHERE actor_user_id = ${u.id}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${u.id}`);
  }
}

beforeAll(async () => {
  await seedRoles();
  await cleanup();
  const reg = await call('POST', '/api/v1/auth/register', {
    body: { email: ownerEmail, password: 'password123', displayName: 'Owner' },
  });
  ownerToken = reg.body.result.accessToken;
  householdId = decodeJwt(ownerToken).householdId as string;
});

afterAll(async () => {
  await cleanup();
});

const H = () => `/api/v1/households/${householdId}`;

/** Clear the household's grocery items so each derivation test asserts in isolation (the list
 *  is one-per-household and persists across cases). */
async function clearGrocery(): Promise<void> {
  await db.execute(
    sql`DELETE FROM grocery_items WHERE grocery_list_id IN (SELECT id FROM grocery_lists WHERE household_id = ${householdId})`,
  );
}

async function makeRecipe(name: string, servings: number, onionGrams: number): Promise<string> {
  const r = await call('POST', `${H()}/recipes`, {
    token: ownerToken,
    body: {
      name,
      servings,
      ingredients: [{ name: 'onion', quantity: onionGrams, unit: 'g' }],
    },
  });
  return r.body.result.recipe.id;
}

describe('entry ↔ recipe linking', () => {
  it('defaults meal_name to the recipe name when omitted', async () => {
    const recipeId = await makeRecipe('Onion Soup', 4, 200);
    const plan = await call('POST', `${H()}/meal-plans`, {
      token: ownerToken,
      body: { weekStartDate: '2026-01-04' },
    });
    const planId = plan.body.result.plan.id;
    const entry = await call('POST', `${H()}/meal-plans/${planId}/entries`, {
      token: ownerToken,
      body: { dayOfWeek: 2, mealType: 'dinner', recipeId },
    });
    expect(entry.status).toBe(201);
    expect(entry.body.result.entry.mealName).toBe('Onion Soup');
    expect(entry.body.result.entry.recipeId).toBe(recipeId);
  });
});

describe('grocery derivation', () => {
  it('aggregates a shared ingredient across two meals into one line', async () => {
    await clearGrocery();
    const recipeId = await makeRecipe('Soup A', 4, 200);
    const recipe2 = await makeRecipe('Soup B', 4, 200);
    const plan = await call('POST', `${H()}/meal-plans`, {
      token: ownerToken,
      body: { weekStartDate: '2026-01-11' },
    });
    const planId = plan.body.result.plan.id;
    await call('POST', `${H()}/meal-plans/${planId}/entries`, {
      token: ownerToken,
      body: { dayOfWeek: 1, mealType: 'dinner', recipeId },
    });
    await call('POST', `${H()}/meal-plans/${planId}/entries`, {
      token: ownerToken,
      body: { dayOfWeek: 2, mealType: 'dinner', recipeId: recipe2 },
    });
    const seeded = await call('POST', `${H()}/grocery/seed-from-plan`, {
      token: ownerToken,
      body: { planId },
    });
    expect(seeded.status).toBe(200);

    const grocery = await call('GET', `${H()}/grocery`, { token: ownerToken });
    const onion = (grocery.body.result.items as Array<{ name: string; quantity: string }>).filter(
      (i) => i.name.toLowerCase() === 'onion',
    );
    expect(onion.length).toBe(1);
    expect(onion[0]!.quantity).toBe('400 g');
  });

  it('scales ingredient quantities by entry servings vs recipe servings', async () => {
    await clearGrocery();
    const recipeId = await makeRecipe('Scaled Soup', 4, 200); // 200 g onion per 4 servings
    const plan = await call('POST', `${H()}/meal-plans`, {
      token: ownerToken,
      body: { weekStartDate: '2026-01-18' },
    });
    const planId = plan.body.result.plan.id;
    await call('POST', `${H()}/meal-plans/${planId}/entries`, {
      token: ownerToken,
      body: { dayOfWeek: 3, mealType: 'dinner', recipeId, servings: 8 }, // 2× → 400 g
    });
    await call('POST', `${H()}/grocery/seed-from-plan`, { token: ownerToken, body: { planId } });
    const grocery = await call('GET', `${H()}/grocery`, { token: ownerToken });
    const onion = (grocery.body.result.items as Array<{ name: string; quantity: string }>).find(
      (i) => i.name.toLowerCase() === 'onion',
    );
    // This plan's own list line; isolate by quantity '400 g' produced from scaling.
    expect(onion).toBeDefined();
    expect(onion!.quantity).toBe('400 g');
  });

  it('re-deriving merges into the existing line (no duplicate)', async () => {
    await clearGrocery();
    const recipeId = await makeRecipe('Merge Soup', 4, 100);
    const plan = await call('POST', `${H()}/meal-plans`, {
      token: ownerToken,
      body: { weekStartDate: '2026-02-01' },
    });
    const planId = plan.body.result.plan.id;
    await call('POST', `${H()}/meal-plans/${planId}/entries`, {
      token: ownerToken,
      body: { dayOfWeek: 4, mealType: 'dinner', recipeId },
    });
    await call('POST', `${H()}/grocery/seed-from-plan`, { token: ownerToken, body: { planId } });
    await call('POST', `${H()}/grocery/seed-from-plan`, { token: ownerToken, body: { planId } });
    const grocery = await call('GET', `${H()}/grocery`, { token: ownerToken });
    const onion = (grocery.body.result.items as Array<{ name: string }>).filter(
      (i) => i.name.toLowerCase() === 'onion',
    );
    expect(onion.length).toBe(1); // merged, not duplicated
  });
});

describe('recipe deletion referential safety', () => {
  it('nulls the entry recipe link but keeps the meal_name', async () => {
    const recipeId = await makeRecipe('Doomed Recipe', 2, 50);
    const plan = await call('POST', `${H()}/meal-plans`, {
      token: ownerToken,
      body: { weekStartDate: '2026-02-08' },
    });
    const planId = plan.body.result.plan.id;
    const entry = await call('POST', `${H()}/meal-plans/${planId}/entries`, {
      token: ownerToken,
      body: { dayOfWeek: 5, mealType: 'lunch', recipeId },
    });
    const entryId = entry.body.result.entry.id;

    await call('DELETE', `${H()}/recipes/${recipeId}`, { token: ownerToken });

    const after = await call('GET', `${H()}/meal-plans/${planId}`, { token: ownerToken });
    const e = (
      after.body.result.entries as Array<{ id: string; recipeId: string | null; mealName: string }>
    ).find((x) => x.id === entryId);
    expect(e!.recipeId).toBeNull();
    expect(e!.mealName).toBe('Doomed Recipe');
  });
});
