// PostgreSQL client (postgres.js) for production/development. Connections are established
// lazily on first query, so importing never blocks startup. Under NODE_ENV=test this module
// is not imported (db/index.ts uses the embedded pglite driver instead), so no postgres.js
// connection is ever opened during tests.

import postgres from 'postgres';
import { config } from '../config.ts';

export const sql = postgres(config.databaseUrl, {
  max: 10,
  connect_timeout: 5,
  idle_timeout: 20,
  // Silence NOTICE chatter; real errors still surface via query rejection.
  onnotice: () => {},
});
