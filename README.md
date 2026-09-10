# better-giving

A donation app for a **single** nonprofit, deployed to your own Cloudflare account. One deployment, one org: a donation form embedded on their own site, a staff back office, donor records, and an append-only double-entry ledger underneath. React Router on Workers, D1 for storage.

**Bring your own processor.** Charges go directly to the org's own Stripe account: the app holds their keys and never custodies funds.

## Two operator surfaces

Named separately everywhere in this repo:

- **The dashboard** is `/admin` on a deployment. Donation forms, donations, donors, recurring gifts. The only thing a staff member opens.
- **The console** is a program the operator runs on their own machine: `better-giving start` puts this release on the deployment in the terminal — standing one up where you have none, carrying the code onto one you already have — and then serves a page at `http://127.0.0.1:5320`, and `better-giving open` serves that page against a deployment already standing. Never deployed; the screens are built into the binary. Between the terminal half and the screens it sets the deployment up: the Cloudflare account, the D1 database, all thirteen configuration values, Stripe, the site list, the org's legal identity.

## Get started

### Requirements

- **Node ≥ 22** and **pnpm** (`corepack enable`), for running locally and for the checkout deploy
- **a Cloudflare account** (the Free plan runs it), **a Stripe account**, **an SMTP account on port 465**, for deploying and taking money. [`DEPLOY.md`](./DEPLOY.md) has the details

### Run it locally

No Cloudflare account needed:

```sh
pnpm install
cp packages/app/.dev.vars.example packages/app/.dev.vars   # fill in ADMIN_PASSWORD at minimum
pnpm wrangler d1 migrations apply DB --local               # applies the migrations to the local D1
pnpm wrangler d1 execute DB --local --file scripts/seed-local.sql  # the organisation row the dashboard is gated on
pnpm dev
```

Sign in at `/login` on `http://localhost:5321` as `admin`, with the `ADMIN_PASSWORD` from `packages/app/.dev.vars`. The mail and Turnstile values in `packages/app/.dev.vars.example` are fake-but-valid, so the app runs with no account created anywhere.

