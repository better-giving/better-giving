# Deploy

## Requirements

- **Node ≥ 22** and **pnpm** (`corepack enable`; version pinned in `package.json`)
- **A Cloudflare account on a paid Workers plan** with its email verified. The Free plan runs it, but the rate limits on `/api/v1` and sign-in silently do not enforce. An unverified account works in the dashboard but refuses the first Worker deploy
- **A payment processor account: Stripe, PayPal, Chariot, NOWPayments, or any mix.** Any one on its own finishes set-up: Stripe takes cards, bank debits and the wallets; PayPal takes PayPal and Venmo; Chariot takes one-time gifts from a donor-advised fund; NOWPayments takes one-time crypto gifts. A deployment holding more than one offers each to the donor
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

The configuration values are all plain Worker **vars**: readable on the Worker (**Workers & Pages → your Worker → Settings → Variables and Secrets**) and shown as values in the console, so you can check what you pasted. `packages/app/.dev.vars.example` describes every one.

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
# any one processor's block finishes the Payments job, and more than one may be
# set. leave out the block for a processor this deployment does not take money on.
# Chariot and NOWPayments have no block: their values are stored by each one's
# console press, in step 2 below
STRIPE_SECRET_KEY='sk_live_xxxxxxxx'
STRIPE_PUBLISHABLE_KEY='pk_live_xxxxxxxx'
STRIPE_WEBHOOK_SECRET='whsec_xxxxxxxx'
# PAYPAL_WEBHOOK_ID is stored by the console's PayPal press, in step 2 below,
# rather than being typed here
PAYPAL_CLIENT_ID='the client id from PayPal'
PAYPAL_CLIENT_SECRET='the secret from the same app in PayPal'
TURNSTILE_SITE_KEY='0x4xxxxxxxx'
TURNSTILE_SECRET_KEY='0x4xxxxxxxx'
```

```sh
pnpm run deploy:vars      # one deploy, carrying every line of the file as a var
```

- One value on its own is `pnpm run deploy --var <NAME>:<value>`. It is the same deploy either way: a var arrives with the deploy carrying it and not before.
- `ADMIN_PASSWORD` is the credential that opens `/admin` for you, the operator who set the deployment up: the username is `admin`, and the password comes from a password manager, because recovery is you and the Cloudflare account. Colleagues are invited from `/admin/members`, set their own, and reset a forgotten one from the sign-in page; that reset never reaches this credential. Change it later on the console's **Dashboard password** page.
- **Take each processor's pair from one place too.** Stripe's two keys are one pair from one dashboard page, and PayPal's client id and secret are one pair from one app in PayPal's developer dashboard. A mismatched Stripe pair is refused by Stripe at the first charge; the console's PayPal **Save** tests PayPal's pair at the API address before it stores it. A [rehearsal deployment](#a-rehearsal-deployment) takes its PayPal pair from a sandbox app and sets `PAYPAL_API_URL` to PayPal's sandbox address, `https://api-m.sandbox.paypal.com`. Left unset, `PAYPAL_API_URL` is `https://api-m.paypal.com`.
- **A restricted Stripe key (`rk_…`) needs read access to what a refund or a dispute is checked against**: PaymentIntents, Charges, Refunds, Disputes, Invoices and Balance. A read the key is not allowed is refused as a setting to fix: the delivery is answered as not taken, and Stripe sends it again for up to three days, so a permission granted inside that window records the refund or dispute by itself. That holds for every refund and dispute on the account, another integration's included, because each is read before it is known whose it is.
- Single-quote every value: quoting keeps a `#` or backslash in a password from being read as syntax.
- `wrangler.jsonc` carries `keep_vars: true`, so every value survives every later deploy. A deploy therefore cannot remove one. Clear it on the Variables and Secrets page, or set it to an empty string.
- Anyone who can open this Cloudflare account can read every one of them, and that is the trade: the console shows you a stored processor key and a stored SMTP password rather than four dots, because it already runs on your Cloudflare session. Treat account access as credential access.
- `.deploy.vars` is not `.dev.vars`, which feeds `pnpm dev` and is never uploaded.
- `CONSOLE_TOKEN` sits on the same Worker and is not one of these values: a Worker secret holding the console's session, minted when a console connects, twelve hours, replaced by the next connect. `pnpm run secret:list` names it, and `pnpm run secret:delete CONSOLE_TOKEN` closes the console surface until a console connects again.
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are escape hatches, not setup steps: the first revokes every session, the second pins a canonical origin (read the caveat in `.dev.vars.example` first). `SMTP_PORT` is a third configuration value usually left unset; the app refuses every port but 465.

