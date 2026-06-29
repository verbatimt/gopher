import { describe, expect, it } from 'bun:test';
import { createApp } from './app.ts';

const app = createApp();

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{
  status: number;
  // biome-ignore lint/suspicious/noExplicitAny: test helper reads arbitrary JSON envelopes.
  body: any;
}> {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('app envelope + error mapping', () => {
  it('GET /api/v1 returns a success envelope', async () => {
    const r = await call('GET', '/api/v1');
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.version).toBe('v1');
    expect(r.body.result.name).toBe('gopher-api');
  });

  it('valid POST /api/v1/echo returns the enveloped result', async () => {
    const r = await call('POST', '/api/v1/echo', { message: 'hi' });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.result.echo).toBe('hi');
  });

  it('invalid input yields a 422 envelope with no stack trace', async () => {
    const r = await call('POST', '/api/v1/echo', { message: '' });
    expect(r.status).toBe(422);
    expect(r.body.success).toBe(false);
    expect(r.body.statusCode).toBe(422);
    expect(r.body.result).toBeNull();
    // No internal stack leakage.
    expect(JSON.stringify(r.body)).not.toContain('\n    at ');
  });

  it('unknown route yields a 404 envelope', async () => {
    const r = await call('GET', '/api/v1/does-not-exist');
    expect(r.status).toBe(404);
    expect(r.body.success).toBe(false);
    expect(r.body.statusCode).toBe(404);
  });

  it('attaches an x-request-id response header', async () => {
    const res = await app.handle(new Request('http://localhost/api/v1'));
    expect(res.headers.get('x-request-id')).toMatch(/[0-9a-f-]{36}/);
  });
});
