// Gopher response envelope. EVERY /api/v1 response (success and error) is produced via
// these helpers so the shape stays uniform across the whole API.
//   { version, statusCode, success, message, result }

export const API_VERSION = 'v1';

export interface Envelope<T> {
  version: string;
  statusCode: number;
  success: boolean;
  message: string;
  result: T | null;
}

export interface SuccessOptions {
  message?: string;
  statusCode?: number;
}

/** Build a success envelope (2xx). Defaults to 200 / "OK". */
export function success<T>(result: T, opts: SuccessOptions = {}): Envelope<T> {
  return {
    version: API_VERSION,
    statusCode: opts.statusCode ?? 200,
    success: true,
    message: opts.message ?? 'OK',
    result,
  };
}

/** Build an error envelope (non-2xx). `result` is always null. */
export function failure(statusCode: number, message: string): Envelope<null> {
  return {
    version: API_VERSION,
    statusCode,
    success: false,
    message,
    result: null,
  };
}
