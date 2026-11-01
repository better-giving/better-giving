# Deploy

How to run a deployment. What each environment value means is [Configuration](docs/configuration.md). What the process is made of is [Architecture](docs/architecture.md).

## Requirements

- **Docker with Compose**, on a machine whose disk is local. The database is one SQLite file in WAL mode, and WAL needs shared memory that a network filesystem does not provide ([Architecture](docs/architecture.md))
- **An `https` address in front of the container.** The app serves plain HTTP on port 3000. With Compose, a proxy you run ends TLS. On Fly, Fly's proxy ends TLS (`force_https` in `fly.toml`). PayPal, Chariot, NOWPayments, and Intuit deliver to `https` only. [Behind a proxy](#behind-a-proxy) has the one setting Compose needs
- **A payment processor account: Stripe, PayPal, Chariot, NOWPayments, or any mix**, before a form can go live. What each one needs is [Configuration](docs/configuration.md#payments)
- **An SMTP account on port 465**, for receipts ([Mail](docs/configuration.md#mail))

One install serves one organisation. A second organisation is another install, with its own database ([Architecture](docs/architecture.md)).

**One container, never scaled.** The rate limits, the cache, and the scheduled runs live in the one process. A second replica splits them, as Architecture describes.

The dashboard opens after the first step below. A screen says so wherever something can't work yet. **Every value lives in `.env`**. A changed `.env` takes effect when the container is recreated:

```sh
docker compose up -d --force-recreate app
```

## 1. Start it

`ADMIN_PASSWORD` and `BETTER_AUTH_SECRET` first ([Sign-in](docs/configuration.md#sign-in)).

```sh
cp .env.example .env
docker compose build
docker compose run --rm migrate
docker compose up -d
```

`docker compose build` once, and again after an upgrade. `up` does not rebuild. `migrate` applies every committed migration the database has not recorded, then exits. With Compose the server never runs one on start, so the migration is always a step you take. On Fly it does, on each start ([Fly.io](#flyio)). Safe to rerun: applied migrations skip.

The app answers on the host's port 3000, or on `BETTER_GIVING_PORT` from `.env`. Sign in at `/login` as `admin`. The database is `better-giving.db` on the named volume `data`, mounted at `/data`. It survives `docker compose down` and every rebuild. `docker compose down -v` deletes it.

Build on the machine that runs it. `compose.yaml` builds from your checkout and does not pull an image. A push to `main` publishes `ghcr.io/better-giving/better-giving` tagged `main` and by commit sha. A tag matching `v*` publishes that tag and the commit sha, and never moves `:main`. Nothing is published as `:latest`. The package is private, so `docker pull` from a machine that is not signed in to GHCR with access to it is refused.

**Stopping is graceful.** `docker compose stop` (or `down`) sends `SIGTERM`: the scheduler stops, open requests finish, work still running after a response (a scheduled run included) settles, and the database closes. Compose waits 30 seconds before it kills the process (`compose.yaml`).

## 2. Your address

Put the `https` proxy in front, then set `BETTER_AUTH_URL` to the public origin and recreate ([Your address](docs/configuration.md#your-address)).

### Behind a proxy

Set `TRUSTED_PROXY_HEADER` to the header your proxy writes the client address into, such as `x-forwarded-for`. Unset, every donor shares the proxy's one rate-limit bucket ([Your address](docs/configuration.md#your-address)).

## 3. Organisation, mail, payments

In `/admin`, Settings, then mail, then each processor. The order and the values are [Configuration](docs/configuration.md). The payment-notice command, from the directory that holds `compose.yaml`:

```sh
docker compose run --rm app node scripts/setup-webhook.ts stripe     # or paypal, chariot
docker compose up -d --force-recreate app
```

Without the notice value, the form stays offline and no donor is charged. Payments in `/admin` says when notices are unset or not arriving.

## 4. Embed

Forms and their snippets come from Donation forms. The paste-in, the CSP, and Stripe's wallet hostnames are [Embed a form](docs/embed.md).

## Checking a deployment

```sh
pnpm install
pnpm run doctor https://donate.example.org
docker compose logs -f app
```

`pnpm run doctor` runs from a checkout of this repository (`packages/app/scripts/doctor.js`). It is not in the container image, and Compose does not provide it. It posts a password and no username. The sign-in form requires both (`LOGIN_FORM` in `packages/app/src/routes/login.tsx`), so a deployment that is up answers 400 and the script reports a fault in itself. That answer does not prove the password or the database. Read the container logs and sign in at `/login`.

The script's other sentences name a console and `pnpm run db:migrate`. This deployment takes its password from `.env` ([Sign-in](docs/configuration.md#sign-in)) and its schema from [Start it](#1-start-it), or on Fly from [Fly.io](#flyio). A password the server will not accept never lets a production process listen.

`returned 404` means that URL is not serving this app. `redirected` means run the command against the host the message names. `rate limited` means wait a minute and run it again. `could not reach` means the URL did not answer.

Payments shows whether notices are set and whether the processor still has them registered, but not whether the last delivery got through. On doubt, compare `STRIPE_WEBHOOK_SECRET` with the signing secret Stripe's dashboard reveals for this address's endpoint (Workbench → Webhooks).

Nothing shows a refused PayPal delivery either. PayPal's own developer dashboard lists the deliveries it attempted. Re-running `setup-webhook paypal` is the answer on doubt ([PayPal](docs/configuration.md#paypal)).

## Scheduled runs

The server runs its own schedule, `CRON_RUNS` in `packages/app/src/cron-runs.ts`, on UTC minutes: every minute it sends what the deployment owes to QuickBooks, Zapier, and webhook destinations; every thirty minutes it reads back crypto gifts no notification settled; at a quarter past and a quarter to it resends refund notices that did not send. A minute the process was down for is not replayed. The next run picks up whatever is still owed. Each minute's run sends up to 40 Zapier events, 40 webhook deliveries, and 10 QuickBooks entries (`PACE` in `packages/app/src/lib/server/outbox/budget.ts`), so a backlog drains over several minutes.

## Backups

The database is one file, and a backup is a copy of it: every table, the photos, and the record of applied migrations. Taken while the app serves:

```sh
docker compose exec app node scripts/backup.ts /data/backup.db
docker compose cp app:/data/backup.db ./backup.db
docker compose exec app rm /data/backup.db
```

From a checkout against a file on the same machine, `pnpm db:backup <file>` does the same. A relative `<file>` is relative to `packages/app`. Either refuses a target that already exists.

**To restore, stop the app, then put the copy where `DATABASE_URL` points, with no `-wal` or `-shm` file left beside it.** A stale `-wal` beside a restored file is replayed over it. With Compose:

```sh
docker compose stop app
docker compose run --rm --no-deps -v "$PWD/backup.db:/restore.db:ro" --entrypoint sh migrate \
  -c 'rm -f /data/better-giving.db-wal /data/better-giving.db-shm && cp /restore.db /data/better-giving.db'
docker compose start app
```

Take one before an upgrade with migrations. A bookkeeping mistake is corrected by a compensating entry, never a restore.

## A rehearsal deployment

A second deployment on its own database, for trying an upgrade or a processor setting away from real donors: a second checkout in a directory of its own, with its own `.env` and its own `BETTER_GIVING_PORT`. Compose names the volume after the directory, so the two never share a database file. Nothing copies between deployments.

The app has no test mode and cannot tell which deployment it runs as. Do not paste a rehearsal snippet where real donors reach. A typed card declines loudly, but an Apple Pay or Google Pay gift succeeds: Stripe substitutes a test token by design, the success state renders, the receipt sends, and no money moved. Nothing in this repository guards that.

## Upgrading

```sh
git remote add upstream https://github.com/better-giving/better-giving.git   # once
git fetch upstream && git merge upstream/main
docker compose build
docker compose run --rm migrate
docker compose up -d
```

Upstream owns every file, so a clean fork merges fast-forward. A conflict means you edited a tracked file. **Read the diff of `packages/app/migrations/` before migrating**, the irreversible part. A release that squashed the chain shows that whole directory rewritten and applies nothing: migrations are recorded by filename, so `0000_initial_schema.sql` is skipped on a database that already ran it. Meet anything doubtful on a rehearsal first.

A form stays offline while any processor whose keys are set is missing its notice value ([Payments](docs/configuration.md#payments)).

## Refunds and disputes

A refund is made in the processor's own dashboard, and reaches everything else by itself. When Stripe, PayPal, or NOWPayments reports a refund of a gift, the gift reads Refunded or Partly refunded in `/admin`, the donor's total drops by it, and the money comes out of the books from the accounts and funds the gift went into. A part refund comes off each fund in proportion. Correct any other split in `/admin/books`. The processor's fee stays booked, except any part the processor reports giving back. The donor gets a short email naming what was refunded and what of the gift is still deductible. It is not a new receipt. The refund reaches QuickBooks and Zapier as [those sections](docs/configuration.md#quickbooks) say. Refunding one charge of a monthly gift leaves the monthly gift collecting: stopping it is its own act. A refund the processor later reports as failed puts the money back on the gift and emails you, because the donor may already have been told it is on its way.

A NOWPayments refund is always the whole payment. A crypto payment NOWPayments reports refunded before it settled here, such as a deposit it held and sent back, is settled and refunded in one pass by whichever reads the payment first, a settlement notification delivered again or the thirty-minute read. The refund's own notification is held until then. Its donor is sent neither a receipt nor a refund notice. A Chariot grant has no refund once the fund has paid. The one reversal is a grant cancelled after it was marked received, read as a refund of the whole gift ([Chariot](docs/configuration.md#chariot)). A gift recorded by hand has no processor to report one, so its refund is a correction in `/admin/books`.

A dispute alert is an email asking you to answer the dispute. When a donor disputes a charge, with their bank or with PayPal, the processor takes the money back while the dispute is decided. This deployment records that as soon as it hears: the gift reads Disputed, its money comes off the gift, the donor's total, and the books, the processor's dispute fee is booked, and a monthly gift the charge belongs to is stopped, because the card is disputing its charges. The donor is sent nothing. The alert goes to the address under Settings → Notifications, and names the amount, the date the processor needs an answer by, and a link into the processor's dashboard.

What you do: answer the dispute in the processor's dashboard, at that link, before that date, with the gift's receipt and anything showing the donor gave. The outcome reaches the books without anyone acting. Won, the money goes back on the gift and it reads as before, and whatever of the dispute fee the processor kept stays booked as a processor fee. Lost, the money stays off and the gift reads Refunded, or Partly refunded where the dispute was for less than the whole gift. A monthly gift that could not be stopped gets an alert of its own, because the card may still be charged: cancel the subscription in the processor's dashboard, then stop the gift in `/admin`. A returned bank debit is a dispute already lost, with nothing to answer: the gift reads Refunded, every fee Stripe has booked against the return by the time it is read is booked with it, and the alert asks nothing of you. A fee Stripe books against it later is read by nothing, so check the return's fees in Stripe's dashboard.

Two more dispute cases arrive as alerts of their own. A dispute of a gift that earlier refunds and disputes already took whole has nothing left to withdraw: nothing is written, a monthly gift behind it is still stopped, and the alert says the books already hold none of the gift and asks you to post only the dispute fee, where one was charged, as a correction in `/admin/books`. It comes again with each delivery of that dispute, since nothing is written to say it was sent. A dispute won whose opening never reached this deployment, such as one opened before the endpoint was repaired, writes no money out or back, because the gift never left the books. Where the processor names the fee it kept and the books hold the gift, that fee is booked as a processor fee and the alert, sent once, names it. Otherwise nothing is written and the alert comes with each delivery: it says nothing needs booking where the processor kept no fee, where the fee could not be read it asks you to check it in the processor's dashboard and post what was kept as a correction in `/admin/books`, and where the books do not hold the gift it asks for that correction only if the gift was posted by hand.

Refunds and disputes arrive only on the events a deployment is subscribed to. An endpoint or listener registered by an older release is short of them, and Payments says so. Run `setup-webhook` for that processor again ([Payments](docs/configuration.md#payments)): on PayPal it brings the listener level and keeps its id; on Stripe it recreates the endpoint, so put the new secret in `.env`. The PayPal app those credentials belong to also needs Disputes switched on in PayPal's developer dashboard, because PayPal refuses the disputes read without it. Until it is, a refund is recorded as the organisation's own, with a warning in the app's logs, since whether a dispute stands behind it cannot be read. A dispute, or a reversal PayPal made, is not recorded at all: the alert names the PayPal event, and the fix is to switch Disputes on and then have PayPal resend that event (PayPal's `POST /v1/notifications/webhooks-events/{event_id}/resend`), which records it in full. A correction in `/admin/books` in its place moves the books and nothing else: the gift's status, the donor's total, and Zapier stay as they were.

## Fly.io

These commands run this repo on Fly.io from a checkout, in the directory that holds `fly.toml`. The screens from [Configuration](docs/configuration.md) are the same ones. `fly.toml` names no app, so each command takes `-a <app-name>`. Leave `--save` off `fly apps create`: it writes the app name into `fly.toml`.

```sh
fly auth login
fly orgs list
fly apps create <app-name> --org <org>
```

`<org>` is one of the names `fly orgs list` printed. The server refuses to start without `ADMIN_PASSWORD` and `BETTER_AUTH_SECRET` ([Sign-in](docs/configuration.md#sign-in)), so the first deploy has to already hold them or its check fails. Generate both and keep them in a password manager. `fly secrets list` shows the names only:

```sh
openssl rand -base64 24   # ADMIN_PASSWORD, at least 12 characters
openssl rand -base64 32   # BETTER_AUTH_SECRET
```

Stage those two together with `BETTER_AUTH_URL` set to `https://<app-name>.fly.dev`, so the first start already serves that origin. `fly secrets import` reads `NAME=VALUE` lines on standard input, and `--stage` stores them without starting a Machine. Bash saves a heredoc in the shell history, so run `set +o history` before and `set -o history` after:

```sh
set +o history
fly secrets import --stage -a <app-name> <<'EOF'
ADMIN_PASSWORD=<the first value>
BETTER_AUTH_SECRET=<the second value>
BETTER_AUTH_URL=https://<app-name>.fly.dev
EOF
set -o history
fly platform regions
fly deploy --ha=false --now --primary-region <region> -a <app-name>
```

`<region>` is one of the codes `fly platform regions` printed. `--primary-region` places the first Machine and its volume. It does not write `fly.toml`.

A plain `fly deploy` builds the root `Dockerfile` on Fly's remote builder. The command above is that, plus the flags this first Machine needs. When the remote build fails, `fly deploy --local-only` with those same flags builds on this machine, which needs Docker installed.

The deploy creates the volume `better_giving_data`, mounted at `/data`. The size and the 14-day snapshot retention are `initial_size` and `snapshot_retention` in `fly.toml`. `--ha=false` keeps the first deploy to one Machine: a volume attaches to one Machine, and `fly scale count` above 1 creates another Machine with an empty volume. Leave the count at 1.

Deploy prints `WARN DATABASE_URL may be a potentially sensitive environment variable` because that name sits in `[env]`. The value in `fly.toml` is the file path `file:/data/better-giving.db`, and the warning is harmless.

The Machine stays up because `auto_stop_machines` is `off` in `fly.toml`. The scheduled runs are in-process ([Scheduled runs](#scheduled-runs)). A minute the process was down for is not replayed.

On each start the Machine applies migrations, then replaces that process with the server, so `SIGTERM` reaches the drain in `packages/app/server/index.ts`. A release command runs in a temporary Machine with no volume, so it cannot migrate this file. A migration that fails exits before the server listens, and the deploy's check fails. The check is `GET /login`, with `grace_period` of 30 seconds for that migration. When a deploy fails the check while migrations are still applying, raise `grace_period` on that check in `fly.toml`.

A deploy stops the old Machine with `SIGTERM` and waits up to the `kill_timeout` of 30 seconds. That wait is best-effort, and Fly can send `SIGTERM` again. The server ignores a second signal once shutdown has started (`packages/app/server/index.ts`). Name the signal and the 30 seconds on a stop or restart you take yourself, so it drains like a deploy. `restart` takes `--time` where `stop` takes `--timeout`:

```sh
fly machine list -q -a <app-name>
fly machine stop <machine-id> -a <app-name> --signal SIGTERM --timeout 30
fly machine restart <machine-id> -a <app-name> --signal SIGTERM --time 30
```

Sign in at `https://<app-name>.fly.dev/login` as `admin`. For a hostname of your own, `fly certs add <hostname> -a <app-name>` prints the DNS records to add, and `BETTER_AUTH_URL` becomes `https://<hostname>`. Import that one line the same way, without `--stage`. The Machine restarts, and that origin is the one it serves afterwards.

`TRUSTED_PROXY_HEADER` is `fly-client-ip` in `fly.toml`. On Fly the right-most `X-Forwarded-For` entry is the app's own address, which would put every donor in one rate-limit bucket ([Behind a proxy](#behind-a-proxy)).

Every other name is in [Configuration](docs/configuration.md#every-value). Import `NAME=VALUE` lines with `fly secrets import -a <app-name>`, the same way as the first three, and leave `--stage` off. Each import restarts the Machine, and a changed value takes effect on that restart.

For Stripe, import `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` ([Stripe](docs/configuration.md#stripe)) before registering payment notices. PayPal and Chariot keys go in the same way before their own name below. The import restarts the Machine, and the next command reads the new environment. Bash saves this heredoc in the shell history too, so turn history off around it:

```sh
set +o history
fly secrets import -a <app-name> <<'EOF'
STRIPE_SECRET_KEY=<secret key>
STRIPE_PUBLISHABLE_KEY=<publishable key>
EOF
set -o history
```

Register payment notices once those keys and `BETTER_AUTH_URL` are set. The command reads the deployed environment and prints an `.env` line on standard output, `STRIPE_WEBHOOK_SECRET=...`, the same line [Payments](docs/configuration.md#payments) puts in `.env`. PayPal prints `PAYPAL_WEBHOOK_ID=...`, and Chariot's first run prints two lines. Anything else the script says stays on the terminal. The pipe strips the carriage return `fly ssh` appends and imports the line without echoing it. If the script prints an error, nothing was imported. Fix it and run the line again. Then, under Payments, press Set up recurring gifts on each processor that takes them, if its rows read Not set up.

```sh
fly ssh console -a <app-name> -C "node scripts/setup-webhook.ts stripe" | tr -d '\r' | fly secrets import -a <app-name>   # or paypal, chariot
```

To deploy a published image instead of building the Dockerfile, the package has to be public. `ghcr.io/better-giving/better-giving` is published private. Until that package is public, `fly deploy` above is the command that can run:

```sh
fly deploy --image ghcr.io/better-giving/better-giving:<tag> --ha=false --now --primary-region <region> -a <app-name>
```

### Backups on Fly

Fly keeps the volume's daily snapshots for the 14 days `snapshot_retention` sets. To keep a copy of your own, off Fly:

```sh
fly ssh console -a <app-name> -C "node scripts/backup.ts /data/backup.db"
fly ssh sftp get /data/backup.db ./backup.db -a <app-name>
fly ssh console -a <app-name> -C "rm /data/backup.db"
```

**To restore, stop the server, then put the copy where `DATABASE_URL` points, with no `-wal` or `-shm` file left beside it.** A stale `-wal` beside a restored file is replayed over it. SSH reaches a running Machine, so the stand-in command keeps the volume mounted while the server is not the process holding the file. `fly ssh` runs as root and the server runs as uid 1000, so the restored file is given to that user. The sleep update skips the health check: `GET /login` cannot pass while that command is the process. The last update puts the server back and waits for the check.

```sh
fly machine stop <machine-id> -a <app-name> --signal SIGTERM --timeout 30
fly machine update <machine-id> -a <app-name> --command "sleep infinity" --skip-health-checks --yes
fly ssh sftp put ./backup.db /data/restore.db -a <app-name>
fly ssh console -a <app-name> -C "sh -c 'rm -f /data/better-giving.db /data/better-giving.db-wal /data/better-giving.db-shm && cp /data/restore.db /data/better-giving.db && chown 1000:1000 /data/better-giving.db && rm /data/restore.db'"
fly machine update <machine-id> -a <app-name> --command 'sh -c "node scripts/migrate.ts && exec node server/index.ts"' --yes
```

When the disk itself is gone, a snapshot becomes a new volume. `fly volumes list --all -a <app-name>` shows the id, a destroyed volume included, for about a day after it was destroyed. That id is what `fly volumes snapshots list` takes. `--snapshot-retention 14` matches `fly.toml`. `fly volumes create` otherwise keeps snapshots for 5 days, and its `--size` defaults to 1GB. A volume that had been grown needs `--size` set to that size, or the restored disk comes back at 1GB.

```sh
fly volumes list --all -a <app-name>
fly volumes snapshots list <volume-id> -a <app-name>
fly volumes create better_giving_data --snapshot-id <snapshot-id> --region <region> --snapshot-retention 14 -a <app-name>
```

The new volume stays unattached until a deploy with no Machine left attaches it. Destroy the Machine first. If the old volume still exists, destroy it next. A volume still attached to a Machine cannot be destroyed. Left in place, the Machine stays on the next deploy, and the old volume is what that deploy attaches.

```sh
fly machine destroy <machine-id> --force -a <app-name>
fly volumes destroy <old-volume-id> -a <app-name>   # when that volume still exists
fly deploy --ha=false --now --primary-region <region> -a <app-name>
```

`<region>` is the region of the restored volume. A new Machine placed in any other region gets a new empty volume, and the site comes back with no data.

### Upgrading on Fly

```sh
git remote add upstream https://github.com/better-giving/better-giving.git   # once
git fetch upstream && git merge upstream/main
fly deploy --ha=false --now -a <app-name>
```

Migrations apply on the next start. **Read the diff of `packages/app/migrations/` before deploying.** What that diff means is [Upgrading](#upgrading). A plain `fly deploy` builds on Fly's remote builder. When that build fails, `--local-only` on the same command builds on this machine and needs Docker installed. Once the package is public, the image form is `fly deploy --image ghcr.io/better-giving/better-giving:<tag> --ha=false --now -a <app-name>`.
