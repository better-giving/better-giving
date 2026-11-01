# Contributing

This file is for changing the code. Running it is [the README](README.md). A host or Fly.io is [Deployment](DEPLOY.md). What the system is made of is [Architecture](docs/architecture.md). The invariants are [`AGENTS.md`](AGENTS.md).

## Setup

Node 22.22 or newer, and pnpm 10.19.0. The root `package.json` says `"node": ">=22"` and `packageManager` is `pnpm@10.19.0`. `.npmrc` sets `engine-strict`. `react-router` requires `>=22.22.0`, so a 22 below that fails `pnpm install`. Enable pnpm with `corepack enable`.

```sh
pnpm install
cp .env.example packages/app/.env                       # fill in ADMIN_PASSWORD at minimum
echo 'DATABASE_URL="file:local.db"' >> packages/app/.env
pnpm db:migrate
pnpm db:seed          # the registered name, EIN and notification address a live form needs
pnpm dev              # http://localhost:5321
```

- `pnpm dev` and the `db:*` commands run inside `packages/app` and read `packages/app/.env` (`node --env-file-if-exists=.env`). The root `.env` is what Compose reads, and `pnpm dev` never reads it. A relative `file:` URL is relative to `packages/app`.
- `pnpm dev` fires no scheduled runs, so the local database is written by nobody but you.
- A glibc host only. `pnpm-workspace.yaml`'s `ignoredOptionalDependencies` skips the libSQL musl bindings everywhere, so on Alpine or another musl Linux the driver has no native binding and the first database open fails.
- `pnpm install` runs `prepare`: route typegen.
- `pnpm dev` does not build the embed: `/embed.js` 404s until `pnpm run build` has run once. The build is `build:embed`, then `packages/app/scripts/stage-embed.js`, then `vite build` (`packages/app/package.json`). Drop or reorder the middle step and the build stays green while `/embed.js` 404s.

## Dev servers

| command            | what                                    | port        |
| ------------------ | --------------------------------------- | ----------- |
| `pnpm dev`         | the app: `/admin`, `/api/v1`, and the Donation page at `/donate`    | 5321        |
| `pnpm run gallery` | every `packages/operator` component     | 5323        |
| `pnpm run form`    | the donation form against fixtures      | 5324        |
| `pnpm run emails`  | the mail templates                      | 5327        |

**Form dev page**: fixtures answer the config read, payment surface and Turnstile stubbed, with no network. State lives in the query string, so a card worth showing somebody is a link.

**Gallery**: real components against the real stylesheets. A component's preview lands in the same change as the component: `packages/gallery/src/previews/` is globbed, so registration is the file existing.

## The workspace

Commands run from the root. What each package is, and which may import which, is [Architecture](docs/architecture.md). `pnpm run check` and `pnpm test` fan out one package at a time (`--workspace-concurrency=1` on those scripts in the root `package.json`, because parallel suites oversubscribe the machine).

## CI

