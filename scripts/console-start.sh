#!/bin/sh
# `better-giving start` out of this checkout: the deploy an operator makes with an installed binary,
# made with the one built from the tree in front of you.
#
#   pnpm start [<flags for `start`>]
#
# **it is fresh every run and takes no flag of its own.** the bundle is repacked and the ui is
# rebuilt before the deploy, because the two are the only things about this path that can be stale
# and a run that reused either would deploy code that is not the tree. the arguments are `start`'s
# own — `-port`, `-no-open` — and nothing here consumes any.
#
# an installed binary carries a version, and a deploy fetches the worker bundle that release was cut
# with. a binary built here is version `dev`, so the address it derives points at a tag that was
# never cut and the press refuses over a release carrying no worker-dev.tar.gz. `BETTER_GIVING_BUNDLE`
# is the override that names a packed one instead (packages/console/internal/release/bundle.go), and
# naming it is the whole of what this script does that a bare `go run` does not.
#
# **the built ui is put back the way it was found.** the binary carries packages/console/ui/dist and
# the release is what builds the react app into it; a checkout holds one committed index.html there,
# which this overwrites and restores on the way out, so a run does not leave a tracked file changed.
# `pnpm console` is the other way to reach the screens and the one a contributor wants while
# changing them — it draws from vite and rebuilds as they type.
#
# it is the root package.json's `start`, which is where every operator command in this repository is
# spelled from (CLAUDE.md's contract on the root forwarders).
#
# **posix sh** — no arrays, no `local`, no `[[`; there is nothing here that wants bash.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
dist=$root/packages/console/ui/dist
placeholder=packages/console/ui/dist/index.html

# the tree as it was: the built files are ignored and the placeholder is not, so restoring it is
# what keeps `git status` reading the same before and after. it runs on the way out however the run
# ended, a ctrl-c included.
restore() {
	rm -rf "$dist"
	git -C "$root" checkout -- "$placeholder"
}

cd "$root"
pnpm run bundle
pnpm --filter @better-giving/console-ui build

trap restore INT TERM EXIT
rm -rf "$dist"
cp -R "$root/packages/console-ui/build/client" "$dist"

# relative to the module, which is where the go command runs.
BETTER_GIVING_BUNDLE=bundle/worker-dev.tar.gz
export BETTER_GIVING_BUNDLE
cd "$root/packages/console"
# not exec'd: the restore above is this shell's to run once the deploy has ended. ctrl-c reaches the
# run anyway — the terminal sends it to the whole foreground group.
go run ./cmd/better-giving start "$@"
