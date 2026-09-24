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
# under ~/.local/share/pnpm, behind the image's own /opt/node22/bin, and the image's pnpm self-switches
# with lifecycle scripts off — so the pinned one goes first here and in every later shell. the
# installer's `pnpm` is a wrapper that finds its binary beside its own path, so a symlink to it
# breaks and the binary itself is linked. it goes in a dir holding nothing else: /usr/local/bin
# carries a node 20 that would shadow the image's 22, and wrangler refuses 20.
cd "$CLAUDE_PROJECT_DIR"

version=$(sed -n 's/.*"packageManager": *"pnpm@\([^"+]*\).*/\1/p' package.json)
pinned="$HOME/.local/share/pnpm/.tools/pnpm-exe/$version/pnpm"
bin="$HOME/.local/share/pnpm-pin"
if [ -x "$pinned" ]; then
  mkdir -p "$bin" && ln -sf "$pinned" "$bin/pnpm"
else
  echo "session-start: no pnpm $version at $pinned — the image's own will self-switch" >&2
fi
export PATH="$bin:$PATH"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

pnpm install --frozen-lockfile

(cd packages/console && go mod download)

pnpm wrangler d1 migrations apply DB --local
pnpm wrangler d1 execute DB --local --file scripts/seed-local.sql
