#!/bin/bash
# readies a claude code on the web session: workspace deps, the console's go module, and the
# local D1 that CONTRIBUTING.md → Setup builds. local only — nothing here reaches a deployment.
# the kru plugin is not installed here: skills load before this hook runs, so it belongs in the
# environment's setup script instead.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# the environment's setup script (.claude/cloud-setup.md) installs pnpm at packageManager's version
# into /usr/local/bin, which the image puts behind its own /opt/node22/bin. the image's pnpm self-switches
# with lifecycle scripts off, so the pinned one goes first here and in every later shell.
export PATH="/usr/local/bin:$PATH"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="/usr/local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi

cd "$CLAUDE_PROJECT_DIR"

pnpm install --frozen-lockfile

(cd packages/console && go mod download)

pnpm wrangler d1 migrations apply DB --local
pnpm wrangler d1 execute DB --local --file scripts/seed-local.sql
