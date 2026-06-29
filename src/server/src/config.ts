// Central configuration. All runtime config comes from environment variables (see
// .env.example). Secrets are never hardcoded; sensible non-secret defaults keep local
// dev and unit tests runnable without a full environment.

const env = process.env;
const nodeEnv = env.NODE_ENV ?? 'development';
const isProd = nodeEnv === 'production';

function requiredInProd(name: string, devFallback: string): string {
  const value = env[name];
  if (value && value.length > 0) return value;
  if (isProd) {
    throw new Error(`Missing required environment variable in production: ${name}`);
  }
  return devFallback;
}

export const config = {
  nodeEnv,
  isProd,
  apiVersion: 'v1',
  port: Number(env.PORT ?? 3000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://gopher:gopher_dev_pw@localhost:5432/gopher',
  redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: requiredInProd('JWT_SECRET', 'dev_only_insecure_jwt_secret_change_me'),
  cookieDomain: env.COOKIE_DOMAIN ?? '',
  corsOrigins: (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
} as const;

export type Config = typeof config;
