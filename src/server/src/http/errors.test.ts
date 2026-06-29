import { describe, expect, it } from 'bun:test';
import {
  AppError,
  DuplicateError,
  ERROR_STATUS,
  InvalidError,
  NotFoundError,
  UnauthorizedError,
} from './errors.ts';

describe('error taxonomy', () => {
  it('maps each kind to the documented status code', () => {
    expect(ERROR_STATUS).toEqual({
      BadRequest: 400,
      Unauthorized: 401,
      Forbidden: 403,
      NotFound: 404,
      Duplicate: 409,
      Conflict: 409,
      Gone: 410,
      Invalid: 422,
      TooManyRequests: 429,
      FailedOperation: 500,
    });
  });

  it('subclasses carry the right status and extend AppError', () => {
    expect(new NotFoundError().statusCode).toBe(404);
    expect(new DuplicateError().statusCode).toBe(409);
    expect(new InvalidError().statusCode).toBe(422);
    expect(new UnauthorizedError().statusCode).toBe(401);
    expect(new NotFoundError()).toBeInstanceOf(AppError);
    expect(new NotFoundError()).toBeInstanceOf(Error);
  });

  it('accepts a custom message', () => {
    expect(new NotFoundError('household not found').message).toBe('household not found');
  });
});
