import { defineConfig } from 'drizzle-kit';

// Drizzle migration workflow: `drizzle-kit generate` reads the schema and emits reviewed
// SQL into the migrations folder; `bun run db:migrate` applies it. Forward-only.
// `casing: 'snake_case'` maps camelCase column keys to snake_case DB columns.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema',
  out: './src/db/migrations',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://gopher:gopher_dev_pw@localhost:5432/gopher',
  },
});
