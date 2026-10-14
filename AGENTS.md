# better-giving

Self-hosted donation forms for a single organisation. One deployment serves one org; a fork is how a second org gets one.

This file is the source of truth for stack, layout, commands, boundaries, and what an agent must not do. File headers still hold the argument for a rule about that file. `.claude/CLAUDE.md` imports this file and keeps only the kru seat sheet.

## Stack

- Node 22. CI's `actions/setup-node` uses `node-version: 22`. There is no `.nvmrc`. `package.json` `engines` is `>=22`. `@react-router/*` 8.3.0 requires `>=22.22.0`, and `.npmrc` sets `engine-strict`, so a 22 below that fails install.
- pnpm 10.19.0 (`packageManager`). No other package manager. No turbo.
- TypeScript 6.0.3 (catalog). `pnpm check` is the typecheck: there is no `typecheck` script.
- React 19.2.8, React Router 8.3.0 (framework mode), Vite 8.1.5, Vitest 4.1.10, Biome 2.5.9.
- The worker: Wrangler 4.124.0, `@cloudflare/vite-plugin`, D1. Drizzle 0.45.2. Zod 4.4.3. better-auth 1.6.25.
- The donation form: a custom element, xstate 5.32.5, `@stripe/stripe-js` 9.12.1, `@paypal/paypal-js` 11.0.1. Browser specs use Playwright 1.62.1.
- The console binary: Go 1.24.2 (`packages/console/go.mod`), `net/http`, Bubble Tea 1.3.10.
- Payments and books, each behind its own port: Stripe 22.4.0, `@paypal/paypal-server-sdk` 2.5.0, Chariot and NOWPayments and QuickBooks over `fetch` (no SDK), Zapier `zapier-platform-core` 19.1.0.

Dependencies are exact: no `^`, no `~`, in either block (`.npmrc` `save-exact`). The `wrangler` pin must equal the version `@cloudflare/vitest-pool-workers` depends on. Invoke Wrangler as `pnpm wrangler`, never global and never bare `npx`.

## Workspace

Eight packages under `packages/*`, and the graph is `app → operator ← console-ui`, with `gallery → operator`, `emails → operator`, `app → form` and `app → emails ← emails-preview` beside them. `zapier` reaches no package and none reaches it. Biome's `noRestrictedImports` overrides refuse a relative import that crosses that graph. A module arrives in `packages/operator` by being promoted, never by being copied.

| path | what it is |
| --- | --- |
| `packages/app` | The deployed Worker. React Router, `ssr: true`: `/admin`, `/donate`, `/{slug}`, `/api/v1`, `/console`, sign-in. D1, ledger, payments, mail send. |
| `packages/console` | The console's Go module. No `package.json`, so invisible to `pnpm -r`. Serves `packages/console-ui`'s build and draws a run in the terminal. |
| `packages/console-ui` | The console's screens. React Router, `ssr: false`. Client loaders and actions only. |
| `packages/operator` | Shared operator components, tokens, and the setup folds. Leaf of both operator surfaces. |
| `packages/form` | The embeddable donation element. A permanent public contract. |
| `packages/emails` | Mail templates, rendered to strings by the app. |
| `packages/emails-preview` | Dev-only preview of those templates. |
| `packages/gallery` | Dev-only component gallery (`pnpm run gallery`). Not an operator surface and never deployed. |
| `packages/zapier` | The Zapier integration, pushed with its own CLI. |
| `packages/design` | Artboards on the machine that drew them. Gitignored. No design rule is written there. |

`packages/form/` and `packages/app/src/lib/forms/` are not the same thing. Everything in the package is a permanent contract; nothing in `forms/` is. Anything under `$lib/server/**` may import the package; the package imports nothing from the app. A value the app needs that `packages/form`'s `exports` map does not already name is a decision to widen that map, never a line added in passing.

Operator commands run at the repo root. The root `package.json` forwards them into `packages/app`. From inside a package the spelling is `pnpm -w run <script>`.

## Commands

Run from the repo root. These are the commands CI runs (`.github/workflows/ci.yml`). Done means the same four jobs are green. Nothing gates a local commit.

