# Stage 1: Build frontend & compile native dependencies (better-sqlite3)
FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci || npm install --no-audit --no-fund || npm install --no-audit --no-fund --legacy-peer-deps

COPY . .
RUN npm run build

# Drop dev-only packages (tsx stays: it is a runtime dependency that runs server.ts)
RUN npm prune --omit=dev

# Stage 2: Minimal production runtime
FROM node:22-bookworm-slim AS runner

LABEL org.opencontainers.image.title="xlab-bash"
LABEL org.opencontainers.image.description="Self-hosted mobile-first web SSH terminal"
LABEL org.opencontainers.image.source="https://github.com/CJNG20u/xlab-bash"

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8022
ENV DATA_DIR=/data
ENV TRUST_PROXY=1

RUN mkdir -p /data && chown -R node:node /data

COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server.ts ./server.ts
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/src/types ./src/types
COPY --from=builder --chown=node:node /app/src/lib/defaultLayout.ts ./src/lib/defaultLayout.ts
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Starts as root only to fix ./data ownership, then runs the app as "node"

VOLUME ["/data"]
EXPOSE 8022

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8022) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npx", "tsx", "server.ts"]