## 2. The console jobs

These have no checkout command (the Stripe webhook, PayPal's webhook, Chariot's set-up, NOWPayments' set-up, the Turnstile widget, and the site list):

```sh
pnpm console              # http://localhost:5322
```

**Stripe webhook**: saving both keys on the console's **Stripe** page registers the endpoint at the Worker's address and stores the signing secret Stripe returns exactly once, in the same run. **Without an endpoint, cards are charged and no gift reaches your books**, and that is invisible from the donation form. An endpoint switched off, or short of an event after an upgrade, is put right with **Repair** on the same page's Payment notices row: it switches the endpoint back on, subscribes it to every event and keeps its signing secret, so the press opens no gap of its own. A lost secret or a missing endpoint is repaired the first way: paste the secret key again, **Save**. An endpoint already there is deleted and recreated, so gifts settling in the gap are charged and not recorded; do it when nobody is giving. Repeating gifts ride the same press.

**PayPal webhook**: saving the client id and secret on the console's **PayPal** page registers the listener at the Worker's address on the PayPal app those credentials belong to, subscribed to every event this deployment reads, and stores its id as `PAYPAL_WEBHOOK_ID` in the same run. **Without a listener, a donor is charged and no gift reaches your books**: `CHECKOUT.ORDER.APPROVED` is what the capture is made from, and a repeating gift is collected by PayPal on its own schedule whether this deployment hears about it or not. A listener already at this address is kept and its subscription brought level, so the same press is the repair after an upgrade adds an event. Two refusals need something from you: a Worker address that is not `https://` (PayPal delivers to nothing else), and an app already holding PayPal's cap of ten listeners: delete one you no longer use in PayPal's developer dashboard, or use another app's credentials.

**PayPal's charity rate**: PayPal reports on no call which rate an account is on, so the console's **PayPal** page asks. Answer yes only if PayPal has approved this organisation for that rate. Ticked wrongly, a donor covering fees is quoted less than the gift costs and the org nets less than the donor gave; left unticked on an approved account, the surplus reaches the org. Untick it and the answer goes back to unset.

**Chariot**: gifts from a donor-advised fund, one-time only. Chariot issues keys by email: sandbox keys from support@givechariot.com, and live keys after Chariot reviews a test form's address and a recording of a gift made on it. The console's **Chariot** page stores all four values in one press, and finds the organisation at Chariot by the EIN on the **Organisation** page, so fill that in first. A rehearsal deployment holding sandbox keys takes the sandbox address, `https://sandboxapi.givechariot.com`. **Without the notification address the press registers, a grant never reads received**, so the same press is the repair. A gift reads pending until the fund pays: the organisation matches the arriving payment by the tracking id `/admin` Gifts shows beside it and marks the grant received in Chariot's dashboard, and only then does it reach the books, with Chariot's fee. The donor gets an email when the grant request is sent and a thank-you when it is received; neither is a tax receipt, because the fund's sponsor receipted the donor's contribution to the fund. A grant cancelled before it was received reads cancelled and emails nobody. One cancelled after it was marked received, through Chariot's support, reads Refunded: the whole gift comes out of the donor's total and the books as any refund does ([Refunds and disputes](#refunds-and-disputes)), and the donor, thanked at receipt, is sent the refund notice. A grant received and cancelled before this deployment recorded the receipt is booked and refunded in one delivery, and nobody is emailed.

**NOWPayments**: one-time crypto gifts. The console's **NOWPayments** page stores the API key, the IPN secret and the payout currency in one press, and checks the key and the currency with NOWPayments before it writes. The payout currency is the lowercase code of the outcome wallet set in NOWPayments' dashboard, such as `usdttrc20`; a gift's minimum is priced against it, so a code that disagrees with the wallet quotes minimums for the wrong coin. A gift is valued at what arrived, not at what was quoted. NOWPayments has no sandbox this deployment reaches: the key is the live account's, and rehearsing is [a second deployment](#a-rehearsal-deployment).

Set these in NOWPayments' dashboard before the first gift. Its help pages call the settings area **Payment Settings** in some places and **Store Settings** in others.

- **The IPN secret** is generated there and shown once; the console's press stores that value. A different secret refuses every notification and no crypto gift settles.
- **Instant Payment Notifications: Timeout and Number of recurrent notifications.** Set both as high as the dashboard allows. A notification this deployment could not take is sent again only that many times; a repeat is harmless. A gift still pending here whose notification's retries ran out is caught by the thirty-minute read below, one NOWPayments has since refunded included. A refund of a gift that already settled here is not: its own notification is the only thing that records it, and one whose retries ran out shows in NOWPayments' dashboard and never in `/admin`.
- **One outcome wallet**, in the coin `NOWPAYMENTS_OUTCOME_CURRENCY` names. A second wallet routes its coin's gifts there while minimums are still quoted against the first.
- **Coins settings**: at least one coin switched on. The donor's coin list is exactly that list; a coin switched off later is refused when a donor picks it.
- **The payout arrives net of NOWPayments' fee.** A donor sends the amount quoted and the account is charged, so a gift a donor did not choose to cover the fee on lands short by it. The rate quoted to a donor is NOWPayments' published rate (`NOWPAYMENTS_FEE_RULE` in `packages/app/src/lib/server/payments/fees.ts`); what was actually taken is read off each payment, and the chain's own fee for moving the coin to the payout wallet is on top of it and stated nowhere.
- **Repeated deposits and wrong-asset deposits** work at any setting. A second deposit to a gift's address is recorded as its own gift at what arrived. A deposit in the wrong coin or on the wrong network is held by NOWPayments for you to process in its dashboard, and the gift reads pending until you do.

**Let NOWPayments through the firewall.** Its notifications arrive at the deployment's own address, and a Cloudflare Bot Fight Mode or WAF rule on that zone drops them without any error here: donors send coins and no gift reaches your books. NOWPayments gives its sending addresses to allowlist on request, at partners@nowpayments.io.

**A missed notification is caught up every thirty minutes**: the Worker reads each crypto gift still pending after half an hour, until a day after its address closes, and settles or closes it, so a gift whose notification never arrived still reaches the books. A payment the read finds already refunded is settled and refunded in the same pass ([Refunds and disputes](#refunds-and-disputes)). The one exception is a repeat deposit whose notification never arrived: nothing names that payment to read, so it appears in NOWPayments' dashboard and never in `/admin` until recorded by hand.

**Bank debits**: a donor whose bank could not be verified instantly is sent two small deposits, and Stripe itself emails them the link to confirm the amounts, at the address the form hands it. This deployment sends nothing for that step, so leave Stripe's customer emails switched on (dashboard.stripe.com → Settings → Emails); switched off, nobody tells the donor, and the gift expires unverified after ten days.

**Turnstile widget**: created from the console's **Sites** page, both halves stored, site key published. **Made once, only once**: a second widget of the same name is a second key pair and live forms stop taking gifts. Lost keys: dash.cloudflare.com → Turnstile, or `pnpm run turnstile:keys` (read-only; prints both as `.deploy.vars` lines).

**Sites**: saving the list levels the widget's hostname list in the same press. Until level, a site renders the form perfectly and refuses every gift, because Cloudflare will not issue a challenge pass on an unauthorised host.

## 3. Embed

Sign in at `/` as `admin` with `ADMIN_PASSWORD`. Forms and their paste-ready snippets come from `/admin/forms`, and a deployment ships with none. List the site on the console first; a form loads only where listed *and* ticked.

- The snippet's `<style>` block is part of it: without it the page jumps by the card's height when the element defines. A CMS block strips `<style>` silently: put the rule in the site's theme stylesheet instead.
- **Wallets** (Stripe's rails only; PayPal and Venmo need no hostname registered): Stripe shows Apple Pay / Google Pay / Link only on hostnames registered under **Settings → Payments → Payment method domains**, and the console registers them for you (the deployment's own hostname and every listed site) when the Stripe keys are saved and again whenever the site list is. `www.example.org` is a hostname of its own: list it as its own site if donors reach the form there, or it stays unregistered. Check standing and repair a gap (a site added since, a domain Stripe switched off) on the console's **Stripe** page.
- A CSP on the target site needs the directives [`README.md`](./README.md) lists. The failure happens in the donor's browser; this deployment never sees it.
- **Check which deployment a snippet came from before pasting it anywhere real**: it points at the address you read it at. See [A rehearsal deployment](#a-rehearsal-deployment).

## Your organisation's legal identity

The console's **Organisation** page: registered name, EIN, address, all rows on your deployment rather than Cloudflare values. **Registered name and EIN gate every form.** US 501(c)(3) only: the EIN is checked to the digit, stored `12-3456789`; another jurisdiction forks and changes the rule.

Every form prints the standard receipt sentence, *"No goods or services were provided in exchange for this gift."* Gifts carrying a benefit (a gala ticket, member perks) make it wrong: edit `SUGGESTED_DEDUCTIBILITY_STATEMENT` in `packages/operator/src/deductibility.ts` and deploy, or write `org_profile.deductibility_statement` directly, where a non-empty value wins. Your organisation makes the claim; a tax professional reviews it.

## Sending gifts to QuickBooks

Optional, and not a processor: QuickBooks takes no money and finishes no set-up job, so a deployment that never connects it is complete. What it does is post every settled gift and every correcting entry into the organisation's own books, and every refund and dispute of a gift it received.

**Register an app with Intuit first.** At [developer.intuit.com](https://developer.intuit.com), create an app and take its client id and secret from **Keys and credentials**. Each app carries two pairs: Development, which works only against sandbox companies, and Production, which works only against real ones. The Production pair does not exist until Intuit approves the questionnaire behind it. Take both halves from the same pair: a Development client id beside a Production secret is refused at the first call.

**Register the return address on that same app, under Redirect URIs**: this deployment's address followed by `/quickbooks/callback`, for example `https://donate.example.org/quickbooks/callback`. **Without it registered, Intuit refuses the round trip** and no company can be connected: the address sent to Intuit has to match one on the app to the character. Intuit redirects only to an `https` address and refuses an IP, so connecting a company against `pnpm dev` needs a tunnel. A rehearsal deployment answers at its own address, so register that one too, or use a second app for it.

**Then connect the company on the console's QuickBooks page.** Paste the client id, the secret and the API address under **Sending gifts to QuickBooks**, press **Connect a company**, and a browser tab opens Intuit's consent screen. Choosing a company sends that tab back here and the connection is stored on your deployment. The API address is which of Intuit's two this deployment talks to: `https://sandbox-quickbooks.api.intuit.com` for a sandbox company's Development pair, `https://quickbooks.api.intuit.com` for a real company's.

Back on the same page, three things finish it:

- **The three accounts** a gift is posted into (income, the processor's fee, and the account the money lands in), picked from the connected company's own chart. All three at once: a gift needs all of them and two saved alone would leave the books half told where to go.
- **The start date**, which is how much of this deployment's history goes over. It is set at connect, and a reconnect keeps it. Moving it earlier sends the gifts it newly covers, including ones from before the company was connected; they go over ten a minute in date order, so a long history takes a while to drain, and a gift that settles meanwhile goes ahead of it. Moving it later skips gifts before it that have not been sent yet. A gift already in QuickBooks stays there, and one the deployment has already started sending is not taken back. A refund or dispute moves with its gift: sent where the gift is sent, and skipped where the gift is.
- **Nothing else.** Gifts go over every minute from then on, and a page that says nothing about them is a page with nothing wrong.

**A refund or dispute goes over only after its gift, and only to the company its gift went to.** A refund of a gift QuickBooks received is sent after that gift, whatever day the refund lands. One of a gift QuickBooks never got, dated before the start date or sent to a company since disconnected, is never sent: those books hold nothing for it to take back. A dispute goes over the same way: the money leaving, the money put back if it is won, and a lost dispute's fees.

**When it stops.** A gift that could not be sent is retried on its own, and one email arrives per outage rather than per gift. Gifts given up on show as a failed count with a **Try these again** press beside it. A credential Intuit has stopped honouring shows **Sign in again**: reconnecting keeps the accounts and the start date, and flushes whatever is waiting. An Intuit outage says so and offers no press, because the deployment keeps trying without you.

**Disconnect** revokes the credential at Intuit and drops the connection here. Nothing already in the books is touched, and nothing further is sent.

## Sending gifts to Zapier

Optional, and not a set-up job. It starts a Zap on three events: a settled gift (each charge of a recurring gift included), a donor's first settled gift, and money from a gift going back to the donor, which is a refund or a dispute the organisation lost. A dispute opened or won starts nothing. A refund the processor reports as failed after its event was queued is dropped if that event has not gone out yet; one already sent has reached your Zaps, and no event follows to say the money came back. A gift refunded before its New Gift delivery went out is still delivered. Each reaches your Zaps within about a minute.

**On the console's Zapier page, press Create key.** The page then holds the two things Zapier asks for: this deployment's address and the key, each with a copy press. The key stays there on every visit, behind the eye.

**Then open the Better Giving Zapier app** from the link on that page. It is private for now and reached only through that link. Connect an account with the address and the key, and build Zaps on New Donor, New Gift or Gift Refunded. Each card on the console page counts the Zaps listening on it.

**Replace key** makes a new one and disconnects every Zap on the old one. Zapier turns off each Zap it can reach. Reconnect each one with the new key, then turn it on: Zapier only subscribes a Zap when it is turned on, so a Zap still on after the replace has to be turned off and on again.

**When it stops.** A delivery Zapier turns away is retried with a growing wait, and given up after three days. The page says so in a strip at the top, red when deliveries were given up in the past week and amber when your Zaps are more than an hour behind, both with a link to your Zaps on Zapier: a Zap that is off or erroring is the usual cause. A Zap that is turned off or deleted is dropped at once and never leaves anything behind.

## Refunds and disputes

**A refund is made in the processor's own dashboard, and reaches everything else by itself.** This deployment has no refund button and sends no money back. When Stripe, PayPal or NOWPayments reports a refund of a gift, the gift reads Refunded or Partly refunded in `/admin`, the donor's total drops by it, and the money comes out of the books from the accounts and funds the gift went into. A part refund comes off each fund in proportion; correct any other split in `/admin/books`. The processor's fee stays booked, except any part the processor reports giving back. The donor gets a short email naming what was refunded and what of the gift is still deductible; it is not a new receipt. The refund reaches QuickBooks and Zapier as the two sections above say. Refunding one charge of a monthly gift leaves the monthly gift collecting: stopping it is its own act. A refund the processor later reports as failed puts the money back on the gift and emails you, because the donor may already have been told it is on its way.

A NOWPayments refund is always the whole payment. A crypto payment NOWPayments reports refunded before it settled here, such as a deposit it held and sent back, is settled and refunded in one pass by whichever reads the payment first, a settlement notification delivered again or the thirty-minute read; the refund's own notification is held until then. Its donor is sent neither a receipt nor a refund notice. A Chariot grant has no refund once the fund has paid; the one reversal is a grant cancelled after it was marked received, read as a refund of the whole gift, as [Chariot](#2-the-console-jobs) above says. A gift recorded by hand has no processor to report one, so its refund is a correction in `/admin/books`.

**A dispute alert is an email asking you to answer the dispute.** When a donor disputes a charge, with their bank or with PayPal, the processor takes the money back while the dispute is decided. This deployment records that as soon as it hears: the gift reads Disputed, its money comes off the gift, the donor's total and the books, the processor's dispute fee is booked, and a monthly gift the charge belongs to is stopped, because the card is disputing its charges. The donor is sent nothing. The alert goes to the address on the console's **Notifications** page, and names the amount, the date the processor needs an answer by, and a link into the processor's dashboard.

What you do: answer the dispute in the processor's dashboard, at that link, before that date, with the gift's receipt and anything showing the donor gave. Nothing here answers it for you. The outcome reaches the books without anyone acting: won, the money goes back on the gift and it reads as before, and whatever of the dispute fee the processor kept stays booked as a processor fee; lost, the money stays off and the gift reads Refunded, or Partly refunded where the dispute was for less than the whole gift. A monthly gift that could not be stopped gets an alert of its own, because the card may still be charged: cancel the subscription in the processor's dashboard, then stop the gift in `/admin`. A returned bank debit is a dispute already lost, with nothing to answer: the gift reads Refunded, every fee Stripe has booked against the return by the time it is read is booked with it, and the alert asks nothing of you. A fee Stripe books against it later is read by nothing, so check the return's fees in Stripe's dashboard.

Two more dispute cases arrive as alerts of their own. **A dispute of a gift that earlier refunds and disputes already took whole** has nothing left to withdraw: nothing is written, a monthly gift behind it is still stopped, and the alert says the books already hold none of the gift and asks you to post only the dispute fee, where one was charged, as a correction in `/admin/books`. It comes again with each delivery of that dispute, since nothing is written to say it was sent. **A dispute won whose opening never reached this deployment**, such as one opened before the endpoint was repaired, writes no money out or back, because the gift never left the books. Where the processor names the fee it kept and the books hold the gift, that fee is booked as a processor fee and the alert, sent once, names it. Otherwise nothing is written and the alert comes with each delivery: it says nothing needs booking where the processor kept no fee, where the fee could not be read it asks you to check it in the processor's dashboard and post what was kept as a correction in `/admin/books`, and where the books do not hold the gift it asks for that correction only if the gift was posted by hand.

**Refunds and disputes arrive only on the events a deployment is subscribed to.** An endpoint or listener registered by an older release is short of them. On Stripe, the Payment notices row of the console's **Stripe** page says so: press **Repair**. On PayPal, press **Save** again on the console's **PayPal** page, from a console as new as the deployment (`better-giving update`), which brings the listener level. The PayPal app those credentials belong to also needs Disputes switched on in PayPal's developer dashboard, because PayPal refuses the disputes read without it. A refund is then recorded as the organisation's own, with a warning in the Worker's logs, since whether a dispute stands behind it cannot be read. A dispute, or a reversal PayPal made, is not recorded at all: the alert names the PayPal event, and the fix is to switch Disputes on and then have PayPal resend that event (PayPal's `POST /v1/notifications/webhooks-events/{event_id}/resend`), which records it in full. A correction in `/admin/books` in its place moves the books and nothing else: the gift's status, the donor's total and Zapier stay as they were.

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

**Nothing shows a refused PayPal delivery either.** PayPal's own developer dashboard lists the deliveries it attempted, and that list is where a refused or unanswered one is visible; saving the credentials again, above, is the answer on doubt.

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

A second deployment on its own database, for trying an upgrade or a processor setting away from real donors. Checkout-only. Get live first, because nothing copies between deployments.

```sh
pnpm run db:create:test     # once, ever
pnpm run deploy:test
pnpm run deploy:test --var <NAME>:<value>
```

`deploy:test` sets `CLOUDFLARE_ENV=test` on the build, which is where the environment is decided; `--env test` on the upload alone cannot, which is why you run the script. Result: `better-giving-test` Worker and database, holding none of the configuration values. `deploy:vars` deploys the real one, so a rehearsal is configured a value at a time.

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

The console binary does the whole job (deploy, every configuration value, webhooks, widget, sites, org identity) for an operator who holds no source:

```sh
curl -fsSL https://github.com/better-giving/better-giving/releases/latest/download/install.sh | sh
better-giving start
```

Typed again on a deployment behind this console's release, `start` offers to carry the release onto it, and applies its migrations only once you agree. Connecting signs out any other console connected to that deployment. Everything after that (the configuration values, Stripe, PayPal, Chariot, NOWPayments, the widget, the site list, the org identity) is a screen in that console.

Three more you will want later. **`better-giving update`** brings this console binary up to the newest release and touches your deployment for nothing. `start` is the only command that carries code onto a deployment, and it offers you the newer console itself before it does anything else: a binary deploys the release it was built with, so an out-of-date console would otherwise carry out-of-date code onto your deployment. Accept and it installs that console and carries on as it; decline and it goes on with the binary you ran. **`better-giving login`** signs this machine in to Cloudflare in a browser and asks which account this deployment is in; `start` takes both itself, and the other commands send you here when this machine holds neither. **`better-giving logout`** gives that sign-in up, at Cloudflare and on this machine.

macOS and Linux; installs to `~/.local/bin` (`BETTER_GIVING_INSTALL_DIR` overrides), verified against the release's checksums. **Leave the console running**: the program is the page. No browser on the machine: set `CLOUDFLARE_API_TOKEN` before starting it, which stands in for the sign-in. The questions `start` asks are still asked in the terminal, so it is not a way to run one unattended. When `start` offers a newer console and cannot install it (no console published for your platform, a download that did not arrive, a checksum that did not match, a file it may not write), it uploads nothing and sends you back to the install line above. A changed fork deploys from its checkout instead.