| CI job | command |
| --- | --- |
| install | `pnpm install --frozen-lockfile` (`prepare` generates route types and `worker-configuration.d.ts`) |
| checks | `pnpm exec biome format .` then `pnpm lint` then `pnpm check` |
| test | `pnpm test` |
| browser-test | in `packages/form`: `pnpm exec playwright install --with-deps chromium`, then `pnpm --filter @better-giving/form test:browser` |
| go-test | `go test ./...` in `packages/console` (Go 1.24.2) |

- Lint is `biome lint .`. Format a path with `pnpm exec biome format --write <paths>`. CI's format check does not write.
- `pnpm check` is `pnpm -r --workspace-concurrency=1 check`: each package's `tsc --noEmit`, plus `react-router typegen` in `packages/app` and `packages/console-ui`.
- `pnpm test` is `pnpm -r --workspace-concurrency=1 test`. One package at a time, because parallel workerd suites oversubscribe the machine. It does not run `test:browser` and it cannot see the Go module.
- A full `pnpm test` is about five minutes on a 4-core machine (measured 2026-09-24: 291 s wall, most of it `packages/app`). No single file's tests ran past 7 s. A one-file run is cheap: `pnpm --filter @better-giving/app exec vitest --run <path>`.
- `pnpm build` builds the worker: `packages/form` into its `dist/`, `packages/app/scripts/stage-embed.js` copies that into `packages/app/static/`, then `vite build`. Drop or reorder the middle step and the build stays green while `/embed.js` 404s. `packages/app/scripts/preflight-deploy.js` catches that by counting files.
- Dev, when asked: `pnpm dev` on port 5321. It needs `packages/app/.dev.vars` (copy `.dev.vars.example`; `ADMIN_PASSWORD` at minimum) and a local D1 (`pnpm wrangler d1 migrations apply DB --local`, then `pnpm wrangler d1 execute DB --local --file scripts/seed-local.sql`). `pnpm dev` does not build the embed.

Tests are hermetic. Workers specs run the committed migrations against D1 inside workerd. They need no production secret, no Cloudflare account, and no network to a processor.

The console's prompt tests drive huh with keystrokes. huh treats `TERM=dumb` as its accessible mode, and that path panics on those keystrokes (`packages/console/internal/terminal`). A cloud shell often sets `TERM=dumb`. CI does not. Run the Go tests with `TERM=xterm-256color`.

If `node_modules` is missing, run `bash .cursor/install.sh` from the repo root before lint, check, or test. It is idempotent and installs no production secrets.

## Cursor cloud

`.cursor/environment.json` has two commands, both `bash .cursor/install.sh` (start no-ops if that file is not there yet). `terminals` is not set: that field is for long-running processes, and this install must exit.

- `install` runs when Cursor builds a snapshot. Builds use the default branch (`main`). Until this file is on `main` and a build succeeds, a snapshot does not contain this install. An agent that boots from that snapshot (`reuse_then_checkout`) checks the branch out on top and does not run `install` again.
- `start` runs on every boot, after that checkout, including while the snapshot is still the one built from `main`. It is not waited on. If `node_modules` is still missing when you begin, run the script yourself.

The image PATH lists `/exec-daemon` before nvm, and `/exec-daemon/node` is v22.14, below the 22.22 floor. nvm's default is Node 22 (22.23.3 on this image), which meets the floor. `install.sh` sets that default and writes `~/.better-giving-node.sh`, sourced from `~/.bashrc`, `~/.profile`, and `/etc/profile.d/better-giving-node.sh`, which prepends nvm's bin. Login shells, including `start`, source those. The agent command shell does not, so the script also links `node`, `npm`, `npx`, and `pnpm` into `/usr/local/cargo/bin`, which the image PATH lists before `/exec-daemon`. `command -v node` should then be that link, and `node -p process.versions.node` should be at least 22.22.0.

## Boundaries

**Two operator surfaces.** The dashboard is `/admin` on a deployment. The console is the Go binary an operator runs on their own machine; it serves `packages/console-ui` and is never deployed (`packages/console-ui/src/never-deployed.spec.ts`). A sentence about both says operator screens. Neither word means a terminal window. The deploy is `better-giving start` / `better-giving update` in the terminal the operator typed them in, and no screen draws it.

