#!/bin/bash
# readies a claude code on the web session: workspace deps and the local database file that
# CONTRIBUTING.md → Setup builds. local only — nothing here reaches a deployment.
# the kru plugin is not installed here: skills load before this hook runs, so it belongs in the
# environment's setup script instead. registered in .claude/settings.json as a SessionStart hook on
# `startup|resume`.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "$CLAUDE_PROJECT_DIR"

# the environment's setup script (.claude/cloud-setup.md) installs pnpm at packageManager's version
# under ~/.local/share/pnpm, behind the image's own /opt/node22/bin, and the image's pnpm self-switches
# with lifecycle scripts off — so the pinned one goes first here and in every later shell.
ver=$(sed -n 's/.*"packageManager": *"pnpm@\([0-9.]*\).*/\1/p' package.json)
[ -n "$ver" ] || { echo "cloud-install: no pnpm pin in packageManager" >&2; exit 1; }
home="${PNPM_HOME:-$HOME/.local/share/pnpm}"
exe="$home/.tools/pnpm-exe/$ver/pnpm"

# the installer's `pnpm` is a wrapper that finds its binary beside its own path, so a symlink to it
# breaks and the binary itself is linked. it goes in a dir holding nothing else: /usr/local/bin
# carries a node 20 that would shadow the image's 22, which package.json's `engines` needs. pnpm 12's installer
# lays down no .tools binary, so its wrapper's own directory goes on PATH whole.
if [ -x "$exe" ]; then
  bin="$HOME/.kru-bin"
  mkdir -p "$bin"
  ln -sf "$exe" "$bin/pnpm"
else
  bin="$home/bin"
  [ -x "$bin/pnpm" ] || { echo "cloud-install: no pnpm $ver under $home" >&2; exit 1; }
fi
export PATH="$bin:$PATH"
# later shells read this file. without it they find the image's pnpm, which self-switches to
# `packageManager` with lifecycle scripts off.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

pnpm install --frozen-lockfile

# the file CONTRIBUTING.md → Setup names, relative to packages/app.
DATABASE_URL="file:local.db" pnpm db:migrate
DATABASE_URL="file:local.db" pnpm db:seed
