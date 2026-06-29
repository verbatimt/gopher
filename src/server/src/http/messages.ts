// Central catalog of user-facing strings. Routes/handlers reference these constants so
// messaging stays consistent and no internal detail leaks into responses.

export const messages = {
  OK: 'OK',
  CREATED: 'Created',
  BAD_REQUEST: 'The request could not be processed.',
  UNAUTHORIZED: 'Authentication is required.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
  DUPLICATE: 'The resource already exists.',
  CONFLICT: 'The request conflicts with the current state.',
  GONE: 'This resource is no longer available.',
  INVALID_INPUT: 'The submitted data is invalid.',
  TOO_MANY_REQUESTS: 'Too many requests. Please try again later.',
  INTERNAL_ERROR: 'An unexpected error occurred.',
} as const;

export type MessageKey = keyof typeof messages;
