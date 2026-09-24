---
name: release
description: cut a release — the bake check, the annotated tag, the push that starts the build, and the seven assets it must land.
disable-model-invocation: true
---

# release

Publish the pair an operator installs: the console binary for four platforms and the worker bundle it uploads, with `checksums.txt` and `install.sh` beside them. `.github/workflows/release.yml` builds all of it, on a pushed `v*` tag or a manual `workflow_dispatch` that cuts the tag itself — nothing else starts it — so a release is one tag, and every step here is either in front of that tag or a reading of the run it started. The user typed `/release` asking for exactly that, so the only thing to put to them is the tag name in step 3.

**Two ways to cut the tag, one build behind both.** Starting the run from the Actions tab (step 5) is the default: a claude session on this repository can push a branch but github refuses its tag pushes (403), and the workflow's own gates check from `main`, the tag shape, that the tag is unspent, and that `ci.yml` is green on the exact commit — the same things this checklist has you check by hand before `git tag`. Pushing the tag yourself (the alternative under step 5) skips the dispatch and its gates, so this checklist's own steps 1–4 are what stand in for them.

**The tag is where the version is written.** The workflow builds under `BETTER_GIVING_VERSION="${GITHUB_REF_NAME#v}"` and goreleaser stamps the same string into the binary, so a deployment and the console reading it agree on one spelling. The `version` fields in the `package.json` files are the workspace's own and stay as they are.

**The run is paid by the minute and cross-builds four platforms**, which is why every check able to fail is in front of the tag push rather than behind it.

## Steps

1. **A clean `main` that the remote holds, gated green.** `git status -sb` names no modification and no `ahead` count: goreleaser writes the changelog from the commits since the previous tag, so a commit the remote does not have is a commit the release does not carry. Outstanding work is committed and pushed first, and `.github/workflows/ci.yml` runs the suite and the type check on that push — the whole of this repository's gate, and a suite green in this checkout is not a reading of it, because a checkout carries files git ignores. **The release workflow runs none of it**, so a red `main` tags and publishes without complaint. Done when the status is clean, level with `origin/main`, and `gh run list --workflow=ci.yml -L1` names that commit `success`.

2. **The bake still matches the app.** From `packages/console`: `go run ./cmd/bake --check`. It is the workflow's first step and the one failure a release cannot recover from afterwards — a binary whose baked config disagrees with `packages/app/wrangler.jsonc` refuses every deploy an operator presses. Repair with `go run ./cmd/bake` and commit what it rewrote. Done when the check exits quiet.

3. **The tag name** — `vMAJOR.MINOR.PATCH`, with an optional `-alpha.N`. Two facts decide it, and both belong in the sentence that asks the user which one this cut is:
   - **A pre-release tag publishes as an ordinary release, with the pre-release flag left off** — here and in github's own release form. `releases/latest` skips a flagged release, and `releases/latest/download/install.sh` is the address the operator documents publish; `.goreleaser.yaml`'s `release:` key argues the rest.
   - **`internal/update` orders by semantic version precedence** (`packages/console/internal/update/update.go`, `behind`), so a tag moving only its `-alpha.N` counter is an update, and every console carrying that reading offers it. A console installed from a release before `v0.0.2-alpha.1` reads the numbers alone and sees no such move: moving a number is what reaches those.

   **`git tag -l` sorts lexically**, so `v0.0.9-alpha.1` reads as the last of a set that already holds `v0.0.19-alpha.1`, and `tail` on it names the wrong release to follow: `--sort=v:refname` is what orders them. The local set is not the published one either — it can hold names the remote never took — so `gh release list -L1` is what says which version is spent. Done when the user has named a tag that neither already holds.

4. **The notes** — a short paragraph an operator reads on the release page saying what this cut changes, in the register of the one before it (`git tag -l -n20 <previous>`). Written down first because both paths in the next step want it as one piece of text, and one of them takes it as a form field rather than a shell argument. **It is the release page's text and nothing else** — the co-author trailer a commit message ends on is addressed to a reader of this repository's history, and an operator reading a release page is not one.

5. **Start the release.** The default is the workflow's own dispatch: the Actions tab's "Run workflow" on `release.yml`, or the GitHub API's workflow-dispatch call, run on `main` with `tag` and `notes` (step 4's paragraph) as the two inputs. The run itself checks `main`, the tag shape, that the tag is unspent, and that `ci.yml` concluded `success` on the exact commit, then cuts the annotated tag and carries on into the build — so a run that reaches the build already passed what this checklist's steps 1–4 stand in for by hand. **A hand-pushed tag is the alternative**, for when dispatching the workflow isn't reachable: `git tag -a <tag> -F <file>` with the file holding the tag on its first line, a blank line, then step 4's paragraph and no trailer (`git show <tag>` confirms the pair), then `git push origin main` followed by `git push origin <tag>` — the tag push is what starts the run, and pushing it ahead of the branch releases a commit the remote does not hold. Done when `gh run list --workflow=release.yml -L1` names the tag.

6. **The run, watched through.** `gh run watch <id> --exit-status` on that list's id. It is the heaviest thing this repository runs — a pnpm install, the app's vite build, wrangler, and four cross-builds — so it is a background command with one read at the end rather than a poll. Done when the run concludes success; a failure goes to the section below.

7. **All seven assets, read off the release.** `gh release view <tag> --json isPrerelease,assets`: four `better-giving_{darwin,linux}_{amd64,arm64}.tar.gz`, `checksums.txt`, `worker-<version>.tar.gz`, `install.sh`, and `isPrerelease` false. **Every release carries `install.sh`**, because `releases/latest/download/install.sh` resolves to the newest release's copy — one without it takes the install line down for everyone, not only for itself. Done when all seven are named and the flag is off.

8. **Report the install line**, and nothing the operator has to work out for themselves:
   `curl -fsSL https://github.com/better-giving/better-giving/releases/latest/download/install.sh | sh`

## A run that failed

**Ahead of goreleaser, nothing was published and the version is unspent**: repair it, commit, drop the tag on both sides (`git tag -d <tag>`, then `git push --delete origin <tag>`), and cut the same name again. **Once a release exists that version is spent** — an operator may already hold an asset from its address — so the repair is the next tag.