The console holds the one true thing about this deployment and this organisation (account, database, configuration values, processor keys, sites, organisation profile). The dashboard holds the records (forms, donations, donors, recurring gifts) and the pages donors read. The dashboard has no organisation screen, and it is not served until setup is finished. The five jobs are `packages/operator/src/setup-folds.ts`'s `SETUP_JOBS`. `FOLD_LABELS` names six folds; the sixth is not a job.

**Design systems never meet.** The donation form dresses from `packages/form/src/styles/tokens.css` (`custom-elements.json` is what an integrator may set). Operator surfaces dress from `packages/operator/src/styles/tokens.css`, `base.css`, and `adm.css`. `/admin` derives no colour from a `--donate-*` seed or a `::part()` name. No `/admin` screen gets a `*.browser.spec.ts`. A value a screen needs that the token file cannot express is a gap to report. A deliberate exception is a `raw-colour-ok:`, `raw-length-ok:`, or `type-ok:` note on the line, never a change to the gate.

**Payments** go through the `PaymentProvider` port, never a processor SDK directly (`sole-importer.spec.ts`). **Email** goes through the `EmailProvider` port. SMTP is the interface. Nothing selects a transport.

**Secrets** live only under `packages/app/src/lib/server/**` and are deploy-time, never rows in a settings table. Two carve-outs: a key the app mints for itself, and a credential the app refreshes for itself (`quickbooksConnection` in `schema.ts`). Every configuration value `packages/operator/src/deploy-split.ts` lists is a plain Worker var, never a Worker secret. The console's session token is the one Worker secret, and it is on no enumeration.

**Storage.** D1 is the database and there is no second one. `packages/app/src/lib/server/db/client.ts` is the only module that names it. Photos are D1's too. A page is a flat document in a D1 JSON column. D1 read replication stays `disabled`.

**Routes.** `/api/v1` is public, unauthenticated, and payment-initiating. `/integrations/v1` is the read API an organisation's own systems call: key-authenticated, read-only, no CORS, and never under `/api/v1`. `/connector/v1` is the surface Better Giving's central Claude and ChatGPT connector calls, beside `/integrations/v1` and never under `/api/v1`. A deployment never needs the connector to work. This deployment serves no auth HTTP API: better-auth's router is never mounted.

**Runtime.** Nothing built from a binding is a module-scope singleton. The request body is read exactly once, by the endpoint that owns it. Reads are loaders; writes are actions or endpoints.

**Schema.** Single-tenant: no `org_id`. No mechanism may let an org add a column. Migrations are never an app-boot side effect. Two paths touch a production schema: the `deploy` script from a checkout, and `better-giving start` (`packages/console/internal/migrate`).

The map of which file argues which rule is the table in `.claude/CLAUDE.md` as it stood before this split; the headers it names are still the arguments. The sections below are the rules an agent can break without opening those files.

## Never

- Never run `pnpm deploy`, `pnpm deploy:test`, `pnpm deploy:vars`, `pnpm secret:delete`, or any Wrangler command that writes to a Cloudflare account (`wrangler deploy`, `wrangler secret`, `wrangler d1 create`, `d1 migrations apply` without `--local`). `deploy:vars` writes configuration values onto a deployment. A test deployment is still a deployment.
- Never commit a secret, a `.dev.vars`, or a `.env`. `.dev.vars.example` holds names only.
- Never commit a deployment artifact: `database_id`, `account_id`, `zone_id`, or a deployed hostname. `wrangler d1 create` offers to write the id back into `packages/app/wrangler.jsonc` and defaults to yes; the repo's `db:create` passes `--no-update-config`.
- Never hand-edit an applied migration. Wrangler records applied files by filename and has no checksum, so a changed file does not re-run and a deployment keeps the old schema. A new file from `drizzle-kit generate` is a draft and is hand-edited before it is committed (`CONTRIBUTING.md` → Migrations: `STRICT`, column order, rebuild fixups). That edit happens before the file is applied, not after.
- Never renumber or rename a migration. A rename re-runs an old file; reusing a recorded filename no-ops. The chain squashes into `0000_initial_schema.sql`, and that name never changes. Never drop a `.sql` into `packages/app/migrations/` by hand.
- Never commit `pnpm-lock.yaml` edits made by hand, and never edit `.github/workflows/` without the task asking for it.
- Never move a deploy step to after the migration. The build, then `packages/app/scripts/preflight-deploy.js`, then the migration. Never gate on a command that does not pass.
- Never weaken a `sole-*.spec.ts` gate (ledger writer, refund writer, payment importer, recurring inserter, contact updater) to make a change compile.
- Never log or return a staff password, a processor key, a connector key, or a session token.
- Never add an `/admin` browser spec, a second database, an `org_id`, or an auth HTTP route.

