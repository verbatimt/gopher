// Typed error taxonomy. Handlers throw these; the centralized error handler (app.ts)
// maps them to HTTP status codes and the error envelope. User-facing messages only —
// internal details never reach the response body.

import { messages } from './messages.ts';

export type ErrorKind =
  | 'BadRequest'
  | 'Unauthorized'
  | 'Forbidden'
  | 'NotFound'
  | 'Duplicate'
  | 'Conflict'
  | 'Gone'
  | 'Invalid'
  | 'TooManyRequests'
  | 'FailedOperation';

export const ERROR_STATUS: Record<ErrorKind, number> = {
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
};

export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly statusCode: number;

  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = 'AppError';
    this.kind = kind;
    this.statusCode = ERROR_STATUS[kind];
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = messages.BAD_REQUEST) {
    super('BadRequest', message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = messages.UNAUTHORIZED) {
    super('Unauthorized', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = messages.FORBIDDEN) {
    super('Forbidden', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = messages.NOT_FOUND) {
    super('NotFound', message);
  }
}

export class DuplicateError extends AppError {
  constructor(message: string = messages.DUPLICATE) {
    super('Duplicate', message);
  }
}

export class InvalidError extends AppError {
  constructor(message: string = messages.INVALID_INPUT) {
    super('Invalid', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = messages.CONFLICT) {
    super('Conflict', message);
  }
}

export class GoneError extends AppError {
  constructor(message: string = messages.GONE) {
    super('Gone', message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string = messages.TOO_MANY_REQUESTS) {
    super('TooManyRequests', message);
  }
}

export class FailedOperationError extends AppError {
  constructor(message: string = messages.INTERNAL_ERROR) {
    super('FailedOperation', message);
  }
}
