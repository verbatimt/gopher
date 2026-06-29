// Minimal structured logger: one JSON line per event. Silent under NODE_ENV=test to keep
// test output clean. Replaced/extended by the observability baseline (EP-0040).

type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

function emit(level: Level, message: string, fields?: Fields): void {
  if (process.env.NODE_ENV === 'test') return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...fields });
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, fields?: Fields) => emit('debug', message, fields),
  info: (message: string, fields?: Fields) => emit('info', message, fields),
  warn: (message: string, fields?: Fields) => emit('warn', message, fields),
  error: (message: string, fields?: Fields) => emit('error', message, fields),
};
