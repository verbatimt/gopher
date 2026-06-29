import { describe, expect, it } from 'bun:test';
import { API_VERSION, failure, success } from './envelope.ts';

describe('envelope', () => {
  it('success wraps result with defaults (200/OK)', () => {
    expect(success({ a: 1 })).toEqual({
      version: API_VERSION,
      statusCode: 200,
      success: true,
      message: 'OK',
      result: { a: 1 },
    });
  });

  it('success honors statusCode and message', () => {
    const e = success(null, { statusCode: 201, message: 'Created' });
    expect(e.statusCode).toBe(201);
    expect(e.success).toBe(true);
    expect(e.message).toBe('Created');
    expect(e.result).toBeNull();
  });

  it('failure has success=false and null result', () => {
    expect(failure(404, 'nope')).toEqual({
      version: API_VERSION,
      statusCode: 404,
      success: false,
      message: 'nope',
      result: null,
    });
  });
});
