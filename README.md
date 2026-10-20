# better-giving

A donation app for a **single** nonprofit, run anywhere Docker runs. One deployment, one org: a donation form embedded on their own site, a staff back office, donor records, and an append-only double-entry ledger underneath. React Router on Node in one container, against one SQLite database file.

**Bring your own processor.** Charges go directly to the org's own account at Stripe, PayPal, Chariot (gifts from a donor-advised fund), NOWPayments (crypto), or any mix: the app holds their keys and never custodies funds.

## The dashboard

`/admin` on a deployment is the only screen anybody opens. Donation forms, donations, donors, recurring gifts and the books, for every staff member. Settings (the org's legal identity, logo, notification address, mail), Payments, the sites forms go on, and QuickBooks, for the person who deployed it. Keys and passwords live in `.env`, never on a screen: [`DEPLOY.md`](./DEPLOY.md) is the setup.

## Get started

### Requirements

- **Docker with Compose** to run it, and **Node ≥ 22** with **pnpm** (`corepack enable`) to work on it
- **a Stripe, PayPal, Chariot or NOWPayments account** (any one alone is enough, and more than one may be set) and **an SMTP account on port 465**, for taking money. [`DEPLOY.md`](./DEPLOY.md) has the details

### Run it

```sh
cp .env.example .env                 # fill in ADMIN_PASSWORD at minimum
docker compose run --rm migrate      # applies the migrations to the database file
docker compose up -d
```

Sign in at `/login` on `http://localhost:3000` (or `BETTER_GIVING_PORT`) as `admin`, with the `ADMIN_PASSWORD` from `.env`. The mail and Turnstile values in `.env.example` are fake-but-valid, so the app runs with no account created anywhere. The database lives on the named volume `data` and survives `docker compose down`.

The dashboard is not served until set-up reads finished (`packages/app/src/lib/server/config/readiness.ts`): the organisation's registered name and EIN, the notification address, mail, the password, and a processor's keys.

**A donation cannot complete out of the box**: every processor key is commented out, and the published Turnstile pair passes every visitor and then has its submission refused. The app serves its own Donation page, made the first time it is asked for, at `/donate`.

[`CONTRIBUTING.md`](./CONTRIBUTING.md) is running it from a checkout, with a seeded database, and how migrations work.

### Deploy it

The same three lines on a machine of your own, behind an `https` proxy. **One container, never scaled**: the rate limits, the cache and the scheduled runs are in-process. [`DEPLOY.md`](./DEPLOY.md) is the operator's file and walks all of it, in order: the configuration values, the proxy header, processor webhooks, backups and restores, rehearsal deployments, and upgrades.

Email and Turnstile are required. A deployment that cannot send cannot give a donor the receipt they file with a tax authority, and `/api/v1` is an unauthenticated, cross-origin, payment-initiating endpoint, exactly what card-testing bots hunt, and the org eats the disputes.

**Test keys are keys.** A deployment holding `sk_test_…` reads _ready_, serves forms and takes cards, all against Stripe's test account, where no money moves and no screen says so. A PayPal sandbox app's credentials do the same thing on that rail. To rehearse, see [`DEPLOY.md`](./DEPLOY.md)'s rehearsal deployment. Read its wallet paragraph before pasting any snippet it hands you.

### On Cloudflare

`v0.0.38-alpha.1` is the last release that deployed to Cloudflare Workers with the `better-giving` console binary, and this repository cuts no further `v0.0.x-alpha` release. Cloudflare deployments move to the Cloudflare flavor, kept apart from this repository.

## Embed the form

Every deployment serves a Donation page of its own, at `/donate` on its own address, so an organisation with no website can take a gift the day it deploys.

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

`/admin → Donation forms` generates that snippet with the real form id, built from the address you are reading it at. A form loads only on sites listed under Donation forms → Which sites your forms go on _and_ ticked on the form. Anywhere else is refused. List a site before pasting a snippet into it.

**Using Turnstile? List the same site on its widget too.** Cloudflare will not issue a challenge pass on a host the widget does not authorise: a site missing from the widget renders the form normally and then refuses every gift. See [`DEPLOY.md`](./DEPLOY.md).

A form refuses to serve until the org profile carries a **registered name** and an **EIN**, because the card makes a tax-status claim. This product is for US 501(c)(3) organisations: the EIN is checked to the digit and stored as `12-3456789`. The **deductibility statement** is not a third gate: it falls back to a suggested sentence, never blank, never blocking. Changing it means editing the constant in this repository or writing the column directly, with no control on any screen. [`DEPLOY.md`](./DEPLOY.md) has the details. A charity in another jurisdiction forks this repository and changes those rules. **Editing any of this later takes Settings, which only the deployer sees**, the deductibility statement and a fork besides. That is what lets dashboard access go to someone who reads donations without handing them the legal identity every receipt prints.

A child carrying `slot="loading"` (`<p slot="loading">Loading…</p>`, or a block of your own) shows until the form's configuration is read; it renders before the element upgrades and is kept afterwards, over the form's own skeleton. Write the attribute on your own element, not a literal `<slot>` tag: a pasted `<slot>` shows its contents before the upgrade and disappears at it.

### Listen to the form

The element dispatches three events, and each bubbles out of it, so a listener on the element, on any ancestor or on `document` hears it:

- `bg-donate:ready` when the form has rendered. `detail` is `{ formId }`.
- `bg-donate:unavailable` when the element shows the card saying the form cannot be rendered. `detail` is `{ message, fix }`, the two sentences on that card; `fix` is `null` where the card shows none.
- `bg-donate:success` when a gift went through. `detail` is `{ formId, amountMinor, currency, frequency }`: what the donor was charged in minor units of an uppercase ISO 4217 currency, any fee they chose to cover included, so `2606` with `USD` is $26.06. On a monthly or yearly gift it is one charge, not the gift's value over time.

```html
<script>
	document.addEventListener('bg-donate:success', (event) => {
		const { amountMinor, currency } = event.detail;
		// fire your own conversion pixel here
	});
</script>
```

**`success` fires once per gift, on the thank-you screen.** It never fires for a gift that was declined or is still waiting: a bank debit settling or waiting for the donor to confirm their bank account, a gift from a donor-advised fund (the fund pays later), or a crypto deposit not yet arrived. It fires once even on a page that shows the same form twice.

`amountMinor` is `null` where the form does not know the amount. A donor who left for their bank to approve a card comes back to a page that remembers only the gift's payment, so on that return `frequency` is `null` too. A crypto gift is valued at what arrives, so it carries no amount either. No event carries the donor's name or email.

Events and their details grow: ignore a `bg-donate:*` event you do not know, a `frequency` other than `one_time`, `monthly` and `yearly`, and a `detail` field you do not know.

## If your site sends a Content-Security-Policy

The form needs seven directives, and the one most often missing is your own deployment.

Which vendor lines you need follows the processors your deployment holds: the Stripe lines matter to a deployment taking cards, the PayPal ones to a deployment taking PayPal or Venmo, the Chariot ones to a deployment taking gifts from a donor-advised fund, the NOWPayments one to a deployment taking crypto, the `challenges.cloudflare.com` ones to a deployment holding a Turnstile key pair, and a deployment holding more than one needs each. Naming all of them is harmless on a deployment that uses one.

Write `<your deployment origin>` as the origin the snippet's `src` points at, scheme and host, no path.

The two PayPal entries `https://www.paypal.com` and `https://api-m.paypal.com` follow your deployment's `PAYPAL_API_URL`: where it names another address, list that address in place of `api-m.paypal.com`, and its host with the leading `api-m.` turned to `www.` in place of `www.paypal.com`.

```
script-src   <your deployment origin>
             https://js.stripe.com https://*.js.stripe.com
             https://www.paypal.com https://c.paypal.com
             https://cdn.givechariot.com
             https://challenges.cloudflare.com

connect-src  <your deployment origin>
             https://api.stripe.com
             https://www.paypal.com https://api-m.paypal.com https://c.paypal.com

frame-src    https://js.stripe.com https://*.js.stripe.com
             https://hooks.stripe.com
             https://www.paypal.com
             https://history.paypal.com https://account.venmo.com
             https://secure.dafpay.com
             https://challenges.cloudflare.com

img-src      'self' data:
             https://www.paypalobjects.com
             https://cdn.givechariot.com
             https://nowpayments.io

font-src     https://cdn.givechariot.com

style-src    'unsafe-inline'
```

**`connect-src` for your deployment origin is the one that catches people.** The form fetches its configuration and mints its payment intent from the donor's browser. `connect-src 'self'`, the starter policy, blocks both, and every visitor sees the card saying the form could not be reached. `script-src` needs the same origin: the snippet loads `/embed.js` from it.

**`frame-src https://hooks.stripe.com` is the second.** Stripe requires it for redirecting payment methods, including every card a bank challenges with 3-D Secure. Leave it out and the card path works until a bank asks a question, and that donor's gift dies with nothing on screen.

**`frame-src https://www.paypal.com` is PayPal's equivalent.** PayPal opens its approval window as a browser popup, which no policy of yours governs, but when a donor's browser blocks that popup, PayPal falls back to an overlay inside your page, and that overlay is a frame. Leave this out and the form works until a donor has popups blocked, which is a great many of them. `https://history.paypal.com` and `https://account.venmo.com` are the same line for Venmo, and only a deployment offering Venmo needs them.

**`img-src https://www.paypalobjects.com` is the one nobody predicts.** PayPal's buttons are drawn in your page rather than in a frame of PayPal's, so their wordmarks are images your policy has to allow. Leave it out and the PayPal button renders as a blank gold pill: a control that looks broken and that nobody presses. `'self' data:` rides with it because naming `img-src` at all stops images falling back to `default-src`, which would take the form's own art down.

**`img-src https://nowpayments.io` is the crypto option's, and it is the one you can leave out.** Each coin in the list draws its logo from the crypto processor's own site, loaded when a donor opens the list. Left out, every row draws the round lettered mark it already draws for a coin the processor lists no logo for: a plainer list, and every coin still pickable. Only a deployment offering crypto loads them at all.

**`connect-src https://api-m.paypal.com` is the one with the widest blast radius.** The form asks PayPal which methods this donor is eligible for before it draws anything, so a blocked read is not a missing Venmo button; it is no PayPal buttons at all, on every page load.

**The spam check needs nothing of its own by default.** A deployment without a Turnstile key pair checks each gift with ALTCHA: the form reads a small puzzle from your deployment and solves it in the donor's browser while they fill the form in, through the `connect-src` your deployment origin already has. It starts no worker and loads nothing from anywhere else, so it needs no `worker-src`, no `'wasm-unsafe-eval'` and no further entry. Only a deployment holding a Turnstile pair needs the two `https://challenges.cloudflare.com` lines.

**Chariot's lines are the fund option's alone.** Chariot's button loads from `https://cdn.givechariot.com`, writes its fonts and inline `<style>` into your page, and draws the fund's window in a frame on `https://secure.dafpay.com` or in a popup. Leave one out and the donor-advised fund option fails on that page while every other way to give keeps working.

`style-src 'unsafe-inline'`: the form writes inline styles while it measures your page's colors and builds its card. This is the form's own doing rather than a vendor requirement.

Two more, if either applies:

- **A nonce-based policy works if the nonce is on the snippet's own tag**: `<script src="…/embed.js" nonce="…" async>`. It propagates to the injected runtime and to every vendor script after it, PayPal's included, and PayPal carries the nonce on to the pieces it loads in turn. No nonce on the pasted tag → nothing propagates and the runtime never loads.
- **A cross-origin-isolated page cannot run this form.** Stripe does not support cross-origin isolated sites: with `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` together, the form mounts and never becomes usable. `Cross-Origin-Opener-Policy: same-origin` on its own is enough to break the PayPal rail, and it breaks it in the way that is hardest to report: PayPal drives its approval window through the handle the popup keeps on your page, that header cuts the handle, and the form reads the window as gone. The donor is looking at PayPal's real login screen while the form has already decided they walked away.

Vendor lists: Stripe's [integration security guide](https://docs.stripe.com/security/guide) and Cloudflare's [Turnstile CSP reference](https://developers.cloudflare.com/turnstile/reference/content-security-policy/).

## Theme the form

Three custom properties, set on the element or anything above it:

```html
<bg-donate-form
  form="frm_…"
  style="--donate-primary: #0f766e; --donate-shade: warm; --donate-corner: round"
></bg-donate-form>
```

`--donate-primary` is your brand colour: every solid block a donor acts on, plus the two places the brand is ink (the quiet action, and the word on a selected amount or frequency). `--donate-shade` picks the tone of the card's greys: `light` (the default), `warm` or `cool`. `--donate-corner` picks its corners: `square`, `soft` (the default) or `round`. Anything else in either falls back to what the element inherits, and to the default where nothing above sets one. A browser without container style queries on custom properties draws the light, soft card whatever the two are set to. The type and the focus ring are the form's own, and more than a brand colour and those two presets means a fork. **Light only, by decision**: every shade is light, and a dark host page gets a light card.

[`custom-elements.json`](./packages/form/custom-elements.json) is the canonical list of part names and tokens, permanent exactly like `/api/v1`.

## Operate it

From a checkout, the root commands act on the database file `DATABASE_URL` names: `pnpm db:migrate`, `pnpm db:seed` (a contributor's fixture, never a deployment's) and `pnpm db:backup <file>`. All run from any directory, because the root `package.json` forwards each into `packages/app`; `pnpm run` on its own lists them. In the container, `docker compose run --rm migrate` is the migration.

An append-only ledger is corrected by posting a compensating entry rather than by restoring. A backup is a copy of the one database file; [`DEPLOY.md`](./DEPLOY.md) has taking one and putting it back.

Every configuration value is an environment variable in `.env`, gitignored, read when the container starts. [`DEPLOY.md`](./DEPLOY.md) says what each one is.

## Contributing

[`CLAUDE.md`](./.claude/CLAUDE.md) holds the invariants, several non-obvious. Ask before changing a rule rather than inferring intent from the code.

[`CONTRIBUTING.md`](./CONTRIBUTING.md) is how to run it, how migrations work, and what CI gates.

## License

MIT. See [`LICENSE`](./LICENSE). Fork it, host it, change it, sell it. Stewarded by Better Giving, which does not operate your instance and is not in its runtime path.
