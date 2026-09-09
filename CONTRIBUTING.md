# Contributing

## Setup

```sh
pnpm install
cp packages/app/.dev.vars.example packages/app/.dev.vars   # fill in ADMIN_PASSWORD at minimum
pnpm wrangler d1 migrations apply DB --local
pnpm wrangler d1 execute DB --local --file scripts/seed-local.sql  # the organisation row the dashboard is gated on
pnpm dev                                                   # http://localhost:5321
```

- `pnpm install` runs `prepare`: route typegen, `worker-configuration.d.ts`, git hooks. Stale types after editing `wrangler.jsonc` want `pnpm wrangler types`, not a reinstall.
- `pnpm dev` does not build the embed: `/embed.js` 404s until `pnpm run build` has run once.

Before changing code, read [`CLAUDE.md`](./.claude/CLAUDE.md) for the invariants, several non-obvious enough that inferring intent from the code gets them backwards.

## Dev servers

| command            | what                                    | port        |
| ------------------ | --------------------------------------- | ----------- |
| `pnpm dev`         | the app: `/admin`, `/api/v1`, and the donation page at `/{form_id}` | 5321        |
| `pnpm run console` | console screens + its Go api            | 5322 (5325) |
| `pnpm run gallery` | every `packages/operator` component     | 5323        |
| `pnpm run form`    | the donation form against fixtures      | 5324        |

**Console**: the Vite server proxies `/api` to `go run ./cmd/better-giving` (Go 1.24.2+, needed only by `packages/console` contributors; the commit hook skips `go-test` where Go is absent). The console operates a *deployed* Worker resolved off its Cloudflare sign-in, never your dev server.

**The deploy commands need a bundle you packed.** The binary a checkout builds is version `dev`, and there is no release under that name to fetch from, so `console:api` names a local one instead:

```sh
pnpm run bundle    # a couple of minutes
```

It builds the app, runs `wrangler deploy --dry-run`, and packs the result into `packages/console/bundle/worker-dev.tar.gz`. **The bundle is the app as it was when you packed it**: nothing re-packs it, so a change to `packages/app` or `packages/form` reaches a deployment only after this is run again.

**Form dev page**: fixtures answer the config read, payment surface and Turnstile stubbed, with no network. State lives in the query string, so a card worth showing somebody is a link.

**Gallery**: real components against the real stylesheets. A component's preview lands in the same change as the component: `packages/gallery/src/previews/` is globbed, so registration is the file existing.

The `/console` routes under `pnpm dev` take a bearer token (`CONSOLE_TOKEN` in `.dev.vars`):

```sh
TOKEN="bg1.$(( $(date +%s) + 43200 )).$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
echo "CONSOLE_TOKEN=$TOKEN" >> packages/app/.dev.vars     # restart pnpm dev
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5321/console
```

