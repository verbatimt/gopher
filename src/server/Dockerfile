# Gopher API image — multi-stage Bun build (targets linux/arm64 on server.local).
# Bun pin must match docs/development.md and .tool-versions.

# --- deps: install production dependencies against the frozen lockfile ---
FROM oven/bun:1.3.10-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# --- runtime: lean image with only prod deps + source ---
FROM oven/bun:1.3.10-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Production node_modules from the deps stage.
COPY --from=deps /app/node_modules ./node_modules
# Application source (everything else is excluded via .dockerignore).
COPY . .

# The oven/bun image ships a non-root `bun` user; drop privileges.
USER bun

EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
