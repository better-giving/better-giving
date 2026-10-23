# Embed a form

Every deployment serves a donation page at `/donate`. To put the form on your own site as well:

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

The script is `async`: the page lays out before the element exists, and an unknown element is an inline box of no size. Without the style block the page jumps by the height of the card. The rule stops applying once the element is defined.

Pasting into a CMS content block: put the rule in the theme stylesheet and paste only the script tag and the element. `<style>` is not valid inside `<body>`, and a CMS sanitizer strips it, leaving the jump with nothing on screen to say why.

`/admin` → Donation forms generates that snippet with the real form id, from the address you are reading it at. A form loads only on sites listed under Donation forms → Which sites your forms go on, and ticked on the form. List a site before pasting a snippet into it. Check which deployment a snippet came from before pasting it anywhere real: it points at the address you read it at ([a rehearsal deployment](../DEPLOY.md#a-rehearsal-deployment)).

**Wallets** (Stripe only; PayPal and Venmo need no hostname registered): Stripe shows Apple Pay, Google Pay, and Link only on hostnames registered in Stripe's dashboard, under Settings → Payments → Payment method domains. Saving the sites list on Donation forms registers the deployment's own hostname and every listed site. Payments → Register all sites repairs a gap (a domain Stripe switched off, a save made while Stripe was unreachable). `www.example.org` is its own hostname: list it as its own site if donors reach the form there. Link is offered when a card can settle (`wallets.link` in `packages/form/src/embed/stripe.ts`).

The form is refused until Settings has a registered name and an EIN ([Configuration](configuration.md#your-organisations-profile)).

If the deployment uses Turnstile, the widget's hostname list has to include this site. A host the widget does not list renders the form and then refuses every gift ([the spam check](configuration.md#the-spam-check)).

A child carrying `slot="loading"` (`<p slot="loading">Loading…</p>`, or a block of your own) shows until the form's configuration is read. It renders before the element upgrades and is kept afterwards, over the form's own skeleton. Write the attribute on your own element, not a literal `<slot>` tag: a pasted `<slot>` shows its contents before the upgrade and disappears at it.

## Listen to the form

The element dispatches three events. Each bubbles, so a listener on the element, on any ancestor, or on `document` hears it:

- `bg-donate:ready` when the form has rendered. `detail` is `{ formId }`.
- `bg-donate:unavailable` when the element shows the card saying the form cannot be rendered. `detail` is `{ message, fix }`, the two sentences on that card. `fix` is `null` where the card shows none.
- `bg-donate:success` when a gift went through. `detail` is `{ formId, amountMinor, currency, frequency }`: what the donor was charged in minor units of an uppercase ISO 4217 currency, any fee they chose to cover included, so `2606` with `USD` is $26.06. On a monthly or yearly gift it is one charge, not the gift's value over time.

```html
<script>
	document.addEventListener('bg-donate:success', (event) => {
		const { amountMinor, currency } = event.detail;
		// fire your own conversion pixel here
	});
</script>
```

`success` fires once per gift, on arrival at the thank-you screen. It never fires for a gift that was declined or is still waiting: PayPal or Venmo, where approval leaves the gift processing and the server captures it; a bank debit settling or waiting for the donor to confirm their bank account; a gift from a donor-advised fund, which stays pending until it is marked received; a crypto deposit not yet arrived; or a bank redirect still away from the page. It fires once even on a page that shows the same form twice.

`amountMinor` is `null` where the form does not know the amount. A donor who left for their bank to approve a card comes back to a page that remembers only the gift's payment, so on that return `frequency` is `null` too. A crypto gift is valued at what arrives, so it carries no amount either. No event carries the donor's name or email.

Events and their details grow: ignore a `bg-donate:*` event you do not know, a `frequency` other than `one_time`, `monthly`, and `yearly`, and a `detail` field you do not know.

## If your site sends a Content-Security-Policy

The form needs these directives. The one most often missing is your own deployment.

Which vendor lines you need follows the processors your deployment holds: the Stripe lines for cards, the PayPal lines for PayPal or Venmo, the Chariot lines for a donor-advised fund, the NOWPayments line for crypto, the `challenges.cloudflare.com` lines when both Turnstile keys are set. A deployment holding more than one needs each. Naming all of them is harmless on a deployment that uses one.

Write `<your deployment origin>` as the origin the snippet's `src` points at, scheme and host, no path.

The two PayPal entries `https://www.paypal.com` and `https://api-m.paypal.com` follow the deployment's `PAYPAL_API_URL`. Where it names another address, list that address in place of `api-m.paypal.com`, and its host with the leading `api-m.` turned to `www.` in place of `www.paypal.com`.

```
script-src   <your deployment origin>
             https://js.stripe.com https://*.js.stripe.com
             https://www.paypal.com https://c.paypal.com
             https://cdn.givechariot.com
             https://challenges.cloudflare.com

connect-src  <your deployment origin>
             https://api.stripe.com
             https://link.com https://*.link.com
             https://www.paypal.com https://api-m.paypal.com https://c.paypal.com

frame-src    https://js.stripe.com https://*.js.stripe.com
             https://hooks.stripe.com
             https://link.com https://*.link.com
             https://www.paypal.com
             https://history.paypal.com https://account.venmo.com
             https://secure.dafpay.com
             https://challenges.cloudflare.com

img-src      'self' data:
             https://*.link.com
             https://cdn.givechariot.com
             https://nowpayments.io

font-src     https://cdn.givechariot.com

style-src    'unsafe-inline'
```

`connect-src` for your deployment origin is the one that catches people. The form fetches its configuration and mints its payment intent from the donor's browser. `connect-src 'self'`, the starter policy, blocks both, and every visitor sees the card saying the form could not be reached. `script-src` needs the same origin: the snippet loads `/embed.js` from it.

`frame-src https://hooks.stripe.com` is the second. Stripe requires it for redirecting payment methods, including every card a bank challenges with 3-D Secure. Leave it out and the card path works until a bank asks a question, and that donor's gift dies with nothing on screen.

`frame-src https://www.paypal.com` is PayPal's equivalent. PayPal opens its approval window as a browser popup, which no policy of yours governs, but when a donor's browser blocks that popup, PayPal falls back to an overlay inside your page, and that overlay is a frame. Leave this out and the form works until a donor has popups blocked. `https://history.paypal.com` and `https://account.venmo.com` are the same line for Venmo, and only a deployment offering Venmo needs them.

`'self' data:` is on `img-src` because naming `img-src` at all stops images falling back to `default-src`, which would take the form's own art down. The PayPal and Venmo marks, and the PayPal button, are drawn as inline SVG (`packages/form/src/embed/rows.ts`, `packages/form/src/element.ts`). The element does not request `www.paypalobjects.com`.

`https://link.com` and `https://*.link.com` on `frame-src` and `connect-src`, and `https://*.link.com` on `img-src`, are Link. Leave them out and a card form that offers Link fails for that donor while a plain card can still work.

`img-src https://nowpayments.io` is the crypto option's. Each coin in the list draws its logo from the crypto processor's own site, loaded when a donor opens the list. Left out, every row draws the round lettered mark it already draws for a coin the processor lists no logo for. Only a deployment offering crypto loads them at all.

`connect-src https://api-m.paypal.com` is the one with the widest blast radius. The form asks PayPal which methods this donor is eligible for before it draws anything, so a blocked read is no PayPal buttons at all, on every page load.

The spam check uses the deployment origin already in `connect-src` when the deployment has no Turnstile key pair: the form reads a puzzle from your deployment and solves it in the donor's browser. A deployment holding a Turnstile pair needs the two `https://challenges.cloudflare.com` lines.

Chariot's lines are the fund option's alone. Chariot's button loads from `https://cdn.givechariot.com`, writes its fonts and inline `<style>` into your page, and draws the fund's window in a frame on `https://secure.dafpay.com` or in a popup. Leave one out and the donor-advised fund option fails on that page while every other way to give keeps working.

`style-src 'unsafe-inline'`: the form writes inline styles while it measures your page's colors and builds its card.

Two more, if either applies:

- A nonce-based policy works if the nonce is on the snippet's own tag: `<script src="…/embed.js" nonce="…" async>`. It propagates to the injected runtime and to every vendor script after it, PayPal's included, and PayPal carries the nonce on to the pieces it loads in turn. With no nonce on the pasted tag, nothing propagates and the runtime never loads.
- A cross-origin-isolated page cannot run this form. Stripe does not support cross-origin isolated sites: with `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` together, the form mounts and never becomes usable. `Cross-Origin-Opener-Policy: same-origin` on its own is enough to break the PayPal rail. PayPal drives its approval window through the handle the popup keeps on your page, that header cuts the handle, and the form reads the window as gone. The donor is looking at PayPal's real login screen while the form has already decided they walked away.

Vendor lists: Stripe's [integration security guide](https://docs.stripe.com/security/guide) and Cloudflare's [Turnstile CSP reference](https://developers.cloudflare.com/turnstile/reference/content-security-policy/).

## Theme the form

Three custom properties, set on the element or anything above it:

```html
<bg-donate-form
  form="frm_…"
  style="--donate-primary: #0f766e; --donate-shade: warm; --donate-corner: round"
></bg-donate-form>
```

`--donate-primary` is the brand colour: every solid block a donor acts on, plus the two places the brand is ink (the quiet action, and the word on a selected amount or frequency). `--donate-shade` picks the tone of the card's greys: `light` (the default), `warm`, or `cool`. `--donate-corner` picks its corners: `square`, `soft` (the default), or `round`. Anything else in either falls back to what the element inherits, and to the default where nothing above sets one. A browser without container style queries on custom properties draws the light, soft card whatever the two are set to. The type and the focus ring are the form's own. Every shade is light: a dark host page gets a light card.

`form` is read as an attribute. Setting the element's `form` property does nothing. `variant` renders only `inline`. Any other value renders that way too. [`custom-elements.json`](../packages/form/custom-elements.json) is the list of attributes, part names, and tokens.
