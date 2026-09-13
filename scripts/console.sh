#!/bin/sh
# `pnpm console`: the ui dev server and `better-giving start`, one process each.
#
# `start` signs in, picks a cloudflare account and may ask to update the deployment, all
# before it serves anything, so it needs a real terminal on stdin/stdout — it must own the
# foreground. the ui dev server has nothing interactive to say, so it runs quiet in the
# background and dies with this script: the terminal delivers ctrl-c to the whole foreground
# process group (both children are in it, same as `console-start.sh`'s note on `start`), and
# the trap below covers every other exit — `start` erroring out, refusing the update, or the
# script itself failing before it gets there.
#
# **posix sh** — no arrays, no `local`, no `[[`; there is nothing here that wants bash.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

pnpm --filter @better-giving/console-ui dev >/dev/null 2>&1 &
ui_pid=$!
trap 'kill "$ui_pid" 2>/dev/null || true' INT TERM EXIT

cd "$root/packages/console"
BETTER_GIVING_BUNDLE=bundle/worker-dev.tar.gz
export BETTER_GIVING_BUNDLE
go run ./cmd/better-giving start --no-open --port 5325