`.github/workflows/ci.yml` gates a push to `main` and every pull request, and it is the only quality gate: nothing gates a local commit. Four independent jobs, each its own check: `checks` (a non-writing `biome format`, `lint`, `check`), `test`, `browser-test` (`packages/form`'s `test:browser`, real Chromium, two CSS properties a lightweight DOM cannot see), `docker-build` (the root `Dockerfile`, built and discarded).

## Tests

- **Anything touching the database is a `*.db.spec.ts`**: a real libSQL file per spec file, in a temp directory, with the committed `migrations/` applied (`src/lib/server/db/database.testing.ts`). Everything else is a `*.spec.ts` in the node `server` project. `packages/app` also has a happy-dom `dom` project (`*.dom.spec.tsx`) for mounted-screen presses.
- **NOWPayments' notifications never reach `pnpm dev`.** Each payment names its own callback address and NOWPayments posts to it from outside, so nothing arrives on localhost and there is no sandbox this app calls. The crypto settle path is tested only against signed fixture bodies (`api.nowpayments.webhook.db.spec.ts`), and its first real notification is on a deployment.
- **Never stand in for the database.** The properties worth asserting (STRICT rejects a float, `batch()` rolls back, UNIQUE refuses a redelivered webhook) are the database's own; a hand-rolled adapter only proves the adapter.
- **Assert the extended result code's name, never the prose, and through the error's `cause` when drizzle is in the path.** Drizzle rethrows with the real message demoted to `.cause`, so a bare `toThrowError(/SQLITE_CONSTRAINT_FOREIGNKEY/)` passes vacuously. Use `src/lib/server/db/rejection.testing.ts`.

## The design system

The token files and their headers are the whole of it. A screen writes no value not in the token file it dresses; each surface's raw-values spec gates it. Nothing checks prose or component unions against the stylesheets, so changing a closed set in `adm.css` means reading the components for what went stale; `pnpm run gallery` shows it in one scroll.

## Migrations

A migration reaches a database through `pnpm db:migrate` or Compose's `migrate` service, before the server starts, and on Fly the machine runs `node scripts/migrate.ts` before the server (`fly.toml`). It is a one-way door. `packages/app/src/lib/server/db/schema.ts`'s header argues every rule here. The client is `@libsql/client` 0.18.0, SQLite 3.45.1.

**`drizzle-kit generate` writes a draft.** Read every `.sql` before committing it:

- **Append `STRICT` by hand to every `CREATE TABLE`.** Drizzle cannot emit it and reports no drift. Without it `integer` is an affinity and a float reaches a money column. `strict.db.spec.ts` gates it. Put it on the table at birth, including a rebuild's `__new_` table.
- **Append new columns after `archived_at`, never reorder.** A column inserted mid-table makes drizzle emit a rebuild whose copy step `SELECT`s a column the old table lacks. This client is built with `DQS=0`, so that statement raises `no such column` and the migration rolls back. It does not write the column's name into the rows.
- **A rebuild takes these hand-edits**: swap `PRAGMA foreign_keys` for `defer_foreign_keys` (the emitted one is a no-op inside the migration's transaction, and where a file holds two rebuilds drizzle wraps only the first, and one deferral covers the file); put `STRICT` back on the `__new_` table; strip the outer backticks off a functional index; and where the table has a foreign key to itself, create the index on that column on the `__new_` table before the `DROP`, under a `__new_` name dropped after the rename (without it the drop is rows × rows). On this client a `RENAME` rewrites a `CHECK` that still says `"__new_<table>"`.
- **Never drop a `.sql` into `migrations/` by hand.** Unregistered in `meta/_journal.json`, the next `generate` collides with it. Data-only → `drizzle-kit generate --custom`; DDL → schema change + plain `generate`, then hand-edit.
- **Reference data ships as an idempotent migration, never a seed script**: the migration is the only path that always reaches a fork.
- **Never renumber or rename an applied migration.** The migrate command records applied files by filename, no checksum. A rename re-runs an old file (`table … already exists`); reusing a recorded filename is worse: it no-ops, and the deployment silently keeps an unmigrated schema under a green deploy.
- **The chain squashes into `0000_initial_schema.sql`, and that name never changes.** The migrate command applies only files it has no record of, so a deployment that already ran the name skips the rewritten file and keeps the schema it has, while a fresh one lands on the same schema in a single apply. That file's own header carries the rest.
- **A migration's comments are frozen with its filename**, with one carve-out: `0000_initial_schema.sql` is rewritten in place by every squash, so it states the schema as it stands. Nothing distinguishes a reworded sentence from a loosened constraint against a file already run on somebody's database. Where a comment disagrees with the code, the code is current.

## Troubleshooting

**Pages that read a table 500.** A database the migrations never reached fails every loader that reads a table, `/admin` and `/donate` included, typically after pulling a branch with a new migration, or when `DATABASE_URL` names a different file from the one you migrated. Fix:

```sh
pnpm db:migrate
```

Same symptom after editing or renaming an applied migration file. Start the local database again (safe, nothing else reads it):

```sh
rm -f packages/app/local.db packages/app/local.db-wal packages/app/local.db-shm
pnpm db:migrate && pnpm db:seed
```
