// Self-contained load test for the Gopher performance baseline (EP-0040). No external deps —
// uses bun's built-in fetch. Bootstraps a household + minimal finance data, then drives the
// key read endpoints concurrently and times forecast generation separately (it can be heavy).
//
//   TARGET=http://gopher.local CONCURRENCY=10 DURATION_MS=15000 bun run src/infra/loadtest/loadtest.ts
//
// Prints a Markdown summary to stdout (paste into docs/performance-baseline.md).

const TARGET = process.env.TARGET ?? 'http://gopher.local';
const BASE = `${TARGET}/api/v1`;
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const DURATION_MS = Number(process.env.DURATION_MS ?? 15000);
// Per-request think time models active users rather than a zero-think fork-bomb (which
// exhausts the *load generator's* local sockets long before the server is stressed).
const THINK_MS = Number(process.env.THINK_MS ?? 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[i]! * 100) / 100;
}

async function jpost(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function bootstrap(): Promise<{ token: string; householdId: string }> {
  const email = `loadtest-${Date.now()}@x.test`;
  const reg = await (await jpost('/auth/register', {
    email,
    password: 'password123',
    displayName: 'Load',
  })).json();
  const token = reg.result.accessToken as string;
  const householdId = JSON.parse(
    Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
  ).householdId as string;

  // Minimal finance data so forecast generation has something to project.
  const fb = `/households/${householdId}/finance`;
  const acct = async (name: string, type: string, bal: number) =>
    ((await (await jpost(`${fb}/accounts`, { name, type, currentBalance: bal }, token)).json()).result
      .account.id) as string;
  const chk = await acct('Checking', 'Checking', 1000);
  const pay = await acct('Payroll', 'Payroll', 0);
  await jpost(
    `${fb}/transactions`,
    {
      originAccountId: pay,
      destinationAccountId: chk,
      description: 'Salary',
      category: 'Pay',
      transferType: 'FixedAmount',
      transferAmount: 100,
      startDate: '2026-01-01',
      ending: 'Ongoing',
      intervalUnit: 'Daily',
    },
    token,
  );
  return { token, householdId };
}

interface Result {
  name: string;
  count: number;
  errors: number;
  throughput: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

async function loadTest(name: string, fn: () => Promise<boolean>): Promise<Result> {
  const latencies: number[] = [];
  let errors = 0;
  const deadline = Date.now() + DURATION_MS;
  const start = performance.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (Date.now() < deadline) {
        const t = performance.now();
        try {
          if (!(await fn())) errors += 1;
        } catch {
          errors += 1;
        }
        latencies.push(performance.now() - t);
        if (THINK_MS) await sleep(THINK_MS);
      }
    }),
  );
  const elapsed = (performance.now() - start) / 1000;
  latencies.sort((a, b) => a - b);
  return {
    name,
    count: latencies.length,
    errors,
    throughput: Math.round((latencies.length / elapsed) * 10) / 10,
    p50: pct(latencies, 50),
    p95: pct(latencies, 95),
    p99: pct(latencies, 99),
    max: Math.round((latencies[latencies.length - 1] ?? 0) * 100) / 100,
  };
}

async function main(): Promise<void> {
  const { token, householdId } = await bootstrap();
  const h = `/households/${householdId}`;
  const get = (path: string) => async () =>
    (await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } })).ok;
  const health = async () => (await fetch(`${TARGET}/health`)).ok;

  const results: Result[] = [];
  results.push(await loadTest('GET /health', health));
  results.push(await loadTest('GET /calendar', get(`${h}/calendar?from=2026-01-01T00:00:00.000Z&to=2026-12-31T00:00:00.000Z`)));
  results.push(await loadTest('GET /tasks', get(`${h}/tasks`)));
  results.push(await loadTest('GET /dashboard', get('/dashboard')));

  // Forecast generation, timed sequentially (heavy operation; not concurrency-tested).
  const fgTimes: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t = performance.now();
    await jpost(`${h}/finance/forecasts`, { startDate: '2026-01-01', endDate: '2026-03-31', description: `lt-${i}` }, token);
    fgTimes.push(performance.now() - t);
  }
  fgTimes.sort((a, b) => a - b);

  // --- Markdown report ---
  console.log(`## Run: ${new Date().toISOString()}`);
  console.log(
    `Target \`${TARGET}\` · concurrency ${CONCURRENCY} · think ${THINK_MS}ms · ${DURATION_MS / 1000}s/endpoint\n`,
  );
  console.log('| Endpoint | Requests | Errors | Throughput (req/s) | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(`| ${r.name} | ${r.count} | ${r.errors} | ${r.throughput} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.max} |`);
  }
  console.log('');
  console.log(`**Forecast generation** (90-day window, 10 sequential runs): p50 ${pct(fgTimes, 50)} ms · p95 ${pct(fgTimes, 95)} ms · max ${Math.round((fgTimes[fgTimes.length - 1] ?? 0) * 100) / 100} ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
