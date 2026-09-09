---
name: release
description: cut a release — check the bake, tag the commit, push it, and watch the one workflow that builds the binaries and the worker bundle.
disable-model-invocation: true
---

# release

Publish what an operator installs: the console binary for four platforms, the worker bundle that binary uploads, `checksums.txt`, and `install.sh` beside them. `.github/workflows/release.yml` does all of it and runs on a pushed `v*` tag and nothing else — so the whole of a release is the tag, and every step here is either in front of that tag or a reading of the run it started.

**The tag is the version, and no file in the tree records it.** The workflow builds the app under `BETTER_GIVING_VERSION="${GITHUB_REF_NAME#v}"` and goreleaser stamps the same string into the binary, which is how a deployment and the console that reads it agree on one spelling. Nothing is bumped before tagging; the `version` fields in the `package.json` files are not this version and are not touched.

**A run is billed per minute and cross-builds four platforms.** A re-tag is a second one, so the checks below go in front of the push rather than after it.

## Steps

1. **Be on `main`, clean, and pushed.** `git status -sb` shows no modifications and no `ahead`; a release is cut from what the remote holds, and goreleaser writes the changelog from the commits since the previous tag. Uncommitted work is committed first — `lefthook.yml` runs the suite and the type check on that commit, which is the only gate this repository has.

2. **Check the bake.** From `packages/console`: `go run ./cmd/bake --check`. It is the workflow's first step and the one failure a release cannot recover from afterwards — a binary whose baked config disagrees with `packages/app/wrangler.jsonc` refuses every deploy an operator presses. Repair with `go run ./cmd/bake`, commit what it rewrote, then carry on.

3. **Name the tag.** `vMAJOR.MINOR.PATCH`, with an optional `-alpha.N`. Two things decide the spelling:
   - **A pre-release tag is published as an ordinary release, on purpose** — `.goreleaser.yaml`'s `release:` key argues it. Never flag one as a pre-release, here or in github's own form: `releases/latest/download/install.sh` is the address the operator documents publish, and `releases/latest` skips anything flagged.
   - **`internal/update` cuts everything after the numbers** (`packages/console/internal/update/update.go`, `numbered`), so a tag that moves only the `-alpha.N` counter reads as the same version to every binary already installed and no console says a newer release exists. Move a number when installed consoles should hear about it.

4. **Tag it, annotated** — `git tag -a v0.0.2 -F <file>`, with the message written to a file first so its paragraph survives the shell. First line the tag itself, then a short paragraph an operator reads on the release page saying what this cut changes. The previous tag is the shape to follow: `git tag -l -n20 <previous>`.

5. **Push the branch, then the tag.** `git push origin main` and `git push origin v0.0.2`. The tag push is what starts the run; pushing it ahead of the branch releases a commit the remote does not hold.

6. **Watch the run.** `gh run watch $(gh run list --workflow=release.yml -L1 --json databaseId -q '.[0].databaseId')`. It is the heaviest thing this repository runs — a pnpm install, the app's vite build, wrangler, and four cross-builds.

7. **Read the assets.** `gh release view v0.0.2 --json assets -q '.assets[].name'` holds all seven: four `better-giving_{darwin,linux}_{amd64,arm64}.tar.gz`, `checksums.txt`, `worker-<version>.tar.gz`, and `install.sh`. **`install.sh` missing is the one that breaks the install line for everyone**, because that address resolves to the newest release's copy.

8. **Report the install line**, and nothing else the operator has to work out:
   `curl -fsSL https://github.com/better-giving/better-giving/releases/latest/download/install.sh | sh`

## If the run fails

**Before goreleaser, nothing was published**, so the version is unspent: fix, commit, delete the tag on both sides (`git tag -d v0.0.2` and `git push --delete origin v0.0.2`), and cut it again. **Once a release exists, the version is spent** — assets are downloaded by address and an operator may already hold one, so the repair is the next tag rather than a moved one.