## Ledger, gifts, and schema

The ledger (`packages/app/src/lib/server/ledger/posting.ts`) is the only module that may insert, gated by `sole-writer.spec.ts`. Every total is a `SUM` at read time. Multi-row writes go in one atomic `batch()`. No invariant is enforced by an atomic read-then-write. A SQLite-backed Durable Object is not an escape hatch.

A repeating gift's row is written by the first charge that settles, from `packages/app/src/lib/server/recurring/collect.ts`, the only module that may insert into `recurring_plan`. The gift itself is recorded at authorization. The first settled charge claims that row rather than inserting a second. No name a donor typed reaches the processor. The donation path never gates on the recurring capability.

`drizzle-kit generate` writes a draft. Read every `.sql` before committing it. Append `STRICT` by hand to every `CREATE TABLE`. Append new columns after `archived_at`, never reorder. Reference data ships as an idempotent migration, never a seed script. A migration's comments are frozen with its filename, except `0000_initial_schema.sql`, which a squash rewrites in place. `CONTRIBUTING.md` → Migrations is the full list, including the rebuild hand-edits.

## Permanent contracts

Nothing here is deployed for real yet, and nobody has pasted the snippet. A contract below is permanent by decision. Weigh a fix on its own merits. Delete this paragraph the day a real organisation deploys.

- `v1`. Breaking changes ship as `v2` alongside.
- The element's public style surface: `--donate-*` seeds and `::part()` names. Everything derived from a seed is `--_`-prefixed and private. `packages/form/custom-elements.json` ships in the same commit as any change to that list.
- The element's public attributes stay primitive.
- The resume stamp `bg_donate_form` (`RESUME_FORM_PARAM` in `packages/form/src/embed/resume.ts`).
- `main` in `packages/app/wrangler.jsonc` is the worker entry's source, and there is no `assets` block. The environment is chosen at build time by `CLOUDFLARE_ENV`. `--env` on the deploy cannot change it. `pnpm run deploy:test` sets both, and `preflight-deploy.js` refuses the pair when they disagree. Do not run it.

## Product surface

- Donor-facing pages are `/donate` and each live campaign at its own address. A gift there is a real gift on whatever keys the deployment holds. A form is pageless. A campaign address never shadows a route (`packages/app/src/lib/page/slug.ts`).
- A page is arranged from a fixed set of blocks. `packages/app/src/lib/page/catalog.ts`'s `parsePage` is the only parser of a stored page.
- A deployment calls no AI model and binds no AI service.
- The repo contains no org-editable files.
- The form's flow logic imports no framework. One machine and one `v1` client under `packages/form/src/`.
- UI strings say what a fundraiser says. Schema table names never reach a screen.

## Comments

A comment states the rule, never the deliberation that produced it. It must be complete to someone holding only this repository. Anchor a claim to a file and line, a test name, `AGENTS.md`, `README.md`, `DEPLOY.md`, `CONTRIBUTING.md`, or a public URL. Comments are lowercase prose. Capitals are for acronyms, SQL keywords, `SQLITE_*` codes, env-var and constant names, and files spelled that way.

## Tests

Anything touching the database is a `*.workers.spec.ts`: real D1 inside workerd, running the committed migrations. Assert the extended result code's name, never the prose, and through the error's `cause` when drizzle is in the path (`packages/app/src/lib/server/db/rejection.testing.ts`). Never stand in for D1 with a hand-rolled adapter.
