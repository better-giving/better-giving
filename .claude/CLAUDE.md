<!-- kru v0.159.0 · derived 2026-10-20 · `skills/setup/SKILL.md` to re-derive -->
@../AGENTS.md

## The seats

Load **`skills/lead/SKILL.md`** before building, reviewing, or dispatching a seat — it carries how the
team works.

| a slice in                           | goes to                                             | derived from |
| ------------------------------------ | --------------------------------------------------- | ------------ |
| the Node server and route modules    | `kru:react-router-builder`                          | `react-router` 8.3.0 framework mode, `ssr: true`, `@react-router/fs-routes`, served on Node through `@remix-run/node-fetch-server` 0.13.3 — `packages/app/server`, the in-process runtime in `packages/app/src/lib/server/runtime`, and `/admin`, `/donate`, `/{slug}`, `/api/v1` and sign-in in `packages/app/src/routes` |
| a react component either draws       | `kru:react-ui-builder`                              | `packages/operator`'s components, `packages/app/src/lib/admin`, `packages/gallery/src/previews`; the primitives are `@ark-ui/react` 5.39.2 |
| a mail template                      | `kru:react-router-builder`                          | the seat that sends it, from `packages/app/src/lib/server/email`; `packages/emails/src/templates` — react rendered by `@react-email/render` 2.1.0 into inline styles a mail client can read, every value converted by `packages/emails/src/tokens.ts` and swept by its `raw-values.spec.ts` |
| the donation form's element          | `kru:web-components-builder`                        | `packages/form` — a custom element with a shadow root, pasted into a page we do not own; `xstate` 5.32.5 runs its flow, and `@stripe/stripe-js` 9.12.1 and `@paypal/paypal-js` 11.0.1 are the two processors' client halves |
| the database file, its driver, migrations | `kru:turso-specialist`                         | `@libsql/client` 0.18.0 under `drizzle-orm/libsql` on a local `file:` URL — `packages/app/src/lib/server/db`, `packages/app/migrations`, and `migrate.ts`, `seed.ts`, `backup.ts` in `packages/app/scripts`; **libSQL is this seat's, never `kru:sqlite-architect`'s, though the file is plain SQLite** |
| the container image and compose file | `kru:fly-platform-engineer`                         | decided 2026-10-19 · setup, the `Dockerfile` lane only and no Fly config — `Dockerfile` (`# check=error=true`, built by CI's `docker-build`), `compose.yaml`, `.dockerignore` |
| money on Stripe                      | `kru:stripe-specialist`                             | `stripe` 22.4.0 — `packages/app/src/lib/server/payments/stripe.ts` |
| money on PayPal and Venmo            | `kru:paypal-specialist`                             | `@paypal/paypal-server-sdk` 2.5.0, the second adapter against the `PaymentProvider` port in `provider.ts` — `packages/app/src/lib/server/payments/paypal.ts` |
| gifts from a donor-advised fund      | `kru:chariot-specialist`                            | Chariot's REST API over `fetch` with no SDK installed, and `<chariot-connect>` loaded from Chariot's CDN — a grant is a pledge the fund pays later, against the same `PaymentProvider` port — `packages/app/src/lib/server/payments/chariot.ts` |
| crypto through NOWPayments           | `kru:nowpayments-specialist`                        | NOWPayments' REST API over `fetch` with no SDK installed, and its IPN verified with WebCrypto's HMAC-SHA512 — a gift is valued at what arrived, against the same `PaymentProvider` port — `packages/app/src/lib/server/payments/nowpayments.ts` |
| the books reaching QuickBooks Online | `kru:quickbooks-specialist`                         | Intuit's Accounting API over `fetch` with no SDK installed, and an OAuth refresh token the app rotates and stores rather than reads — `quickbooksConnection` and `quickbooksSync` in the schema; `packages/app/src/lib/server/accounting/quickbooks.ts` and `quickbooks-accounts.ts` |
| gifts reaching Zapier                | `kru:zapier-specialist`                             | `zapier-platform-core` 19.1.0 in `packages/zapier`, pushed with its CLI — the app's endpoints Zapier calls and the fan-out to its hooks ride with it, in `packages/app/src/lib/server/zapier` |
| sign-in and sessions                 | `kru:better-auth-specialist`                        | `better-auth` 1.6.25 — `packages/app/src/lib/server/auth` |
| the workspace graph, biome, CI       | `kru:toolchain-engineer`                            | `pnpm-workspace.yaml` and its catalog, `@biomejs/biome` 2.5.9, `.github/workflows/ci.yml`; no turbo |
| a coverage sweep, a red or flaky suite | `kru:test-writer`                                 | decided 2026-10-19 · setup; a builder's own red-green specs stay with that builder |
| **skills**                           | `drizzle` · `zod` · `conform` · `xstate` · `react-email` · `vitest` · `api-design` | `drizzle-orm` 0.45.2; `zod` 4.4.3 and `@conform-to/react` 1.21.1 from the catalog, declared by `packages/app`; `xstate` 5.32.5 from the catalog, declared by `packages/form` and `packages/app`; `react-email` 6.9.3 in `packages/emails-preview` and `@react-email/render` 2.1.0 in `packages/emails`; `vitest` 4.1.10 in every package that tests, and `@vitest/browser-playwright` 4.1.10 in `packages/form` alone, so the skill's v4 forks are the ones that apply; `api-design` for `/api/v1`, the Zapier key the app mints and the hooks it posts to |
| **mcp**                              | `context7` · `better-auth`                          | `.mcp.json`, enabled in `.claude/settings.local.json`; no Turso plugin, since the database is a local file and that plugin's value is Turso Cloud state |

**test** — `packages/app/node_modules/.vite/vitest/*/results.json` (vitest 4.1.10's run of 2026-10-20) puts `db` at ≥145s over 155 spec files (slowest 18s, `server/start.db.spec.ts`), `dom` at ≥139s over 60 (slowest 43s, `src/lib/donate/card.dom.spec.tsx`), and `server` at ≥50s over 154, test time only; `test:browser` drives one chromium for `packages/form`'s 11 browser specs. Scope a run to the file the slice touched.

A slice reaching a stack no seat above covers is a question for the user, naming the seat it would
need — never a nearby seat pressed into the gap.
