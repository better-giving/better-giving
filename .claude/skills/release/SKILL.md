---
name: release
description: cut a release — main landed and green, the bake check, the tag name and notes, the dispatch that cuts the tag and builds, and the seven assets it must land.
disable-model-invocation: true
---

# release

Publish the pair an operator installs: the console binary for four platforms and the worker bundle it uploads, with `checksums.txt` and `install.sh` beside them. `.github/workflows/release.yml` builds all of it, started one of two ways and no other: a `workflow_dispatch` on `main` that cuts the tag itself, or a pushed `v*` tag. So a release is one tag, and every step here is either in front of that tag or a reading of the run that made it. The user typed `/release` asking for exactly that, so the only things to put to them are the tag name and its notes, in one message.

**The dispatch is the path, and the session starts it.** A claude session on this repository can push a branch and push `main`, but github refuses its tag pushes (403). The dispatch needs no tag push from anyone: the run checks it is on `main`, that the tag has the right shape, that the tag is unspent and that `ci.yml` concluded `success` on the exact commit; then it cuts the annotated tag and pushes it with its own token, just before goreleaser. **Never hand the user shell commands to finish a release.** The hand-pushed tag is only for someone at their own machine who chooses it (the end of step 5).

**A cloud session has no `gh`.** Where these steps read github, they name what is being read: the GitHub MCP tools where the session has them, else the public REST API over `curl` (the repository is public, so reads need no token). `gh` does the same on a machine that has it.

**The tag is where the version is written.** The workflow resolves the tag it releases — the dispatch input, or `GITHUB_REF_NAME` on a pushed tag — into `$RELEASE_TAG` once and builds under `BETTER_GIVING_VERSION="${RELEASE_TAG#v}"`. goreleaser stamps the same string into the binary, so a deployment and the console reading it agree on one spelling. The `version` fields in the `package.json` files are the workspace's own and stay as they are.

**The run is paid by the minute and cross-builds four platforms**, which is why every check able to fail runs before the dispatch, and the run's own gates run before its build.

## Steps

1. **The work is on `main`, and `ci.yml` is green on it.** goreleaser writes the changelog from the commits since the previous tag, so work still on a branch is work the release does not carry. A working branch lands the way the history already does it: `git merge --no-ff <branch> -m "Merge <branch>: <what it changes>"` on an up-to-date `main`, then `git push origin main`. `ci.yml` runs the suite and the type check on that push. It is the whole of this repository's gate, and a suite green in this checkout doesn't count, because a checkout carries files git ignores. Read the run for the exact head commit (`/repos/better-giving/better-giving/actions/workflows/ci.yml/runs?head_sha=<sha>`). It takes about three minutes, so make it one background loop that ends on `completed`, not repeated checks. Done when `git status -sb` is clean and level with `origin/main`, and that run concluded `success`.

2. **The bake still matches the app.** From `packages/console`: `go run ./cmd/bake --check`. The run repeats it as its first build step, but a failure there has already spent a paid run, and it is the one failure a release cannot recover from afterwards: a binary whose baked config disagrees with `packages/app/wrangler.jsonc` refuses every deploy an operator presses. Repair with `go run ./cmd/bake`, commit what it rewrote, and go back to step 1. Done when the check exits quiet.

3. **The tag name** — `vMAJOR.MINOR.PATCH`, with an optional `-alpha.N`. Propose the next one, and put two facts in the sentence that asks the user:
   - **A pre-release tag publishes as an ordinary release, with the pre-release flag left off** — here and in github's own release form. `releases/latest` skips a flagged release, and `releases/latest/download/install.sh` is the address the operator docs publish; `.goreleaser.yaml`'s `release:` key argues the rest.
   - **`internal/update` orders by semantic version precedence** (`packages/console/internal/update/update.go`, `behind`), so a tag that only moves its `-alpha.N` counter still counts as an update, and every console that orders that way offers it. A console installed from a release before `v0.0.2-alpha.1` compares only the numbers and sees no change; moving a number is what reaches those.

   **`git tag -l` sorts lexically**, so `v0.0.9-alpha.1` reads as the last of a set that already holds `v0.0.19-alpha.1`, and `tail` on it names the wrong release to follow. `--sort=v:refname` orders them. The local set is not the published one either — it can hold names the remote never took — so the published release list is what says which version is spent. Done when the user has named a tag that neither holds.

