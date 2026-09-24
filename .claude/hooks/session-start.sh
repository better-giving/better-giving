#!/bin/bash
# readies a claude code on the web session: workspace deps, the console's go module, and the
# local D1 that CONTRIBUTING.md → Setup builds. local only — nothing here reaches a deployment.
# the kru plugin is not installed here: skills load before this hook runs, so it belongs in the
# environment's setup script instead.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

pnpm install --frozen-lockfile

(cd packages/console && go mod download)

pnpm wrangler d1 migrations apply DB --local
pnpm wrangler d1 execute DB --local --file scripts/seed-local.sql
