# syntax=docker/dockerfile:1
# check=error=true

# the app on node, one container against one database file under /data (compose.yaml).
#
# glibc slim rather than alpine: @libsql/client loads a prebuilt native binding, and node's own
# musl builds are experimental on amd64 and untested on arm64.

FROM node:22.23.3-trixie-slim AS base
# corepack runs the pnpm that package.json's `packageManager` pins.
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
	pnpm install --frozen-lockfile --store-dir /pnpm-store
# empty unless the image build passes one; version-define.ts reads it into the bundle.
ARG BETTER_GIVING_VERSION
RUN pnpm build

# a fresh install of the app's production dependencies alone: pruning the build stage's tree leaves
# the devDependencies in node_modules/.pnpm. --ignore-scripts because the root `prepare` runs
# react-router typegen, which is a devDependency.
FROM base AS prod-deps
COPY --parents package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc packages/*/package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
	pnpm install --prod --frozen-lockfile --ignore-scripts --store-dir /pnpm-store \
	--filter @better-giving/app

FROM node:22.23.3-trixie-slim AS runtime
ENV NODE_ENV=production \
	DATABASE_URL=file:/data/better-giving.db
# created here and owned by `node` so a fresh named volume mounted over it copies that ownership.
RUN mkdir /data && chown node:node /data
WORKDIR /repo/packages/app
COPY --from=prod-deps /repo/node_modules /repo/node_modules
COPY --from=prod-deps /repo/packages/app/node_modules ./node_modules
COPY --from=build /repo/packages/app/package.json ./
COPY --from=build /repo/packages/app/build ./build
COPY --from=build /repo/packages/app/server ./server
COPY --from=build /repo/packages/app/src ./src
COPY --from=build /repo/packages/app/migrations ./migrations
COPY --from=build /repo/packages/app/scripts/migrate.ts /repo/packages/app/scripts/backup.ts ./scripts/
USER node
EXPOSE 3000
# exec form: node is PID 1 and receives SIGTERM itself, which server/index.ts drains on.
CMD ["node", "server/index.ts"]
