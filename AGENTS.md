# better-giving

Self-hosted donation forms for a single organisation. One deployment serves one org; a fork is how a second org gets one.

File headers still hold the argument for a rule about that file.

## Stack

- `package.json` `engines` is `>=22`. `@react-router/*` requires `>=22.22.0`, and `.npmrc` sets `engine-strict`, so a 22 below that fails install.
- The donation form is a custom element. Browser specs use Playwright in `packages/form`.
- The app is a Node server (`packages/app/server/index.ts`) in one container (`Dockerfile`, `compose.yaml`) against one libSQL database file.
- Payments and books each sit behind their own port. Chariot, NOWPayments, and QuickBooks use `fetch`.
- Other package versions are the `pnpm-workspace.yaml` catalog.

Dependencies are exact: no `^`, no `~`, in either block (`.npmrc` `save-exact`).

## Workspace

Seven packages under `packages/*`, and the graph is `app → operator ← console-ui`, with `gallery → operator`, `emails → operator`, `app → form` and `app → emails ← emails-preview` beside them. `zapier` reaches no package and none reaches it. Biome's `noRestrictedImports` overrides refuse a relative import that crosses that graph. A module arrives in `packages/operator` by being promoted, never by being copied.

| path | what it is |
| --- | --- |
| `packages/app` | The deployed server. React Router, `ssr: true`: `/admin`, `/donate`, `/{slug}`, `/api/v1`, `/console`, sign-in. Database, ledger, payments, mail send, scheduled runs. |
| `packages/console-ui` | The console's screens. React Router, `ssr: false`. Client loaders and actions only. Served by the app in a later change. |
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

Run from the repo root. These are the commands CI runs (`.github/workflows/ci.yml`). Done means the jobs in that workflow are green. A Claude Code commit runs `.claude/skills/verify/SKILL.md` first; nothing else gates a local commit.

`prepare` on that install generates route types.

| CI job | command |
| --- | --- |
| checks | `pnpm install --frozen-lockfile`, then `pnpm exec biome format .`, then `pnpm lint`, then `pnpm check` |
| test | `pnpm install --frozen-lockfile`, then `pnpm test` |
| browser-test | `pnpm install --frozen-lockfile`, then in `packages/form`: `pnpm exec playwright install --with-deps chromium`, then `pnpm --filter @better-giving/form test:browser` |
| docker-build | builds the root `Dockerfile` and pushes nothing |

- Format a path with `pnpm exec biome format --write <paths>`. CI's format check does not write.
- `pnpm test` does not run `test:browser`.
- A full `pnpm test` is about five minutes on a 4-core machine. A one-file run is `pnpm --filter @better-giving/app exec vitest --run <path>`.
- `pnpm build` builds the app: `packages/form` into its `dist/`, `packages/app/scripts/stage-embed.js` copies that into `packages/app/static/`, then `vite build`. Drop or reorder the middle step and the build stays green while `/embed.js` 404s.
- `pnpm db:migrate`, `pnpm db:seed` and `pnpm db:backup <file>` act on the file `DATABASE_URL` names. Run from the root, they read `packages/app/.env`.
- Dev, when asked: `CONTRIBUTING.md` → Setup.

Tests are hermetic. They need no production secret and no network to a processor.

If `node_modules` is missing, run `bash .cursor/install.sh` from the repo root before lint, check, or test. It is idempotent and installs no production secrets.

## Cursor cloud

`.cursor/environment.json` runs `bash .cursor/install.sh` for `install` and for `start` (start no-ops when that file is absent). The script has to exit.

- `install` runs when Cursor builds a snapshot. Builds use the default branch (`main`). Until this file is on `main` and a build succeeds, a snapshot does not contain this install. An agent that boots from that snapshot (`reuse_then_checkout`) checks the branch out on top and does not run `install` again.
- `start` runs on every boot, after that checkout, including while the snapshot is still the one built from `main`. It is not waited on. If `node_modules` is still missing when you begin, the fallback under Commands applies.

The image PATH lists `/exec-daemon/node` (v22.14, below the 22.22 floor) before nvm. `.cursor/install.sh` puts a Node that meets the floor ahead of it, including for the agent command shell, which sources no profile. `node -p process.versions.node` should be at least 22.22.0.

## Boundaries

**Two operator surfaces.** The dashboard is `/admin` on a deployment. The console is `packages/console-ui`'s screens, served by the app in a later change. A sentence about both says operator screens. Neither word means a terminal window.

