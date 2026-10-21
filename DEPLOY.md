# Deploy

## Requirements

- **Docker with Compose**, on a machine whose disk is local. The database is one file in WAL mode, and WAL needs shared memory that a network filesystem does not provide
- **An `https` address in front of the container.** The app serves plain HTTP on port 3000; a proxy you run ends TLS. PayPal, Chariot, NOWPayments and Intuit deliver to `https` only. [Behind a proxy](#behind-a-proxy) has the one setting it needs
- **A payment processor account: Stripe, PayPal, Chariot, NOWPayments, or any mix**, before a form can go live. Stripe takes cards, bank debits and the wallets; PayPal takes PayPal and Venmo; Chariot takes one-time gifts from a donor-advised fund; NOWPayments takes one-time crypto gifts. A deployment holding more than one offers each to the donor
- **An SMTP account on port 465**, for receipts. [Email](#email) has a provider table

Set up is in steps, each one usable on its own: the dashboard opens after the first, and a screen says so wherever something can't work yet. **Every value lives in `.env`**, which is gitignored and which `.env.example` names in full; no screen asks for one. A changed `.env` takes effect when the container is recreated:

```sh
docker compose up -d --force-recreate app
```

## 1. Start it

Two values, then three commands:

| Name | What it is |
| --- | --- |
| `ADMIN_PASSWORD` | The deployer's sign-in at `/login`, username `admin`. At least 12 characters: `openssl rand -base64 24` |
| `BETTER_AUTH_SECRET` | The key that signs sign-in sessions: `openssl rand -base64 32`. Changing it signs everyone out |

```sh
cp .env.example .env                 # set the two values above
docker compose run --rm migrate      # before the first start, and after every upgrade
docker compose up -d
```

The server refuses to start without either value and says which. The app answers on the host's port 3000, or on `BETTER_GIVING_PORT` from `.env`. Sign in at `/login` as `admin`: the dashboard opens at once. Until step 2's `https` address is up, sign in at `http://localhost:3000`, on the host itself or through `ssh -L 3000:localhost:3000 <host>` from your machine: over plain `http` at any other address the browser drops the session cookie, and sign-in returns to the form without an error. The database is `better-giving.db` on the named volume `data`, mounted at `/data`; it survives `docker compose down` and every rebuild, and `docker compose down -v` deletes it.

`ADMIN_PASSWORD` is the deployer's credential. Keep it in a password manager: recovery is whoever holds `.env`. Colleagues are invited from `/admin/members`, set their own, and reset a forgotten one from the sign-in page; that reset never reaches this credential. A colleague sees forms, gifts, donors and the books; Settings, Payments, the sites list and QuickBooks are the deployer's alone.

Every push to `main` publishes a built image, `ghcr.io/better-giving/better-giving`, tagged `main` and by commit sha, for `linux/amd64` and `linux/arm64`. `compose.yaml` builds from your checkout instead; pull the image only if you run it without one.

`migrate` applies every committed migration the database has not recorded, then exits. The server never runs one on start, so the migration is always a step you take. Safe to rerun: applied migrations skip.

**One container, never scaled.** The rate limits on `/api/v1`, the read API at `/integrations/v1` and sign-in, the cache in front of the served form config and photos, and the scheduled runs all live in the one process. A second replica would double every limit, serve from a cache the first never cleared, and run every scheduled job twice.

**Stopping is graceful.** `docker compose stop` (or `down`) sends `SIGTERM`: the scheduler stops, open requests finish, work still running after a response (a scheduled run included) settles, and the database closes. Compose waits 30 seconds before it kills the process.

## 2. Your address

Put the `https` proxy in front, then set `BETTER_AUTH_URL` to the public origin, such as `https://give.example.org`, and recreate. Unset, the origin is read off each request. Set, sign-out and the other cookie-bearing writes succeed only from that origin, and it is the address payment notices are registered at and QuickBooks is connected at, so the processor steps below need it.

### Behind a proxy

With `TRUSTED_PROXY_HEADER` unset, the client address is the TCP peer, which behind a proxy is the proxy: every donor shares one rate-limit bucket. Set it to the header your proxy writes the client address into, such as `x-forwarded-for` (its right-most entry is read), and the app also reads `x-forwarded-proto` for the scheme. Set it only when every request passes through that proxy: a header is only as trustworthy as whatever wrote it.

## 3. Your organisation

In `/admin`, **Settings**: find the organisation by name or EIN, which fills the registered name, EIN and address from the IRS files, then **Save details**. **Registered name and EIN gate going live**: a donation form can be drafted without them, and its page says what is missing. Add the notification address under **Notifications**: alerts about gifts, refunds and dispute deadlines go there, and are dropped while it is empty. [Your organisation's profile](#your-organisations-profile) has the rest.

The lookup calls Better Giving's nonprofit service at `nonprofits.better.giving`. Without a key it allows a request a minute and 25 a day; `NONPROFITS_API_KEY` in `.env` raises that. When it can't answer, Settings says so and the boxes save as typed.

## 4. Mail

Set `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD` and `MAIL_FROM` ([Email](#email) has a provider table), recreate, then **Settings → Mail → Send test email**. `MAIL_FROM` is a bare address, not `Name <a@b>`: it is the envelope sender too. `SMTP_PORT` is optional, and 465 is the only value accepted. Until mail is set, donors get no receipt and Settings says so.

## 5. Payments

Each processor is the same three moves: its keys in `.env`, its payment notices registered with one command whose printed line goes in `.env` too, then one recreate. **Without payment notices, donors are charged and no gift reaches your books**, and that is invisible from the donation form; **Payments** in `/admin` shows each processor's standing and says when its notices are unset or not arriving.

```sh
docker compose run --rm app node scripts/setup-webhook.ts stripe     # or paypal, chariot
docker compose up -d --force-recreate app                            # after adding the printed line
```

The command reads `.env` and `BETTER_AUTH_URL`, registers this deployment's notice address on that processor's account, and prints the line `.env` takes (two for Chariot); everything else it says goes to stderr. It exits 1 on a missing value or a refusal, and 2 on a name it does not know. `run --rm` reads `.env` as it is now; `docker compose exec app …` reads what the running container started with, so it needs a recreate first. From a checkout, `pnpm -s setup-webhook:<name>` does the same against `packages/app/.env`, never the root `.env` compose reads.

Then, under **Payments**, press **Set up recurring gifts** on each processor that takes them, if its rows read Not set up. A form can go live once one processor's keys are set.

### Stripe

`STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`, both from one page of one dashboard (Developers → API keys): a mismatched pair is refused by Stripe at the first charge, and the publishable key must start `pk_` because it is served to every browser. `setup-webhook stripe` prints `STRIPE_WEBHOOK_SECRET`. A re-run deletes and recreates the endpoint, so gifts settling in the gap are charged and not recorded: do it when nobody is giving. It is also the repair for an endpoint switched off, short of an event after an upgrade, or whose secret was lost. A failed charge under a repeating gift is one of the events already subscribed: each failed attempt Stripe reports is sent to the webhook destinations subscribed to Recurring charge failed (Integrations → Webhooks), and a repeating gift's own first charge failing on the donation form is not one.

**Bank debits**: a donor whose bank could not be verified instantly is sent two small deposits, and Stripe itself emails them the link to confirm the amounts, at the address the form hands it. This deployment sends nothing for that step, so leave Stripe's customer emails switched on (dashboard.stripe.com → Settings → Emails); switched off, nobody tells the donor, and the gift expires unverified after ten days.

### PayPal

`PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`, one pair from one app in PayPal's developer dashboard. `PAYPAL_API_URL` is optional: unset is `https://api-m.paypal.com`, and a sandbox app takes `https://api-m.sandbox.paypal.com`. `setup-webhook paypal` registers the listener on that app, subscribed to every event this deployment reads, and prints `PAYPAL_WEBHOOK_ID`; a listener already at this address is kept and its subscription brought level, so a re-run is the repair after an upgrade adds an event. **Without a listener, a donor is charged and no gift reaches your books**: `CHECKOUT.ORDER.APPROVED` is what the capture is made from, and a repeating gift is collected by PayPal on its own schedule whether this deployment hears about it or not. Two refusals need something from you: a `BETTER_AUTH_URL` that is not `https://`, and an app already holding PayPal's cap of ten listeners: delete one you no longer use, or use another app's credentials. Switch Disputes on for the app in PayPal's developer dashboard too ([Refunds and disputes](#refunds-and-disputes)).

PayPal retries a failed payment under a repeating gift on its own and, after three failed payments in a row, suspends it, which then reads Payment failed; each failed payment under a repeating gift that has already collected is sent to the webhook destinations subscribed to Recurring charge failed.

**Charity rate**: PayPal reports on no call which rate an account is on, so set `PAYPAL_CHARITY_RATE_APPROVED=true` only if PayPal has approved this organisation for it. Set wrongly, a donor covering fees is quoted less than the gift costs and the org nets less than the donor gave; left unset on an approved account, the surplus reaches the org. Payments shows which rate is quoted.

### Chariot

Gifts from a donor-advised fund, one-time only. Chariot issues keys by email: sandbox keys from support@givechariot.com, and live keys after Chariot reviews a test form's address and a recording of a gift made on it. Set `CHARIOT_API_KEY`, save the organisation's EIN and notification address in **Settings**, then run `setup-webhook chariot`. It finds the organisation in Chariot's directory by that EIN, connects it with the notification address as Chariot's contact, and prints `CHARIOT_CONNECT_ID` and `CHARIOT_WEBHOOK_SECRET`, one line each. A re-run keeps the Connect, so `CHARIOT_CONNECT_ID` is unchanged, and replaces the notice subscription, so `CHARIOT_WEBHOOK_SECRET` is new. `CHARIOT_API_URL` is optional: unset is `https://api.givechariot.com`, and sandbox keys take `https://sandboxapi.givechariot.com`. **Without the notice address registered, a grant never reads received**, so a re-run is the repair.

A gift reads pending until the fund pays: the organisation matches the arriving payment by the tracking id `/admin` Gifts shows beside it and marks the grant received in Chariot's dashboard, and only then does it reach the books, with Chariot's fee. The donor gets an email when the grant request is sent and a thank-you when it is received; neither is a tax receipt, because the fund's sponsor receipted the donor's contribution to the fund. A grant cancelled before it was received reads cancelled and emails nobody. One cancelled after it was marked received, through Chariot's support, reads Refunded: the whole gift comes out of the donor's total and the books as any refund does ([Refunds and disputes](#refunds-and-disputes)), and the donor, thanked at receipt, is sent the refund notice. A grant received and cancelled before this deployment recorded the receipt is booked and refunded in one delivery, and nobody is emailed.

### NOWPayments

One-time crypto gifts. Set `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET` and `NOWPAYMENTS_OUTCOME_CURRENCY`; there is no setup command, because NOWPayments notifies the address each payment names. The payout currency is the lowercase code of the outcome wallet set in NOWPayments' dashboard, such as `usdttrc20`; a gift's minimum is priced against it, so a code that disagrees with the wallet quotes minimums for the wrong coin. A gift is valued at what arrived, not at what was quoted. NOWPayments has no sandbox this deployment reaches: the key is the live account's, and rehearsing is [a second deployment](#a-rehearsal-deployment).

Set these in NOWPayments' dashboard before the first gift. Its help pages call the settings area **Payment Settings** in some places and **Store Settings** in others.

- **The IPN secret** is generated there and shown once; `NOWPAYMENTS_IPN_SECRET` is that value. A different secret refuses every notification, so a crypto gift settles only when the thirty-minute read below reaches it.
- **Instant Payment Notifications: Timeout and Number of recurrent notifications.** Set both as high as the dashboard allows. A notification this deployment could not take is sent again only that many times; a repeat is harmless. A gift still pending here whose notification's retries ran out is caught by the thirty-minute read below, one NOWPayments has since refunded included. A refund of a gift that already settled here is not: its own notification is the only thing that records it, and one whose retries ran out shows in NOWPayments' dashboard and never in `/admin`.
- **One outcome wallet**, in the coin `NOWPAYMENTS_OUTCOME_CURRENCY` names. A second wallet routes its coin's gifts there while minimums are still quoted against the first.
- **Coins settings**: at least one coin switched on. The donor's coin list is exactly that list; a coin switched off later is refused when a donor picks it.
- **The payout arrives net of NOWPayments' fee.** A donor sends the amount quoted and the account is charged, so a gift a donor did not choose to cover the fee on lands short by it. The rate quoted to a donor is NOWPayments' published rate (`NOWPAYMENTS_FEE_RULE` in `packages/app/src/lib/server/payments/fees.ts`); what was actually taken is read off each payment, and the chain's own fee for moving the coin to the payout wallet is on top of it and stated nowhere.
- **Repeated deposits and wrong-asset deposits** work at any setting. A second deposit to a gift's address is recorded as its own gift at what arrived. A deposit in the wrong coin or on the wrong network is held by NOWPayments for you to process in its dashboard, and the gift reads pending until you do.

**Let NOWPayments through the firewall.** Its notifications arrive at the deployment's own address, and a bot or firewall rule in front of it drops them without any error here: donors send coins and no gift reaches your books. NOWPayments gives its sending addresses to allowlist on request, at partners@nowpayments.io.

**A missed notification is caught up every thirty minutes**: the deployment reads each crypto gift still pending after half an hour, until a day after its address closes, and settles or closes it, so a gift whose notification never arrived still reaches the books. A payment the read finds already refunded is settled and refunded in the same pass ([Refunds and disputes](#refunds-and-disputes)). The one exception is a repeat deposit whose notification never arrived: nothing names that payment to read, so it appears in NOWPayments' dashboard and never in `/admin` until recorded by hand.

### The spam check

A donation form solves a self-hosted proof of work (ALTCHA) before a gift is sent, and needs no account. To use Cloudflare Turnstile instead, create a widget at dash.cloudflare.com → Turnstile and set both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`; with only one set, ALTCHA stays the check. The widget's hostname list names the deployment's own hostname and every site under Donation forms → Which sites your forms go on. A host the widget does not list renders the form perfectly and refuses every gift, because Cloudflare will not issue a challenge pass on an unauthorised host.

## 6. Embed

Forms and their paste-ready snippets come from **Donation forms**, and a deployment ships with none. List the site first, under **Donation forms → Which sites your forms go on**; a form loads only where listed *and* ticked.

- The snippet's `<style>` block is part of it: without it the page jumps by the card's height when the element defines. A CMS block strips `<style>` silently: put the rule in the site's theme stylesheet instead.
- **Wallets** (Stripe's rails only; PayPal and Venmo need no hostname registered): Stripe shows Apple Pay / Google Pay / Link only on hostnames registered under its **Settings → Payments → Payment method domains**. Saving the sites list registers the deployment's own hostname and every listed site for you, and **Payments → Register all sites** repairs a gap (a domain Stripe switched off, a save made while Stripe was unreachable). `www.example.org` is a hostname of its own: list it as its own site if donors reach the form there.
- A CSP on the target site needs the directives [`README.md`](./README.md) lists. The failure happens in the donor's browser; this deployment never sees it.
- **Check which deployment a snippet came from before pasting it anywhere real**: it points at the address you read it at. See [A rehearsal deployment](#a-rehearsal-deployment).

## Every configuration value

| Name | Where |
| --- | --- |
| `ADMIN_PASSWORD`, `BETTER_AUTH_SECRET` | [1. Start it](#1-start-it) |
| `BETTER_GIVING_PORT` | Optional. The host port, 3000 when unset |
| `BETTER_AUTH_URL`, `TRUSTED_PROXY_HEADER` | [2. Your address](#2-your-address) |
| `NONPROFITS_API_KEY` | Optional. [3. Your organisation](#3-your-organisation) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `MAIL_FROM` | [4. Mail](#4-mail) |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | [Stripe](#stripe). All three or none |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_API_URL`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_CHARITY_RATE_APPROVED` | [PayPal](#paypal) |
| `CHARIOT_API_KEY`, `CHARIOT_CONNECT_ID`, `CHARIOT_API_URL`, `CHARIOT_WEBHOOK_SECRET` | [Chariot](#chariot) |
| `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `NOWPAYMENTS_OUTCOME_CURRENCY` | [NOWPayments](#nowpayments) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Optional. [The spam check](#the-spam-check) |
| `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_API_URL` | Optional. [Sending gifts to QuickBooks](#sending-gifts-to-quickbooks) |

## Your organisation's profile

**Settings → Organisation details**: registered name, EIN, address, mission, vision, brand colour, social links and logo, all rows in the database rather than configuration values. **Registered name and EIN gate every form going live.** US 501(c)(3) only: the EIN is checked to the digit, stored `12-3456789`; another jurisdiction forks and changes the rule.

On a deployment that ran migration `0026`, the mission, vision, logo and colour set on the dashboard's old organisation page were not carried over: enter them again on this page. Migration `0027` repairs donation pages and campaigns saved under the old look settings.

Every form prints the standard receipt sentence, *"No goods or services were provided in exchange for this gift."* Gifts carrying a benefit (a gala ticket, member perks) make it wrong: edit `SUGGESTED_DEDUCTIBILITY_STATEMENT` in `packages/operator/src/deductibility.ts` and rebuild the image, or write `org_profile.deductibility_statement` directly, where a non-empty value wins. Your organisation makes the claim; a tax professional reviews it.

## Sending gifts to QuickBooks

Optional, and not a processor: QuickBooks takes no money, so a deployment that never connects it is complete. What it does is post every settled gift and every correcting entry into the organisation's own books, and every refund and dispute of a gift it received.

**Register an app with Intuit first.** At [developer.intuit.com](https://developer.intuit.com), create an app and take its client id and secret from **Keys and credentials**. Each app carries two pairs: Development, which works only against sandbox companies, and Production, which works only against real ones. The Production pair does not exist until Intuit approves the questionnaire behind it. Take both halves from the same pair: a Development client id beside a Production secret is refused at the first call.

**Register the return address on that same app, under Redirect URIs**: this deployment's address followed by `/quickbooks/callback`, for example `https://donate.example.org/quickbooks/callback`. **Without it registered, Intuit refuses the round trip** and no company can be connected: the address sent to Intuit has to match one on the app to the character. Intuit redirects only to an `https` address and refuses an IP, so connecting a company against `pnpm dev` needs a tunnel. A rehearsal deployment answers at its own address, so register that one too, or use a second app for it.

**Then put the pair in `.env` and connect the company from Books.** Set `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET` and `QUICKBOOKS_API_URL`, recreate, then in `/admin` open **Books → QuickBooks**, where Setup shows the redirect address to copy, and press **Choose a company**: Intuit's consent screen opens, and choosing a company sends you back to Books with the connection stored on your deployment. The API address is which of Intuit's two this deployment talks to: `https://sandbox-quickbooks.api.intuit.com` for a sandbox company's Development pair, `https://quickbooks.api.intuit.com` for a real company's.

Back on Books, three things finish it:

- **The accounts** a gift is posted into, picked from the connected company's own chart: income, the processor's fee, and for each processor this deployment holds, the account its money lands in. They save together: a gift needs every one, and some saved alone would leave the books half told where to go.
- **The start date**, which is how much of this deployment's history goes over. It is set at connect, and a reconnect keeps it. Moving it earlier sends the gifts it newly covers, including ones from before the company was connected; they go over in date order at the delivery pace under [Scheduled runs](#scheduled-runs), so a long history takes a while to drain, and a gift that settles meanwhile goes ahead of it. Moving it later skips gifts before it that have not been sent yet. A gift already in QuickBooks stays there, and one the deployment has already started sending is not taken back. A refund or dispute moves with its gift: sent where the gift is sent, and skipped where the gift is.
- **Nothing else.** Gifts go over every minute from then on, and a page that says nothing about them is a page with nothing wrong.

**A refund or dispute goes over only after its gift, and only to the company its gift went to.** A refund of a gift QuickBooks received is sent after that gift, whatever day the refund lands. One of a gift the connected company never got, because it was dated before the start date or went to a company since disconnected, is never sent: those books hold nothing for it to take back. A dispute goes over the same way: the money leaving, the money put back if it is won, and any fee or amount its close corrects, won or lost.

**When it stops.** A gift that could not be sent is retried on its own, and one email arrives per outage rather than per gift. Gifts given up on show as a failed count with a **Try these again** press beside it. A credential Intuit has stopped honouring shows **Sign in again**: reconnecting keeps the accounts and the start date, and flushes whatever is waiting. An Intuit outage says so and offers no press, because the deployment keeps trying without you.

**Disconnect** revokes the credential at Intuit and drops the connection here. Nothing already in the books is touched, and nothing further is sent.

## Sending gifts to Zapier

Optional. It starts a Zap on three events: a settled gift (each charge of a recurring gift included), a donor's first settled gift, and money from a gift going back to the donor, which is a refund or a dispute the organisation lost. A refund the processor reports as failed after its event was queued is dropped if that event has not gone out yet; one already sent has reached your Zaps, and no event follows to say the money came back. A gift refunded before its New Gift delivery went out is still delivered. Each reaches your Zaps within about a minute; a burst goes over at the delivery pace under [Scheduled runs](#scheduled-runs).

**On your dashboard, under Integrations → Zapier, press Make key.** The page then shows the two things Zapier asks for: this deployment's address and the key. Copy the key then: it is shown once, and afterwards the page shows only its first and last characters. A key that is lost is replaced, never shown again.

**Then open the Better Giving Zapier app.** It is private for now, reached only through the invite link Zapier gives whoever pushed it from `packages/zapier`. Connect an account with the address and the key, and build Zaps on New Gift, New Donor or Gift Refunded. The Zapier page lists the same three as Settled gifts, New donors and Refunds.

**Replace key** makes a new one, shown once like the first, and disconnects every Zap on the old one. Zapier turns off each Zap it can reach. Reconnect each one with the new key, then turn it on: Zapier only subscribes a Zap when it is turned on, so a Zap still on after the replace has to be turned off and on again.

**When it stops.** A delivery Zapier turns away is retried with a growing wait, and given up after three days. The page says so in a strip at the top, red when deliveries were given up in the past week and amber when your Zaps are more than an hour behind, both with a link to your Zaps on Zapier: a Zap that is off or erroring is the usual cause. A Zap that is turned off or deleted is dropped at once and never leaves anything behind.

## Your own systems, through the read API and webhooks

**The read API and the webhooks are described at your deployment's address followed by `/integrations/openapi.json`, and `/integrations/agent-prompt.md` says the same as instructions for an AI coding agent**; both are served without a key, and the dashboard's Integrations → API page links the first and copies the second.

## Refunds and disputes

**A refund is made in the processor's own dashboard, and reaches everything else by itself.** When Stripe, PayPal or NOWPayments reports a refund of a gift, the gift reads Refunded or Partly refunded in `/admin`, the donor's total drops by it, and the money comes out of the books from the accounts and funds the gift went into. A part refund comes off each fund in proportion; correct any other split in `/admin/books`. The processor's fee stays booked, except any part the processor reports giving back. The donor gets a short email naming what was refunded and what of the gift is still deductible; it is not a new receipt. The refund reaches QuickBooks and Zapier as the two sections above say. Refunding one charge of a monthly gift leaves the monthly gift collecting: stopping it is its own act. A refund the processor later reports as failed puts the money back on the gift and emails you, because the donor may already have been told it is on its way.

A NOWPayments refund is always the whole payment. A crypto payment NOWPayments reports refunded before it settled here, such as a deposit it held and sent back, is settled and refunded in one pass by whichever reads the payment first, a settlement notification delivered again or the thirty-minute read; the refund's own notification is held until then. Its donor is sent neither a receipt nor a refund notice. A Chariot grant has no refund once the fund has paid; the one reversal is a grant cancelled after it was marked received, read as a refund of the whole gift, as [Chariot](#chariot) above says. A gift recorded by hand has no processor to report one, so its refund is a correction in `/admin/books`.

**A dispute alert is an email asking you to answer the dispute.** When a donor disputes a charge, with their bank or with PayPal, the processor takes the money back while the dispute is decided. This deployment records that as soon as it hears: the gift reads Disputed, its money comes off the gift, the donor's total and the books, the processor's dispute fee is booked, and a monthly gift the charge belongs to is stopped, because the card is disputing its charges. The donor is sent nothing. The alert goes to the address under **Settings → Notifications**, and names the amount, the date the processor needs an answer by, and a link into the processor's dashboard.

What you do: answer the dispute in the processor's dashboard, at that link, before that date, with the gift's receipt and anything showing the donor gave. The outcome reaches the books without anyone acting: won, the money goes back on the gift and it reads as before, and whatever of the dispute fee the processor kept stays booked as a processor fee; lost, the money stays off and the gift reads Refunded, or Partly refunded where the dispute was for less than the whole gift. A monthly gift that could not be stopped gets an alert of its own, because the card may still be charged: cancel the subscription in the processor's dashboard, then stop the gift in `/admin`. A returned bank debit is a dispute already lost, with nothing to answer: the gift reads Refunded, every fee Stripe has booked against the return by the time it is read is booked with it, and the alert asks nothing of you. A fee Stripe books against it later is read by nothing, so check the return's fees in Stripe's dashboard.

Two more dispute cases arrive as alerts of their own. **A dispute of a gift that earlier refunds and disputes already took whole** has nothing left to withdraw: nothing is written, a monthly gift behind it is still stopped, and the alert says the books already hold none of the gift and asks you to post only the dispute fee, where one was charged, as a correction in `/admin/books`. It comes again with each delivery of that dispute, since nothing is written to say it was sent. **A dispute won whose opening never reached this deployment**, such as one opened before the endpoint was repaired, writes no money out or back, because the gift never left the books. Where the processor names the fee it kept and the books hold the gift, that fee is booked as a processor fee and the alert, sent once, names it. Otherwise nothing is written and the alert comes with each delivery: it says nothing needs booking where the processor kept no fee, where the fee could not be read it asks you to check it in the processor's dashboard and post what was kept as a correction in `/admin/books`, and where the books do not hold the gift it asks for that correction only if the gift was posted by hand.

**Refunds and disputes arrive only on the events a deployment is subscribed to.** An endpoint or listener registered by an older release is short of them, and **Payments** says so. Run `setup-webhook` for that processor again ([5. Payments](#5-payments)): on PayPal it brings the listener level and keeps its id; on Stripe it recreates the endpoint, so put the new secret in `.env`. The PayPal app those credentials belong to also needs Disputes switched on in PayPal's developer dashboard, because PayPal refuses the disputes read without it. Until it is, a refund is recorded as the organisation's own, with a warning in the app's logs, since whether a dispute stands behind it cannot be read. A dispute, or a reversal PayPal made, is not recorded at all: the alert names the PayPal event, and the fix is to switch Disputes on and then have PayPal resend that event (PayPal's `POST /v1/notifications/webhooks-events/{event_id}/resend`), which records it in full. A correction in `/admin/books` in its place moves the books and nothing else: the gift's status, the donor's total and Zapier stay as they were.

## Checking a deployment

```sh
pnpm run doctor https://donate.example.org
docker compose logs -f app
```

`doctor` posts a deliberately wrong password to `/login` and reads the status, never touching your real one:

| It says                  | What is true                                                                   |
| ------------------------ | ------------------------------------------------------------------------------ |
| healthy                  | password set, long enough, database reachable, schema applied                  |
| could not sign anyone in | `ADMIN_PASSWORD` unusable, or migrations have not reached that database        |
| accepted the probe       | `ADMIN_PASSWORD` equals the junk string published in the script, so rotate it  |

The login screen's *"Sign-in is unavailable"* is deliberately uninformative; the cause comes off the logs.

**Payments shows whether notices are set and whether the processor still has them registered**, but not whether the last delivery got through: Stripe returns the signing secret exactly once and will not confirm it afterwards, so re-running `setup-webhook stripe` is the answer on doubt.

**Nothing shows a refused PayPal delivery either.** PayPal's own developer dashboard lists the deliveries it attempted, and that list is where a refused or unanswered one is visible; re-running `setup-webhook paypal` is the answer on doubt.

## Email

Five values: host, port, username, password, sender. **Port 465 and no other, 587 included**, which opens in the clear and upgrades only if a strippable `STARTTLS` offer survives the path; this app refuses every other port. Postmark documents no 465 and cannot be used. A local mail catcher cannot be used either: a host on `localhost` or a private network is refused by name. Paste a key or password exactly as the provider shows it: the four values are separate so that nothing in a credential needs escaping.

| Provider     | `SMTP_HOST`                         | `SMTP_USERNAME`            | `SMTP_PASSWORD`                  |
| ------------ | ----------------------------------- | -------------------------- | -------------------------------- |
| Resend       | `smtp.resend.com`                   | `resend`                   | `re_xxxxxxxx`                    |
| Amazon SES   | `email-smtp.<region>.amazonaws.com` | your SES SMTP user         | its SMTP password                |
| Mailgun      | `smtp.mailgun.org`                  | `postmaster@<your-domain>` | its password                     |
| SendGrid     | `smtp.sendgrid.net`                 | `apikey`                   | `SG.xxxxxxxx`                    |
| ZeptoMail    | `smtp.zeptomail.com`                | `emailapikey`              | the Mail Agent's send-mail token |
| your own MTA | `mail.example.org`                  | `user`                     | `password`                       |

## Scheduled runs

The server runs its own schedule, `CRON_RUNS` in `packages/app/src/cron-runs.ts`, on UTC minutes: every minute it sends what the deployment owes to QuickBooks, Zapier and webhook destinations; every thirty minutes it reads back crypto gifts no notification settled; at a quarter past and a quarter to it resends refund notices that did not send. A minute the process was down for is not replayed; the next run picks up whatever is still owed. Each minute's run sends up to 40 Zapier events, 40 webhook deliveries and 10 QuickBooks entries (`PACE` in `packages/app/src/lib/server/outbox/budget.ts`), so a backlog drains over several minutes.

## Backups

The database is one file, and a backup is a copy of it: every table, the photos and the record of applied migrations. Taken while the app serves:

```sh
docker compose exec app node scripts/backup.ts /data/backup.db
docker compose cp app:/data/backup.db ./backup.db
docker compose exec app rm /data/backup.db
```

From a checkout against a file on the same machine, `pnpm db:backup <file>` does the same; a relative `<file>` is relative to `packages/app`. Either refuses a target that already exists.

**To restore, stop the app, then put the copy where `DATABASE_URL` points, with no `-wal` or `-shm` file left beside it.** A stale `-wal` beside a restored file is replayed over it. With compose:

```sh
docker compose stop app
docker compose run --rm --no-deps -v "$PWD/backup.db:/restore.db:ro" --entrypoint sh migrate \
  -c 'rm -f /data/better-giving.db-wal /data/better-giving.db-shm && cp /restore.db /data/better-giving.db'
docker compose start app
```

Take one before an upgrade with migrations. A bookkeeping mistake is corrected by a compensating entry, never a restore.

## A rehearsal deployment

A second deployment on its own database, for trying an upgrade or a processor setting away from real donors: a second checkout in a directory of its own, with its own `.env` and its own `BETTER_GIVING_PORT`. Compose names the volume after the directory, so the two never share a database file. Nothing copies between deployments.

The app has no test mode and cannot tell which deployment it runs as. **Do not paste a rehearsal snippet where real donors reach**: a typed card declines loudly, but an Apple Pay / Google Pay gift *succeeds*: Stripe substitutes a test token by design, the success state renders, the receipt sends, and no money moved. Nothing in this repository guards that; you knowing is the guard.

## Upgrading

```sh
git remote add upstream https://github.com/better-giving/better-giving.git   # once
git fetch upstream && git merge upstream/main
docker compose build
docker compose run --rm migrate
docker compose up -d
```

Upstream owns every file, so a clean fork merges fast-forward; a conflict means you edited a tracked file. **Read the diff of `packages/app/migrations/` before migrating**, the irreversible part. A release that squashed the chain shows that whole directory rewritten and applies nothing: migrations are recorded by filename, so `0000_initial_schema.sql` is skipped on a database that already ran it. Meet anything doubtful on a rehearsal first.
