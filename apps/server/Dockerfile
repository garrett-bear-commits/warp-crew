# One image per game (§10): node:24-alpine, dumb-init, non-root, HEALTHCHECK /health/ready.
# Server sources run under Node's native type stripping (ADR-027); the admin inspector (ADR-021) is
# built in a builder stage so a clean checkout (`git archive HEAD | docker build -f apps/server/Dockerfile -`)
# produces the image without any pre-built artefact.
FROM node:24-alpine AS base
RUN apk add --no-cache dumb-init && corepack enable && corepack prepare pnpm@10.30.1 --activate
WORKDIR /app
ENV CI=true

# ── all workspace manifests (deps resolution) ────────────────────────────────
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/server/package.json packages/server/
COPY packages/jest-verify/package.json packages/jest-verify/
COPY packages/testkit/package.json packages/testkit/
COPY packages/tooling/package.json packages/tooling/
COPY packages/client/package.json packages/client/
COPY apps/server/package.json apps/server/
COPY apps/template-game/package.json apps/template-game/

# ── build stage: dev deps + vite build of the admin inspector ────────────────
FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter @foundation/app-server...
COPY packages/contracts/src packages/contracts/src
COPY packages/contracts/tsconfig.json packages/contracts/
COPY apps/server/admin-inspector apps/server/admin-inspector
COPY apps/server/tsconfig.json apps/server/
COPY tsconfig.base.json ./
RUN pnpm --filter @foundation/app-server build

# ── production deps only ─────────────────────────────────────────────────────
FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter @foundation/app-server...

# ── runtime ──────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages ./packages
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY packages/contracts/src packages/contracts/src
COPY packages/contracts/package.json packages/contracts/
COPY packages/server/src packages/server/src
COPY packages/server/package.json packages/server/
COPY packages/jest-verify/src packages/jest-verify/src
COPY packages/jest-verify/package.json packages/jest-verify/
COPY packages/testkit/src packages/testkit/src
COPY packages/testkit/package.json packages/testkit/
COPY apps/server/src apps/server/src
COPY apps/server/games apps/server/games
COPY apps/server/package.json apps/server/
COPY --from=build /app/apps/server/admin-inspector/dist apps/server/admin-inspector/dist
USER node
EXPOSE 8080 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:8080/health/ready || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/server/src/main.ts"]
