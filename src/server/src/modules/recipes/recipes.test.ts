// Integration tests for the Recipes API (EP-0045). Runs on the embedded DB (pglite +
// ioredis-mock). Covers recipe CRUD, ingredient/step add+reorder (dense 1..n), search + tag
// filter, soft-delete (hidden from lists, still resolvable), and meals:write gating. Uses a
// distinct x-forwarded-for so the shared auth rate-limit bucket is unaffected.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/index.ts';
import { seedRoles } from '../../db/seeds/roles.ts';

const PORT = 3205;
const FWD = '203.0.113.45';
const app = createApp();

const ownerEmail = 'recipe-owner@x.test';
const kidEmail = 'recipe-kid@x.test';
let ownerToken = '';
let kidToken = '';
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
  for (const email of [ownerEmail, kidEmail]) {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    for (const u of rows) {
      const hh = sql`SELECT id FROM households WHERE created_by = ${u.id}`;
      const rec = sql`SELECT id FROM recipes WHERE household_id IN (${hh})`;
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
}

beforeAll(async () => {
  await seedRoles();
  await cleanup();
  const reg = await call('POST', '/api/v1/auth/register', {
    body: { email: ownerEmail, password: 'password123', displayName: 'Owner' },
  });
  ownerToken = reg.body.result.accessToken;
  householdId = decodeJwt(ownerToken).householdId as string;

  const invite = await call('POST', `/api/v1/households/${householdId}/invites`, {
    token: ownerToken,
    body: { email: kidEmail, role: 'supervised_user' },
  });
  const accept = await call('POST', '/api/v1/auth/accept-invite', {
    body: { token: invite.body.result.token, password: 'password123', displayName: 'Kid' },
  });
  kidToken = accept.body.result.accessToken;
});

afterAll(async () => {
  await cleanup();
});

const base = () => `/api/v1/households/${householdId}/recipes`;

describe('recipe CRUD + ordering', () => {
  it('creates a recipe with 3 ingredients and 4 steps, returned in order', async () => {
    const created = await call('POST', base(), {
      token: ownerToken,
      body: {
        name: 'Pancakes',
        servings: 4,
        tags: ['breakfast', 'sweet'],
        ingredients: [
          { name: 'flour', quantity: 200, unit: 'g' },
          { name: 'milk', quantity: 300, unit: 'ml' },
          { name: 'egg', quantity: 2, unit: 'ea' },
        ],
        steps: [
          { instruction: 'Mix dry' },
          { instruction: 'Add wet' },
          { instruction: 'Rest batter' },
          { instruction: 'Cook' },
        ],
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.result.ingredients.length).toBe(3);
    expect(created.body.result.steps.length).toBe(4);
    expect(created.body.result.steps.map((s: { stepNumber: number }) => s.stepNumber)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('reorders steps and re-densifies after an ingredient delete', async () => {
    const created = await call('POST', base(), {
      token: ownerToken,
      body: {
        name: 'Soup',
        ingredients: [
          { name: 'onion', quantity: 1, unit: 'ea' },
          { name: 'carrot', quantity: 2, unit: 'ea' },
          { name: 'stock', quantity: 1, unit: 'l' },
        ],
        steps: [{ instruction: 'Chop' }, { instruction: 'Simmer' }, { instruction: 'Blend' }],
      },
    });
    const id = created.body.result.recipe.id;
    const steps = created.body.result.steps as Array<{ id: string }>;
    const ingredients = created.body.result.ingredients as Array<{ id: string }>;

    // Reverse the steps.
    const reordered = await call('POST', `${base()}/${id}/steps/reorder`, {
      token: ownerToken,
      body: { order: [steps[2]!.id, steps[1]!.id, steps[0]!.id] },
    });
    expect(reordered.status).toBe(200);
    expect(reordered.body.result.steps.map((s: { id: string }) => s.id)).toEqual([
      steps[2]!.id,
      steps[1]!.id,
      steps[0]!.id,
    ]);
    expect(reordered.body.result.steps.map((s: { stepNumber: number }) => s.stepNumber)).toEqual([
      1, 2, 3,
    ]);

    // Delete the first ingredient → remaining order stays dense 1..n.
    await call('DELETE', `${base()}/${id}/ingredients/${ingredients[0]!.id}`, {
      token: ownerToken,
    });
    const after = await call('GET', `${base()}/${id}`, { token: ownerToken });
    expect(after.body.result.ingredients.length).toBe(2);
    expect(after.body.result.ingredients.map((i: { sortOrder: number }) => i.sortOrder)).toEqual([
      1, 2,
    ]);
  });
});

describe('search + tag filter', () => {
  it('filters by name fragment and by tag', async () => {
    const byName = await call('GET', `${base()}?search=panc`, { token: ownerToken });
    const names = (byName.body.result.recipes as Array<{ name: string }>).map((r) => r.name);
    expect(names).toContain('Pancakes');
    expect(names).not.toContain('Soup');

    const byTag = await call('GET', `${base()}?tag=breakfast`, { token: ownerToken });
    const tagNames = (byTag.body.result.recipes as Array<{ name: string }>).map((r) => r.name);
    expect(tagNames).toContain('Pancakes');
  });
});

describe('soft-delete', () => {
  it('hides a deleted recipe from lists but keeps it resolvable by id', async () => {
    const created = await call('POST', base(), { token: ownerToken, body: { name: 'TempRecipe' } });
    const id = created.body.result.recipe.id;
    const del = await call('DELETE', `${base()}/${id}`, { token: ownerToken });
    expect(del.status).toBe(200);

    const list = await call('GET', `${base()}?search=TempRecipe`, { token: ownerToken });
    expect((list.body.result.recipes as unknown[]).length).toBe(0);

    const byId = await call('GET', `${base()}/${id}`, { token: ownerToken });
    expect(byId.status).toBe(200);
    expect(byId.body.result.recipe.isActive).toBe(false);
  });
});

describe('nutrition (ADR-0005)', () => {
  it('round-trips per-recipe nutrition on create + PATCH and clears a macro with null', async () => {
    const created = await call('POST', base(), {
      token: ownerToken,
      body: { name: 'NutriBowl', calories: 520, proteinGrams: 30, carbsGrams: 45.5, fatGrams: 12 },
    });
    expect(created.status).toBe(201);
    const id = created.body.result.recipe.id;
    expect(created.body.result.recipe.calories).toBe(520);
    expect(Number(created.body.result.recipe.proteinGrams)).toBe(30);
    expect(Number(created.body.result.recipe.carbsGrams)).toBe(45.5);
    expect(Number(created.body.result.recipe.fatGrams)).toBe(12);

    // PATCH updates calories and clears fat; the untouched macro is preserved.
    const patched = await call('PATCH', `${base()}/${id}`, {
      token: ownerToken,
      body: { calories: 600, fatGrams: null },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.result.recipe.calories).toBe(600);
    expect(patched.body.result.recipe.fatGrams).toBeNull();
    expect(Number(patched.body.result.recipe.proteinGrams)).toBe(30);

    // Authoring nutrition still requires meals:write.
    const kid = await call('PATCH', `${base()}/${id}`, { token: kidToken, body: { calories: 1 } });
    expect(kid.status).toBe(403);
  });
});

describe('access control', () => {
  it('a supervised user cannot author but can read', async () => {
    const create = await call('POST', base(), { token: kidToken, body: { name: 'KidRecipe' } });
    expect(create.status).toBe(403);

    const read = await call('GET', base(), { token: kidToken });
    expect(read.status).toBe(200);
  });
});
