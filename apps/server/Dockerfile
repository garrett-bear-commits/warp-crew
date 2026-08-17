# One image per game (§10): node:24-alpine, dumb-init, non-root, HEALTHCHECK /health/ready.
# Sources run under Node's native type stripping (ADR-027); no build step for the server.
FROM node:24-alpine AS base
RUN apk add --no-cache dumb-init && corepack enable && corepack prepare pnpm@10.30.1 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/server/package.json packages/server/
COPY packages/jest-verify/package.json packages/jest-verify/
COPY packages/testkit/package.json packages/testkit/
COPY packages/tooling/package.json packages/tooling/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --prod --filter @foundation/app-server...

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
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
COPY apps/server/admin-inspector/dist apps/server/admin-inspector/dist
USER node
EXPOSE 8080 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:8080/health/ready || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/server/src/main.ts"]