The console holds the one true thing about this organisation (sites, organisation profile, notification address). Configuration values and processor keys are environment variables. The dashboard holds the records (forms, donations, donors, recurring gifts) and the pages donors read. The dashboard has no organisation screen, and it is not served until setup is finished. The five jobs are `packages/operator/src/setup-folds.ts`'s `SETUP_JOBS`. `FOLD_LABELS` names six folds; the sixth is not a job.

**Design systems never meet.** The donation form dresses from `packages/form/src/styles/tokens.css` (`custom-elements.json` is what an integrator may set). Operator surfaces dress from `packages/operator/src/styles/tokens.css`, `base.css`, and `adm.css`. `/admin` derives no colour from a `--donate-*` seed or a `::part()` name. No `/admin` screen gets a `*.browser.spec.ts`. A value a screen needs that the token file cannot express is a gap to report. A deliberate exception is a `raw-colour-ok:`, `raw-length-ok:`, or `type-ok:` note on the line, never a change to the gate.

**Payments** go through the `PaymentProvider` port, never a processor SDK directly (`sole-importer.spec.ts`). **Email** goes through the `EmailProvider` port. SMTP is the interface, on port 465 only (`packages/app/src/lib/server/email/smtp-config.ts`). Nothing selects a transport.

**Secrets** live only under `packages/app/src/lib/server/**` and are deploy-time, never rows in a settings table. Two carve-outs: a key the app mints for itself, and a credential the app refreshes for itself (`quickbooksConnection` in `schema.ts`). Every configuration value is an environment variable, set in `.env` (`.env.example` names them). The console's session token, `CONSOLE_TOKEN`, is one too, and it is on no enumeration.

**Storage.** One libSQL file is the database and there is no second one. `packages/app/src/lib/server/db/client.ts` and `open.ts` are the only modules that name the driver. Photos are the database's too. A page is a flat document in a JSON column. One container serves a deployment and is never scaled: the rate limiters, the response cache and the scheduler are in-process, and correct only while one process runs (`compose.yaml`). The response cache holds a capability or immutable bytes, never a total (`packages/app/src/lib/server/runtime/response-cache.ts`, `packages/app/src/lib/server/pages/goal.ts`).

**Routes.** `/api/v1` is public and unauthenticated. Rate limiting is charged for every route under it by the layout middleware (`packages/app/src/routes/api.v1.ts`). The prefix loader sends no CORS: the echo is one form's `allowed_origins`, and that address names no form. The config read owes CORS from the form's `allowed_origins` and owes no Turnstile (`packages/app/src/routes/api.v1.forms.$id.config.ts`). The crypto status poll owes CORS and owes neither Turnstile nor amount bounds (`packages/app/src/routes/api.v1.forms.$id.donations.$donationId.ts`). The submission owes CORS, Turnstile, and amount bounds re-read from the form record (`packages/app/src/routes/api.v1.forms.$id.donations.ts`). An `Origin` neither source names still gets the body: `Origin` is an attribution signal and never an authorization control (`packages/app/src/lib/server/api/cors.ts`). `/integrations/v1` is the read API an organisation's own systems call: key-authenticated, read-only, no CORS, and never under `/api/v1`. `/connector/v1` is the surface Better Giving's central Claude and ChatGPT connector calls, beside `/integrations/v1` and never under `/api/v1`. A deployment never needs the connector to work. This deployment serves no auth HTTP API: better-auth's router is never mounted.

**Runtime.** Nothing built from configuration is a module-scope singleton. Work after the response goes to the process's deferred-work tracker (`packages/app/src/lib/server/runtime/deferred.ts`), which shutdown waits for. `CRON_RUNS` (`packages/app/src/cron-runs.ts`) is the schedule; the in-process scheduler fires it in production only. The client address is the TCP peer unless `TRUSTED_PROXY_HEADER` names a proxy's header (`packages/app/src/lib/server/runtime/client-ip.ts`). The request body is read exactly once, by the endpoint that owns it. Reads are loaders; writes are actions or endpoints. The donation page loader, and the donation page editor's loader, write the page on first need (`packages/app/src/lib/server/pages/donation-page.ts`).

**Forms.** Every `/admin` action and every form-seeding loader parses through `packages/app/src/lib/server/conform.ts`. Every box a form states must arrive. An emptied repeater submits no key, and an unticked checkbox submits no key: for both, absence is the value. A body that nests a value is refused. Schemas stay flat.

**Schema.** Single-tenant: no `org_id`. No mechanism may let an org add a column. Migrations are never an app-boot side effect. One path touches a production schema: `packages/app/scripts/migrate.ts`, run as `pnpm db:migrate` or `docker compose run --rm migrate`.

## Never