The dashboard is not served until set-up reads finished (`packages/app/src/lib/server/config/readiness.ts`). The seed above settles the two jobs that are rows (the organisation's registered name and EIN, and the notification address); the example file settles mail; Payments waits on Stripe test keys, commented out at the foot of that file.

**A donation cannot complete locally out of the box**: the Stripe keys are commented out, and the published Turnstile pair passes every visitor and then has its submission refused. The seed lists no site and none is needed: the app serves its own donation page at `/{form_id}`, so a form can be added and opened at `http://localhost:5321/{form_id}`; every site is typed on the console.

[`CONTRIBUTING.md`](./CONTRIBUTING.md) is the rest: what the commit hook gates, how migrations work, how to reach the console surface against a local dev server.

### Deploy it

Your Cloudflare account, your D1, your Stripe keys. Two lines, no checkout:

```sh
curl -fsSL https://github.com/better-giving/better-giving/releases/latest/download/install.sh | sh
better-giving start
```

The first line puts one file on your machine. The second asks its questions in the terminal, deploys, and opens the console at the result. macOS and Linux, both architectures; Windows is out of scope. Sign-in is Cloudflare's own page; the credential stays on your machine, renewed automatically, never shown, never typed. `better-giving update` is the other terminal command: it carries a newer release onto a deployment you already have, naming the migrations it would apply before it applies them. `start` typed again does the same and opens the console after it.

Setting a var writes to the Worker's settings in place, taking effect without a build or an upload.

Email and Turnstile are required. A deployment that cannot send cannot give a donor the receipt they file with a tax authority, and `/api/v1` is an unauthenticated, cross-origin, payment-initiating endpoint, exactly what card-testing bots hunt, and the org eats the disputes.

**Test keys are keys.** A deployment holding `sk_test_…` reads _ready_, serves forms and takes cards, all against Stripe's test account, where no money moves and no screen says so. A local clone on the published `.dev.vars.example` keys does exactly this. To rehearse, see [`DEPLOY.md`](./DEPLOY.md)'s rehearsal deployment. Read its wallet paragraph before pasting any snippet it hands you.

Thirteen values configure a deployment, and every one of them is a plain Worker **var**: readable back on the Worker and shown as a value in the console's own folds, so you can check what you pasted. [`DEPLOY.md`](./DEPLOY.md) has the details.

[`DEPLOY.md`](./DEPLOY.md) also covers the two `d1 create` placement flags you can never change afterwards, custom domains, backups, rehearsal deployments, and upgrades.

The console deploys this repository's release as published: the program and the Worker bundle are cut from the same release. A fork that **changed the source** deploys its own build from a checkout instead:

```sh
gh repo fork better-giving/better-giving --clone && cd better-giving
pnpm install
pnpm run db:create        # once (placement flags in DEPLOY.md)
pnpm run deploy
```

Then the values: ten lines in `packages/app/.deploy.vars`, deployed in one press with `pnpm run deploy:vars`, and the console screens (Stripe webhook, Turnstile widget, site list) served from the checkout by `pnpm console`. [`DEPLOY.md`](./DEPLOY.md) is the operator's file and walks all of it, in order.

## Embed the form

Every deployment serves a donation page of its own, one form at `/{form_id}` on its own address, so an organisation with no website can take a gift the day it deploys.

To put the form on your own site as well, or instead:

```html
<script src="https://donate.your-org.org/embed.js" async></script>
<style>
	bg-donate-form:not(:defined) {
		display: block;
		min-height: 620px;
	}
</style>
<bg-donate-form form="frm_…"></bg-donate-form>
```

**Paste the style block too.** The script is `async`: the page lays out before the element exists, and an unknown element is an inline box of no size. Without those three lines every visitor sees the page jump by the height of the card. The rule stops applying the instant the element is defined.

**Pasting into a CMS content block? Put the rule in your theme's stylesheet** and paste only the script tag and the element. `<style>` is not valid inside `<body>` and CMS sanitizers strip it silently, leaving the reflow with nothing on screen to say why. The rule works from anywhere on the page.

`/admin → Donation forms` generates that snippet with the real form id, built from the address you are reading it at. A form loads only on sites listed on the console _and_ ticked on the form. Anywhere else is refused. List a site before pasting a snippet into it.

**Saving that list is the whole errand**: the same press brings the Turnstile widget's own hostname list level with it. Cloudflare will not issue a challenge pass on a host the widget does not authorise: a site missing from the widget renders the form normally and then refuses every gift. See [`DEPLOY.md`](./DEPLOY.md).

A form refuses to serve until the org profile carries a **registered name** and an **EIN**, because the card makes a tax-status claim. This product is for US 501(c)(3) organisations: the EIN is checked to the digit and stored as `12-3456789`. The **deductibility statement** is not a third gate: it falls back to a suggested sentence, never blank, never blocking. Changing it means editing the constant in this repository or writing the column directly, with no control on either operator screen. [`DEPLOY.md`](./DEPLOY.md) has the details. A charity in another jurisdiction forks this repository and changes those rules. **Editing any of this later takes the console on a machine holding a Cloudflare sign-in, not a browser and a staff password**, the deductibility statement and a fork besides. That is what lets dashboard access go to someone who reads donations without handing them the legal identity every receipt prints.

A child carrying `slot="loading"` (`<p slot="loading">Loading…</p>`, or a block of your own) shows until the form's configuration is read; it renders before the element upgrades and is kept afterwards, over the form's own skeleton. Write the attribute on your own element, not a literal `<slot>` tag: a pasted `<slot>` shows its contents before the upgrade and disappears at it.

## If your site sends a Content-Security-Policy

The form needs five directives, and the one most often missing is your own deployment.

Write `<your deployment origin>` as the origin the snippet's `src` points at, scheme and host, no path.

```
script-src   <your deployment origin>
             https://js.stripe.com https://*.js.stripe.com
             https://challenges.cloudflare.com

connect-src  <your deployment origin>
             https://api.stripe.com

frame-src    https://js.stripe.com https://*.js.stripe.com
             https://hooks.stripe.com
             https://challenges.cloudflare.com

style-src    'unsafe-inline'
```

**`connect-src` for your deployment origin is the one that catches people.** The form fetches its configuration and mints its payment intent from the donor's browser. `connect-src 'self'`, the starter policy, blocks both, and every visitor sees the card saying the form could not be reached. `script-src` needs the same origin: the snippet loads `/embed.js` from it.

**`frame-src https://hooks.stripe.com` is the second.** Stripe requires it for redirecting payment methods, including every card a bank challenges with 3-D Secure. Leave it out and the card path works until a bank asks a question, and that donor's gift dies with nothing on screen.

`style-src 'unsafe-inline'`: the form writes inline styles while it measures your page's colors and builds its card. This is the form's own doing rather than a vendor requirement.

Two more, if either applies:

- **A nonce-based policy works if the nonce is on the snippet's own tag**: `<script src="…/embed.js" nonce="…" async>`. It propagates to the injected runtime and both vendor scripts after it. No nonce on the pasted tag → nothing propagates and the runtime never loads.
- **A cross-origin-isolated page cannot run this form.** Stripe does not support cross-origin isolated sites: with `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` together, the form mounts and never becomes usable.

Vendor lists: Stripe's [integration security guide](https://docs.stripe.com/security/guide) and Cloudflare's [Turnstile CSP reference](https://developers.cloudflare.com/turnstile/reference/content-security-policy/).

## Theme the form

One custom property, set on the element or anything above it:

```html
<bg-donate-form form="frm_…" style="--donate-primary: #0f766e"></bg-donate-form>
```

`--donate-primary` is your brand colour: every solid block a donor acts on, plus the two places the brand is ink (the quiet action, and the word on a selected amount or frequency). The card's greys, type, corners and focus ring are the form's own, and more than a brand colour means a fork. **Light only, by decision**: a dark host page gets a light card.

[`custom-elements.json`](./packages/form/custom-elements.json) is the canonical list of part names and tokens, permanent exactly like `/api/v1`.

## Operate it

From a checkout, the root commands operate a deployment. All run from any directory, because the root `package.json` forwards each into `packages/app`; `pnpm run` on its own lists them. Use them over raw `wrangler`: they carry the flags that matter, like `db:create`'s `--no-update-config`, and resolve the exact wrangler version this app was tested against. Anything you append still reaches wrangler.

The console covers the same jobs without a checkout: every credential, every var, the site list, the org identity. New code reaches the deployment with `better-giving update`, or `start` where you want the console open after it; either one installs the newer console itself first.

An append-only ledger is corrected by posting a compensating entry rather than by restoring. Tearing a rehearsal deployment down is two raw wrangler commands; [`DEPLOY.md`](./DEPLOY.md) gives them in full.

Every configuration value is a plain Worker var, stored from the console and read back there as a value. The console runs on your own Cloudflare session, so masking a credential from the person holding the account bought nothing and cost them the ability to check it. Deleting a Worker deletes all thirteen; from a checkout `pnpm run deploy:vars` re-arms them from a local gitignored `.deploy.vars` in one deploy. [`DEPLOY.md`](./DEPLOY.md) has the file's shape and its one escaping trap. The Worker's Variables and Secrets page is the other place to read or change one.

## Contributing

[`CLAUDE.md`](./.claude/CLAUDE.md) holds the invariants, several non-obvious. Ask before changing a rule rather than inferring intent from the code.

[`CONTRIBUTING.md`](./CONTRIBUTING.md) is how to run it, how migrations work, what the commit hook gates, and the failure modes whose obvious diagnosis is the wrong one, including the one where every route 500s and the database is not the one you think it is.

## License

MIT. See [`LICENSE`](./LICENSE). Fork it, host it, change it, sell it. Stewarded by Better Giving, which does not operate your instance and is not in its runtime path.
