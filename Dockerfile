# syntax=docker/dockerfile:1
# check=error=true

# the app on node, one container against one database file under /data (compose.yaml).
#
# glibc slim rather than alpine: @libsql/client loads a prebuilt native binding, and node's own
# musl builds are experimental on amd64 and untested on arm64.
#
# both bases pinned by digest, the tag beside it for the reader. the two tags name one debian
# release, since the runtime stage runs this image's node binary on that debian; the digests are
# snapshots of their own tags and move independently.

FROM node:22.23.3-trixie-slim@sha256:28d03803f09ba76560e273af33beb7eda4ed68fa0698bc9bd15e9a6e35693923 AS base
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
# .pnpmfile.cjs because the lockfile records its checksum, and a frozen install without it fails.
COPY --parents package.json pnpm-lock.yaml .pnpmfile.cjs pnpm-workspace.yaml .npmrc packages/*/package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
	pnpm install --prod --frozen-lockfile --ignore-scripts --store-dir /pnpm-store \
	--filter @better-giving/app

# the node image's binary alone, on the debian that image is built from, so npm, yarn and corepack
# never reach this stage (docker-node docs/BestPractices.md). trixie-slim carries the libraries it
# links (glibc, libstdc++, libgcc_s), and node verifies TLS against its own bundled roots, so no
# ca-certificates.
FROM debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad AS runtime
COPY --from=base /usr/local/bin/node /usr/local/bin/
ENV NODE_ENV=production \
	DATABASE_URL=file:/data/better-giving.db
# uid and gid 1000, the node image's own, so a volume an earlier image wrote stays this user's.
# /data is created here and owned by `node` so a fresh named volume mounted over it copies that
# ownership.
RUN groupadd --gid 1000 node \
	&& useradd --uid 1000 --gid node --shell /bin/bash --create-home node \
	&& mkdir /data && chown node:node /data
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
# exec form: no shell sits in front of node, so the SIGTERM compose's init forwards reaches node,
# which server/index.ts drains on.
CMD ["node", "server/index.ts"]