Building the binary an operator gets (the release workflow's own steps):

```sh
pnpm --filter @better-giving/console-ui build
rm -rf packages/console/ui/dist && cp -R packages/console-ui/build/client packages/console/ui/dist
cd packages/console && go build ./cmd/better-giving
```

The copy deletes a tracked placeholder. Restore it with `git checkout packages/console/ui/dist`. A locally built binary carries no version and deploys nothing until `BETTER_GIVING_BUNDLE` names a bundle you packed, so run it with the variable set the way `console:api` does, against what `pnpm run bundle` writes ([Dev servers](#dev-servers)).

## The workspace

Seven packages under `packages/`; commands run from the root:

- `packages/app` is the deployed Worker: React Router app, D1 server code, `/admin`, `/console` routes, and the donation page at `/{form_id}`.
- `packages/form` is the embeddable element and its flow logic, a permanent public contract; the donation page draws the same flow in React off the same machine.
- `packages/emails` is the mail templates, rendered to strings by the app at send time; `packages/emails-preview` is their preview page, dev-only.
- `packages/operator` is the leaf both operator surfaces consume: components, stylesheets, shared vocabulary.
- `packages/console-ui` is the console's screens; client-only React, embedded into the Go binary at `packages/console` beside it (no `package.json`, invisible to `pnpm -r`).
- `packages/gallery` is the component gallery, dev-only.

Which package may import which is enforced by `biome.jsonc`'s overrides (`CLAUDE.md` → *The map*). `pnpm run build` is three ordered steps, and `CLAUDE.md` holds the chain and what silently breaks when a step moves.

`pnpm run check` and `pnpm test` fan out one package at a time (`--workspace-concurrency=1`, because parallel workerd suites oversubscribe the machine).

## The commit hook

`lefthook.yml` gates every commit, and it is the only quality gate: nothing gates a push, a PR, or a deploy. In order, stopping at first failure: `format` (biome, writes fixes back), `check` (`tsc --noEmit` per package), `test`, `go-test`, `lint`. Broken tree onto a branch: `git commit --no-verify`, and nothing downstream re-runs these.

`packages/form`'s `test:browser` (real Chromium, two CSS properties a lightweight DOM cannot see) stays outside the hook.

## Tests

- **Anything touching the database is a `*.workers.spec.ts`**, real D1 inside workerd, running the committed `migrations/`. Everything else: node pool, with one exception. `packages/app`'s `src/lib/server/email/render.workers.spec.ts` touches no database and is in the workers pool because what it asserts is that a template renders on workerd at all. `packages/app` also has a happy-dom pool for mounted-screen presses.
- **Never stand in for D1.** The properties worth asserting (STRICT rejects a float, `batch()` rolls back, UNIQUE refuses a redelivered webhook) are D1's own; a hand-rolled adapter only proves the adapter.
- **Assert the extended result code's name, never the prose, and through the error's `cause` when drizzle is in the path.** Drizzle rethrows with the real message demoted to `.cause`, so a bare `toThrowError(/SQLITE_CONSTRAINT_FOREIGNKEY/)` passes vacuously. Use `src/lib/server/db/rejection.testing.ts`.

## The design system

The token files and their headers are the whole of it. A screen writes no value not in the token file it dresses; each surface's raw-values spec gates it. Nothing checks prose or component unions against the stylesheets, so changing a closed set in `adm.css` means reading the components for what went stale; `pnpm run gallery` shows it in one scroll.

## Migrations

The remote migration runs inside `pnpm run deploy`, after `build`, and it is a one-way door. `src/lib/server/db/schema.ts`'s header argues every rule here.

**`drizzle-kit generate` writes a draft.** Read every `.sql` before committing it:

- **Append `STRICT` by hand to every `CREATE TABLE`.** Drizzle cannot emit it, reports no drift, and there is no adding it to a shipped table. Without it `integer` is an affinity and a float reaches a money column. `strict.workers.spec.ts` gates it.
- **Append new columns after `archived_at`, never reorder.** A column inserted mid-table makes drizzle emit a rebuild whose copy step `SELECT`s a column the old table lacks, and D1's double-quoted-literal fallback turns it into the *text* of the column name in every row, silently.
- **A rebuild takes three hand-edits**: swap `PRAGMA foreign_keys` for `defer_foreign_keys` (the emitted one is a no-op inside the migration's transaction); put `STRICT` back on the `__new_` table; strip the outer backticks off a functional index.
- **Never drop a `.sql` into `migrations/` by hand.** Unregistered in `meta/_journal.json`, the next `generate` collides with it. Data-only → `drizzle-kit generate --custom`; DDL → schema change + plain `generate`, then hand-edit.
- **Reference data ships as an idempotent migration, never a seed script**: the migration is the only path that always reaches a fork.
- **Never renumber or rename an applied migration.** wrangler records applied files by filename, no checksum. A rename re-runs an old file (`table … already exists`); reusing a recorded filename is worse: it no-ops, and the deployment silently keeps an unmigrated schema under a green deploy.
- **The chain squashes into `0000_initial_schema.sql`, and that name never changes.** wrangler applies only files it has no record of, so a deployment that already ran the name skips the rewritten file and keeps the schema it has, while a fresh one lands on the same schema in a single apply. That file's own header carries the rest.
- **A migration's comments are frozen with its filename**, with one carve-out: `0000_initial_schema.sql` is rewritten in place by every squash, so it states the schema as it stands. Nothing distinguishes a reworded sentence from a loosened constraint against a file already run on somebody's database. Where a comment disagrees with the code, the code is current.

## Troubleshooting

**Every route 500s, everything else green.** Miniflare derives the local sqlite file from `database_id` in `wrangler.jsonc`, that field alone. Any change points `--local` at a fresh empty database; the auth middleware can't read the signing key and every request dies. This is most of why no `database_id` is committed: the one way to hit it is putting one back (`wrangler d1 create` offers to; `pnpm run db:create` passes `--no-update-config`). Fix:

```sh
pnpm wrangler d1 migrations apply DB --local
```

Same symptom after editing or renaming an applied migration file. Reset local state (safe, it's a cache):

```sh
rm -rf packages/app/.wrangler/state
pnpm wrangler d1 migrations apply DB --local
```

## Cutting a release

```sh
git tag v0.2.0
git push origin v0.2.0
```

`.github/workflows/release.yml` builds the console binaries (ui baked in), the worker bundle `better-giving start` and `better-giving update` upload, `checksums.txt`, and ships `install.sh` alongside. It deploys nothing and holds no Cloudflare credential. `go run ./cmd/bake --check` runs first: a baked config drifted from `wrangler.jsonc` fails the release, not the operator's first deploy. Fix with `go run ./cmd/bake` from `packages/console`, commit, tag again.

Locally, `goreleaser release --snapshot --clean` at the root builds the archives into `packages/console/dist/` without a tag.

The bundle those archives are deployed against is `pnpm run bundle`'s ([Dev servers](#dev-servers)).

Exercise `install.sh` against it by serving `packages/console/dist/` over http:

```sh
(cd packages/console/dist && python3 -m http.server 8099) &
BETTER_GIVING_DOWNLOAD_BASE=http://127.0.0.1:8099 BETTER_GIVING_INSTALL_DIR=/tmp/bg-bin sh scripts/install.sh
```

Also exercise the refusal: flip a byte in an archive, and the run must install nothing.
