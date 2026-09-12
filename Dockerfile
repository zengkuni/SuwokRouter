# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.14-alpine AS base
WORKDIR /app

FROM base AS server-deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS dashboard-builder
COPY dashboard/package.json dashboard/bun.lock ./dashboard/
RUN cd dashboard && bun install --frozen-lockfile
COPY dashboard/ ./dashboard/
RUN bun run --cwd dashboard build

FROM base AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="Sway Router"
LABEL org.opencontainers.image.source="https://github.com/envielxyz/SwayRouter"
LABEL org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
ENV PORT=14045
ENV HOSTNAME=0.0.0.0
ENV DATA_DIR=/app/data

COPY --from=server-deps /app/node_modules ./node_modules
COPY package.json ./package.json
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY tsconfig.json ./tsconfig.json
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard/dist
COPY dashboard/public/ ./dashboard/public/

RUN mkdir -p /app/data && chown -R bun:bun /app && \
  mkdir -p /app/data-home && chown bun:bun /app/data-home && \
  ln -sf /app/data-home /home/bun/.swayrouter 2>/dev/null || true

USER bun

EXPOSE 14045

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:14045/api/health/ready').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["bun", "run", "start"]
