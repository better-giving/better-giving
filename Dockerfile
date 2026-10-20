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
# setup-webhook.ts as one module, the workspace packages it imports inlined from source, so the
# runtime stage carries no workspace package but the app. a package packages/app resolves stays a
# bare import for the runtime stage's node_modules to answer; one only a workspace package declares
# is inlined too. configFile: false because vite.config.ts builds the react-router app.
RUN cd packages/app && node --input-type=module <<'EOF'
import { build } from 'vite';
await build({
	configFile: false,
	publicDir: false,
	logLevel: 'warn',
	ssr: { noExternal: [/^@better-giving\//] },
	build: {
		ssr: 'scripts/setup-webhook.ts',
		target: 'node22',
		outDir: '/setup-webhook',
		emptyOutDir: true
	}
});
EOF
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
# javascript under the .ts name DEPLOY.md and the Payments screen print; node finds no types to
# strip.
COPY --from=build /setup-webhook/setup-webhook.js ./scripts/setup-webhook.ts
# loads the bundle against this stage's node_modules, so an import nothing here answers fails the
# build (exit 1) rather than an operator's run. with no name the script prints its usage, exit 2.
RUN node scripts/setup-webhook.ts || [ $? -eq 2 ]
USER node
EXPOSE 3000
# exec form: node is PID 1 and receives SIGTERM itself, which server/index.ts drains on.
CMD ["node", "server/index.ts"]
