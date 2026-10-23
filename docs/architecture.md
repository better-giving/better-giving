# Architecture

One deployment is one organisation. The database has no organisation id (`AGENTS.md` → Schema). A second organisation is another deployment: a fork, or another checkout with its own database.

The running process is a Node server, React Router with `ssr: true`, in one container. `Dockerfile` builds that image. `compose.yaml` runs it. On Fly.io, `fly.toml` mounts one volume at `/data` and sets `auto_stop_machines` to `off`, so the machine stays up. The rate limiter, the response cache, and the scheduler live in that process, so a second replica doubles every limit, serves a cache the first never cleared, and runs every scheduled job twice (`compose.yaml`). Scaling is [Deployment](../DEPLOY.md#flyio).

The database is one SQLite file, opened with `@libsql/client` on a `file:` URL. `createClient` and `PRAGMA journal_mode = WAL` are in `packages/app/src/lib/server/db/open.ts`. `DATABASE_URL`, `PORT`, and `HOST` for a container come from `compose.yaml` or `fly.toml`. WAL needs a local disk.

## Packages

| path | what it is |
| --- | --- |
| `packages/app` | The server: `/admin`, `/donate`, `/{slug}`, `/api/v1`, sign-in, the database, the ledger, payments, mail, scheduled runs |
| `packages/form` | The embeddable donation element. A permanent public contract |
| `packages/operator` | Shared components and tokens for `/admin` and the gallery |
| `packages/emails` | Mail templates, rendered to strings by the app |
| `packages/emails-preview` | Dev-only preview of those templates |
| `packages/gallery` | Dev-only component gallery |
| `packages/zapier` | The Zapier integration, pushed with its own CLI |

Which package may import which, and that `packages/zapier` stands outside that graph, is `biome.jsonc` and `AGENTS.md` → Workspace.

## Money and books

Charges go to the organisation's processor. The app holds the keys and does not custody the funds. Card, PayPal, donor-advised fund, and crypto each sit behind `PaymentProvider` (`packages/app/src/lib/server/payments/provider.ts`). Mail sits behind `EmailProvider`.

The ledger (`packages/app/src/lib/server/ledger/posting.ts`) is the only module that inserts. A total is a `SUM` at read time (`packages/app/src/lib/server/pages/goal.ts`). A processor payout to the organisation's bank is not an event this deployment receives: the gift stays in a processor holding account until someone records the transfer from the bank feed (`packages/app/src/lib/server/accounting/provider.ts`).

A receipt is the email in `packages/emails/src/templates/receipt.tsx`. What a receipt is allowed to print is `packages/app/src/lib/server/org/receipt-fields.ts`.

## Routes

`/admin` is the dashboard. `/donate` and each live campaign are donor pages. `/api/v1` is the public form API. `/integrations/v1` is the key-authenticated read API. `/connector/v1` is the connector Better Giving's central Claude and ChatGPT clients call. What each of those owes (CORS, spam check, auth) is `AGENTS.md` → Routes.

Configuration values are environment variables (`docs/configuration.md`, `.env.example`). The rules for changing this system are `AGENTS.md` and [`CONTRIBUTING.md`](../CONTRIBUTING.md).