4. **The notes** — a short paragraph saying what this cut changes, for an operator, in the register of the one before it (`git tag -l -n20 <previous>`). Ask for it in the same message as step 3, with a draft built from the commits since the previous tag. The dispatch writes it into the tag's annotation, under the tag on the first line and with no trailer. **The release page opens with this paragraph**, above the commit list: `.goreleaser.yaml`'s `release.header` reads the tag's body, and GitHub renders that as Markdown — so write it as prose, with no leading `#` or `---` that would turn into a heading or a rule. Leave out the co-author trailer a commit message ends with — that trailer is for a reader of this repository's history.

5. **Start the release.** Dispatch `release.yml` on `main` with the inputs `tag` and `notes`: the GitHub MCP `actions_run_trigger` (`run_workflow`), the REST call `POST /repos/better-giving/better-giving/actions/workflows/release.yml/dispatches`, or the Actions tab's "Run workflow". Done when the newest `workflow_dispatch` run of `release.yml` is on step 1's commit.

   **A hand-pushed tag is the other way in**, for someone at their own machine who chooses it. The file holds the tag on its first line, a blank line, then step 4's paragraph. Run `git tag -a <tag> <sha> -F <file> --cleanup=verbatim` against step 1's commit — `--cleanup=verbatim`, because `-F` alone defaults to stripping any line that opens with `#`, which the release page would then open without. Confirm the shape before pushing (`git cat-file tag <tag>`: first line is the tag itself, a blank line, then the paragraph, no trailer) — the same check `.github/workflows/release.yml` runs on both its paths before this repository will build from it — then `git push origin <tag>`. It skips the run's other gates, so steps 1–3 plus that shape check are the only gate this path has.

6. **The run, watched through.** It is the heaviest thing this repository runs — a pnpm install, the app's vite build, wrangler, and four cross-builds, several minutes in all — so watch it with one background loop over that run's status (`/repos/better-giving/better-giving/actions/runs/<id>`) that reads the result once at the end. Done when it concludes `success`; a failure goes to the section below.

7. **All seven assets, read off the release** (`/repos/better-giving/better-giving/releases/tags/<tag>`): four `better-giving_{darwin,linux}_{amd64,arm64}.tar.gz`, `checksums.txt`, `worker-<version>.tar.gz`, `install.sh`, and `prerelease` false. **Every release carries `install.sh`**, because `releases/latest/download/install.sh` resolves to the newest release's copy — one without it takes the install line down for everyone, not only for itself. If the hand-tag path was used, `git fetch origin --tags`, deleting first any local tag of that name the remote's doesn't match — the dispatch path never creates a local tag, so this has nothing to do there. Done when all seven are named, the flag is off, and the local tag is the remote's.

8. **Report the install line**, and nothing the operator has to work out for themselves:
   `curl -fsSL https://github.com/better-giving/better-giving/releases/latest/download/install.sh | sh`

## A run that failed

**Stopped before the step "push the release tag"** — a gate, the bake check, a build, wrangler or the pack. Nothing reached the remote and the name is unspent. Repair it, land the repair through step 1, and dispatch the same name again.

**Stopped after the tag was pushed but before a release exists.** The name is on the remote, and this session cannot delete a remote tag. Cut the next name, or ask the user to delete that tag (`git push --delete origin <tag>`) if they want the name back.

**Once a release exists, that version is spent** — an operator may already hold an asset from its address — so the repair is the next tag.
