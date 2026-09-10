# Deploy

## Requirements

- **Node ≥ 22** and **pnpm** (`corepack enable`; version pinned in `package.json`)
- **A Cloudflare account** (the Free plan runs it) with its email verified. An unverified account works in the dashboard but refuses the first Worker deploy
- **A Stripe account**, for card money
- **An SMTP account on port 465**, for receipts. [Email](#email) has a provider table

```sh
pnpm install
pnpm run db:create        # once (the placement it takes is permanent)
pnpm run deploy
```

The script is `build && preflight && d1 migrations apply --remote && wrangler deploy`, in that order because the migration is the one-way door: everything able to fail runs in front of it. Safe to rerun: applied migrations skip.

`db:create` placement: take the default unless records must stay in a region. `pnpm run db:create --jurisdiction eu` gives a hard EU restriction. Cloudflare takes placement at creation and never again; getting it wrong means export, delete, recreate, import. **Leave read replication off.** Every figure this app shows is a `SUM` at read time, and a lagging replica hands staff a stale total.

Run operator commands from the repo root, never raw `wrangler`: the scripts carry the flags that matter and pin the wrangler version. Appended flags reach wrangler: `pnpm run deploy --var …`, `pnpm run db:create --jurisdiction eu`.

## 1. Configuration values

Thirteen values, all of them plain Worker **vars**: readable on the Worker (**Workers & Pages → your Worker → Settings → Variables and Secrets**) and shown as values in the console's own folds, so you can check what you pasted. `packages/app/.dev.vars.example` describes every one.

```sh
# packages/app/.deploy.vars (gitignored, single-quote every value)

# at least 12 characters. below the floor is refused at the deployment's own
# sign-in, and pnpm run doctor <your-url> asks directly, where a refusal is the
# healthy answer
ADMIN_PASSWORD='the value from openssl rand -base64 24'
SMTP_HOST='smtp.resend.com'
SMTP_USERNAME='resend'
SMTP_PASSWORD='re_xxxxxxxx'
MAIL_FROM='donations@example.org'
STRIPE_SECRET_KEY='sk_live_xxxxxxxx'
STRIPE_PUBLISHABLE_KEY='pk_live_xxxxxxxx'
STRIPE_WEBHOOK_SECRET='whsec_xxxxxxxx'
TURNSTILE_SITE_KEY='0x4xxxxxxxx'
TURNSTILE_SECRET_KEY='0x4xxxxxxxx'
```

```sh
pnpm run deploy:vars      # one deploy, carrying every line of the file as a var
```

- One value on its own is `pnpm run deploy --var <NAME>:<value>`. It is the same deploy either way: a var arrives with the deploy carrying it and not before.
- `ADMIN_PASSWORD` is the credential that opens `/admin` for you, the operator who set the deployment up: the username is `admin`, and the password comes from a password manager, because recovery is you and the Cloudflare account. Colleagues are invited from `/admin/members`, set their own, and reset a forgotten one from the sign-in page; that reset never reaches this credential. Change it later on the console's **Dashboard password** fold.
- **Take both Stripe keys from the same dashboard page.** They are one pair; a mismatched pair is refused by Stripe at the first charge, and nothing here checks it for you.
- Single-quote every value: quoting keeps a `#` or backslash in a password from being read as syntax.
- `wrangler.jsonc` carries `keep_vars: true`, so every value survives every later deploy. A deploy therefore cannot remove one. Clear it on the Variables and Secrets page, or set it to an empty string.
- Anyone who can open this Cloudflare account can read all thirteen, and that is the trade: the console shows you a stored Stripe key and a stored SMTP password rather than four dots, because it already runs on your Cloudflare session. Treat account access as credential access.
- `.deploy.vars` is not `.dev.vars`, which feeds `pnpm dev` and is never uploaded.
- `CONSOLE_TOKEN` sits beside the thirteen and is not one of them: a Worker secret holding the console's session, minted when a console connects, twelve hours, replaced by the next connect. `pnpm run secret:list` names it, and `pnpm run secret:delete CONSOLE_TOKEN` closes the console surface until a console connects again.
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are escape hatches, not setup steps: the first revokes every session, the second pins a canonical origin (read the caveat in `.dev.vars.example` first). `SMTP_PORT` is the third of the thirteen that is usually left unset; the app refuses every port but 465.

## 2. The console jobs

Three jobs have no checkout command (the Stripe webhook, the Turnstile widget, and the site list):

```sh
pnpm console              # http://localhost:5322
```

**Stripe webhook**: paste both keys on **Donation processor**, press **Save**. The endpoint is registered at the Worker's address and the signing secret Stripe returns exactly once is stored in the same run. **Without an endpoint, cards are charged and no gift reaches your books**, and that is invisible from the donation form. Repair a lost secret, a switched-off endpoint, or a stale subscription list after an upgrade the same way: paste the secret key again, **Save**. The endpoint is deleted and recreated, so gifts settling in the gap are charged and not recorded; do it when nobody is giving. Repeating gifts ride the same press.

**Bank debits**: a donor whose bank could not be verified instantly is sent two small deposits, and Stripe itself emails them the link to confirm the amounts, at the address the form hands it. This deployment sends nothing for that step, so leave Stripe's customer emails switched on (dashboard.stripe.com → Settings → Emails); switched off, nobody tells the donor, and the gift expires unverified after ten days.

**Turnstile widget**: created by its press on **Which sites your forms go on**, both halves stored, site key published. **Made once, only once**: a second widget of the same name is a second key pair and live forms stop taking gifts. Lost keys: dash.cloudflare.com → Turnstile, or `pnpm run turnstile:keys` (read-only; prints both as `.deploy.vars` lines).

**Sites**: saving the list levels the widget's hostname list in the same press. Until level, a site renders the form perfectly and refuses every gift, because Cloudflare will not issue a challenge pass on an unauthorised host.

## 3. Embed

Sign in at `/` as `admin` with `ADMIN_PASSWORD`. Forms and their paste-ready snippets come from `/admin/forms`, and a deployment ships with none. List the site on the console first; a form loads only where listed *and* ticked.

- The snippet's `<style>` block is part of it: without it the page jumps by the card's height when the element defines. A CMS block strips `<style>` silently: put the rule in the site's theme stylesheet instead.
- **Wallets**: Stripe shows Apple Pay / Google Pay / Link only on hostnames registered under **Settings → Payments → Payment method domains**, and the console registers them for you (the deployment's own hostname and every listed site) behind the Stripe keys run and again behind every **Save sites** press. `www.example.org` is a hostname of its own: list it as its own site if donors reach the form there, or it stays unregistered. Check standing and repair a gap (a site added since, a domain Stripe switched off) under **Wallet buttons** on **Donation processor**, **Register**.
- A CSP on the target site needs five directives, and [`README.md`](./README.md) has the block. The failure happens in the donor's browser; this deployment never sees it.
- **Check which deployment a snippet came from before pasting it anywhere real**: it points at the address you read it at. See [A rehearsal deployment](#a-rehearsal-deployment).

## Your organisation's legal identity

The console's **Organisation** fold: registered name, EIN, address, all rows on your deployment rather than Cloudflare values. **Registered name and EIN gate every form.** US 501(c)(3) only: the EIN is checked to the digit, stored `12-3456789`; another jurisdiction forks and changes the rule.

Every form prints the standard receipt sentence, *"No goods or services were provided in exchange for this gift."* Gifts carrying a benefit (a gala ticket, member perks) make it wrong: edit `SUGGESTED_DEDUCTIBILITY_STATEMENT` in `packages/operator/src/deductibility.ts` and deploy, or write `org_profile.deductibility_statement` directly, where a non-empty value wins. Your organisation makes the claim; a tax professional reviews it.

## Checking a deployment

```sh
pnpm run doctor https://better-giving.<your-subdomain>.workers.dev
pnpm run logs        # live tail; the Cloudflare dashboard has them too
pnpm run db:info     # storage and row counts
```

`doctor` posts a deliberately wrong password to `/login` and reads the status, never touching your real one:

| It says                  | What is true                                                                   |
| ------------------------ | ------------------------------------------------------------------------------ |
| healthy                  | password set, long enough, database reachable, schema applied                  |
| could not sign anyone in | `ADMIN_PASSWORD` unusable, or migrations have not reached that database        |
| accepted the probe       | `ADMIN_PASSWORD` equals the junk string published in the script, so rotate it  |

The login screen's *"Sign-in is unavailable"* is deliberately uninformative; the cause comes off the logs.

**Nothing shows a working Stripe endpoint**: Stripe returns the signing secret exactly once and will not confirm it afterwards, so the repair press above is the answer on doubt.

## Email

Five values: host, port, username, password, sender. **Port 465 and no other, 587 included**, which opens in the clear and upgrades only if a strippable `STARTTLS` offer survives the path; this app refuses every other port. Postmark documents no 465 and cannot be used.

| Provider     | `SMTP_HOST`                         | `SMTP_USERNAME`            | `SMTP_PASSWORD`                  |
| ------------ | ----------------------------------- | -------------------------- | -------------------------------- |
| Resend       | `smtp.resend.com`                   | `resend`                   | `re_xxxxxxxx`                    |
| Amazon SES   | `email-smtp.<region>.amazonaws.com` | your SES SMTP user         | its SMTP password                |
| Mailgun      | `smtp.mailgun.org`                  | `postmaster@<your-domain>` | its password                     |
| SendGrid     | `smtp.sendgrid.net`                 | `apikey`                   | `SG.xxxxxxxx`                    |
| ZeptoMail    | `smtp.zeptomail.com`                | `emailapikey`              | the Mail Agent's send-mail token |
| your own MTA | `mail.example.org`                  | `user`                     | `password`                       |

## A custom domain

The zone must already be on your account. Once, either way: it survives every later deploy.

```sh
pnpm run deploy --domains donate.example.org
```

Or **Workers & Pages → your Worker → Settings → Domains & Routes**. Consider pinning `BETTER_AUTH_URL` to the same origin (`--var BETTER_AUTH_URL:https://donate.example.org`). The caveat is in `.dev.vars.example`.

## Backups

D1 keeps a point-in-time restore window (Time Travel): 30 days paid, 7 free. The one backup that survives your Cloudflare account:

```sh
pnpm run db:export --output ./backup.sql
```

Take one before an upgrade with migrations. A bookkeeping mistake is corrected by a compensating entry, never a rollback: the restore window repairs a damaged schema, not a wrong figure.

## A rehearsal deployment

A second deployment on its own database, for trying an upgrade or a Stripe setting away from real donors. Checkout-only. Get live first, because nothing copies between deployments.

```sh
pnpm run db:create:test     # once, ever
pnpm run deploy:test
pnpm run deploy:test --var <NAME>:<value>
```

`deploy:test` sets `CLOUDFLARE_ENV=test` on the build, which is where the environment is decided; `--env test` on the upload alone cannot, which is why you run the script. Result: `better-giving-test` Worker and database, holding none of the thirteen. `deploy:vars` deploys the real one, so a rehearsal is configured a value at a time.

The app has no test mode and cannot tell which deployment it runs as. **Do not paste a rehearsal snippet where real donors reach**: a typed card declines loudly, but an Apple Pay / Google Pay gift *succeeds*: Stripe substitutes a test token by design, the success state renders, the receipt sends, and no money moved. Nothing in this repository guards that; you knowing is the guard.

Taking it down, where **both are permanent** and the database is the books:

```sh
pnpm wrangler delete --name better-giving-test --env test
pnpm wrangler d1 delete better-giving-test --env test
```

**Type both names out.** Without `--name`, wrangler resolves your *real* Worker from `wrangler.jsonc`, and `DB` in place of the database name resolves the same way.

## Upgrading

```sh
git remote add upstream https://github.com/better-giving/better-giving.git
git fetch upstream && git merge upstream/main
pnpm install
pnpm run deploy
```

Upstream owns every file, so a clean fork merges fast-forward; a conflict means you edited a tracked file. **Read the diff of `packages/app/migrations/` before deploying**, the irreversible part. A release that squashed the chain shows that whole directory rewritten and applies nothing: wrangler skips `0000_initial_schema.sql` on a deployment that already ran it. Meet anything doubtful on a rehearsal first.

## Without a checkout

The console binary does the whole job (deploy, all thirteen values, webhook, widget, sites, org identity) for an operator who holds no source:

```sh
curl -fsSL https://github.com/better-giving/better-giving/releases/latest/download/install.sh | sh
better-giving start
```

`start` runs in the terminal, asking its questions there, and opens the console once the deployment stands. Everything after that (the thirteen values, Stripe, the widget, the site list, the org identity) is a screen in that console.

Four more you will want later. **`better-giving update`** carries a newer release's code onto the deployment you already have; it names every migration it would apply and will not apply one without your answer, because a migration is one-way. It and `start` install a newer console themselves before they do anything else — a binary deploys the release it was built with, so an out-of-date console would otherwise carry out-of-date code onto your deployment — and then carry on as that console. **`better-giving open`** serves the console against a deployment that is already up, and deploys nothing. **`better-giving login`** signs this machine in to Cloudflare in a browser and asks which account this deployment is in; `start` takes both itself, and the other commands send you here when this machine holds neither. **`better-giving logout`** gives that sign-in up, at Cloudflare and on this machine.

macOS and Linux; installs to `~/.local/bin` (`BETTER_GIVING_INSTALL_DIR` overrides), verified against the release's checksums. **Leave the console running**: the program is the page. No browser on the machine: set `CLOUDFLARE_API_TOKEN` before starting it, which stands in for the sign-in. The questions `start` asks are still asked in the terminal, so it is not a way to run one unattended. Moving to a newer release is `better-giving update` alone: it installs the newer console for you, from the release it just named and checked against that release's checksums, replacing the binary you ran. Where it cannot — no console published for your platform, a download that did not arrive, a checksum that did not match, a file it may not write — it uploads nothing and sends you back to the install line above. A changed fork deploys from its checkout instead.