- Never deploy, push an image, or migrate a database other than your own local file. A test deployment is still a deployment.
- Never commit a secret, a `.env`, or a database file. `.env.example` holds names and placeholders only.
- Never commit a deployment artifact: a deployed hostname, or an account or resource id.
- Never hand-edit an applied migration. The migrate command records applied files by filename and has no checksum, so a changed file does not re-run and a deployment keeps the old schema. A new file from `drizzle-kit generate` is a draft and is hand-edited before it is committed (`CONTRIBUTING.md` → Migrations: `STRICT`, column order, rebuild fixups). That edit happens before the file is applied, not after.
- Never renumber or rename a migration. A rename re-runs an old file; reusing a recorded filename no-ops. The chain squashes into `0000_initial_schema.sql`, and that name never changes. Never drop a `.sql` into `packages/app/migrations/` by hand.
- Never commit `pnpm-lock.yaml` edits made by hand, and never edit `.github/workflows/` without the task asking for it.
- Never gate on a command that does not pass.
- Never weaken a `sole-*.spec.ts` gate (ledger writer, refund writer, payment importer, recurring inserter, contact updater) to make a change compile.
- Never log or return a staff password, a processor key, a connector key, or a session token.
- Never add an `/admin` browser spec, a second database, an `org_id`, or an auth HTTP route.

## Ledger, gifts, and schema

The ledger (`packages/app/src/lib/server/ledger/posting.ts`) is the only module that may insert, gated by `sole-writer.spec.ts`. Every total is a `SUM` at read time, never a cached number (`packages/app/src/lib/server/pages/goal.ts`). Multi-row writes go in one atomic `batch()`; `Db` has no `transaction()`. No invariant is enforced by an atomic read-then-write.

A repeating gift's row is written by the first charge that settles, from `packages/app/src/lib/server/recurring/collect.ts`, the only module that may insert into `recurring_plan`. The gift itself is recorded at authorization. The first settled charge claims that row rather than inserting a second. No name a donor typed reaches the processor. The donation path never gates on the recurring capability.

`drizzle-kit generate` writes a draft. Read every `.sql` before committing it. Append `STRICT` by hand to every `CREATE TABLE`. Append new columns after `archived_at`, never reorder. Reference data ships as an idempotent migration, never a seed script. A migration's comments are frozen with its filename, except `0000_initial_schema.sql`, which a squash rewrites in place. `CONTRIBUTING.md` → Migrations is the full list, including the rebuild hand-edits.

## Permanent contracts

A contract below is permanent by decision. Weigh a fix on its own merits.

- `v1`. Breaking changes ship as `v2` alongside.
- The element's public style surface: `--donate-*` seeds and `::part()` names. Everything derived from a seed is `--_`-prefixed and private. `packages/form/custom-elements.json` ships in the same commit as any change to that list.
- The element's public attributes stay primitive.
- The resume stamp `bg_donate_form` (`RESUME_FORM_PARAM` in `packages/form/src/embed/resume.ts`).

## Product surface

- Donor-facing pages are `/donate` and each live campaign at its own address. A donor page is on no `site` row and on no form's `allowed_origins` (`packages/app/src/lib/server/pages/view.ts`). A gift there is a real gift on whatever keys the deployment holds. A form is pageless. A campaign address never shadows a route (`packages/app/src/lib/page/slug.ts`).
- A page is arranged from a fixed set of blocks. `packages/app/src/lib/page/catalog.ts`'s `parsePage` is the only parser of a stored page.
- A deployment calls no AI model and binds no AI service.
- The repo contains no org-editable files.
- The form's flow logic imports no framework. One machine and one `v1` client under `packages/form/src/`.
- UI strings say what a fundraiser says. Schema table names never reach a screen.

## Comments

A comment states the rule, never the deliberation that produced it. It must be complete to someone holding only this repository. Anchor a claim to a file and line, a test name, `AGENTS.md`, `README.md`, `DEPLOY.md`, `CONTRIBUTING.md`, or a public URL. Comments are lowercase prose. Capitals are for acronyms, SQL keywords, `SQLITE_*` codes, env-var and constant names, and files spelled that way.

## Tests

`packages/app/vitest.config.ts` has three projects. Anything touching the database is a `*.db.spec.ts`: a real libSQL file per spec file, running the committed migrations. A `*.dom.spec.*` mounts a screen in happy-dom. Everything else is a `*.spec.ts` on plain Node. Assert the extended result code's name, never the prose, and through the error's `cause` when drizzle is in the path (`packages/app/src/lib/server/db/rejection.testing.ts`). Never stand in for the database with a hand-rolled adapter.
