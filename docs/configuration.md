# Configuration

Every configuration value is an environment variable. Compose reads the root `.env`, which is gitignored. `.env.example` names each one. A checkout command such as `pnpm db:migrate` reads `packages/app/.env` instead ([Contributing](../CONTRIBUTING.md)). On Fly.io the same names are secrets ([Deployment](../DEPLOY.md#flyio)).

`DATABASE_URL`, `PORT`, and `HOST` are not in `.env.example`. The container gets them from `compose.yaml` or `fly.toml`, and those files win over anything `.env` says.

A changed `.env` is read when the container is recreated ([Deployment](../DEPLOY.md#1-start-it)).

One install serves one organisation. The profile below is that organisation's. A second organisation is another install ([Architecture](architecture.md)).

## Every value

| Name | Where |
| --- | --- |
| `ADMIN_PASSWORD`, `BETTER_AUTH_SECRET` | [Sign-in](#sign-in) |
| `BETTER_GIVING_PORT` | Optional. The host port Compose publishes, 3000 when unset (`compose.yaml`) |
| `BETTER_AUTH_URL`, `TRUSTED_PROXY_HEADER` | [Your address](#your-address) |
| `NONPROFITS_API_KEY` | Optional. [Your organisation's profile](#your-organisations-profile) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `MAIL_FROM` | [Mail](#mail) |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | [Stripe](#stripe). All three or none |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_API_URL`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_CHARITY_RATE_APPROVED` | [PayPal](#paypal) |
| `CHARIOT_API_KEY`, `CHARIOT_CONNECT_ID`, `CHARIOT_API_URL`, `CHARIOT_WEBHOOK_SECRET` | [Chariot](#chariot) |
| `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `NOWPAYMENTS_OUTCOME_CURRENCY` | [NOWPayments](#nowpayments) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Optional. [The spam check](#the-spam-check) |
| `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_API_URL` | Optional. [QuickBooks](#quickbooks) |

## Sign-in

| Name | What it is |
| --- | --- |
| `ADMIN_PASSWORD` | The deployer's sign-in at `/login`, username `admin`. At least 12 characters (`packages/operator/src/admin-password.ts`): `openssl rand -base64 24` |
| `BETTER_AUTH_SECRET` | The key that signs sign-in sessions: `openssl rand -base64 32`. Changing it signs everyone out |

The server refuses to start without either, or on a password under 12 characters, and says why. `ADMIN_PASSWORD` is the deployer's credential. Keep it in a password manager: recovery is whoever holds `.env`. Colleagues are invited from `/admin/members`, set their own, and reset a forgotten one from the sign-in page. That reset never reaches this credential. A colleague sees forms, gifts, donors, and the books. Settings, Payments, the sites list, and QuickBooks are the deployer's alone (`packages/app/src/lib/admin/destinations.ts`).

## Your address

`BETTER_AUTH_URL` is the public origin, such as `https://give.example.org`. It is the address payment notices are registered at and QuickBooks is connected at. Unset, those use the origin of the request in front of them. It does not decide which origin may carry a session cookie.

With `TRUSTED_PROXY_HEADER` unset, the client address is the TCP peer (`packages/app/src/lib/server/runtime/client-ip.ts`). Behind a proxy that peer is the proxy, and every donor shares one rate-limit bucket. Set the variable to the header your proxy writes the client address into, such as `x-forwarded-for` (its right-most entry is read). The app also reads `x-forwarded-proto` for the scheme once a proxy header is set. Set it only when every request passes through that proxy.

The session cookie is `Secure` unless the origin that check sees is loopback: `localhost`, a host ending in `.localhost`, or `127.0.0.1` (`isLoopbackOrigin` in `packages/app/src/lib/server/auth/index.ts`). An `https://` value in `BETTER_AUTH_URL` makes the cookie `Secure` even when the page is `http://localhost`. Plain `http://[::1]` is not on that list, so the browser drops the cookie and sign-in returns to the form with no error. The same drop happens on any other plain `http` address. Until the `https` address is up, sign in at `http://localhost:3000` or `http://127.0.0.1:3000` on the host itself, with `BETTER_AUTH_URL` unset or set to that same origin, or through `ssh -L 3000:localhost:3000 <host>`.

## Your organisation's profile

In `/admin`, Settings: find the organisation by name or EIN, which fills the registered name, EIN, and address from the IRS files, then Save details. Registered name and EIN gate going live (`packages/app/src/lib/server/org/identity.ts`). A donation form can be drafted without them, and its page says what is missing. Add the notification address under Notifications: alerts about gifts, refunds, and dispute deadlines go there, and are dropped while it is empty.

The lookup calls Better Giving's nonprofit service at `nonprofits.better.giving`. Without a key it allows a request a minute and 25 a day. `NONPROFITS_API_KEY` raises that. When it can't answer, Settings says so and the boxes save as typed.

Registered name, EIN, address, mission, vision, brand colour, social links, and logo are rows in the database. US 501(c)(3) only: the EIN is checked to the digit and stored `12-3456789`. Another jurisdiction forks and changes that rule.

Every form prints the standard receipt sentence, "No goods or services were provided in exchange for this gift." Gifts carrying a benefit (a gala ticket, member perks) make it wrong: edit `SUGGESTED_DEDUCTIBILITY_STATEMENT` in `packages/operator/src/deductibility.ts` and rebuild the image, or write `org_profile.deductibility_statement` directly, where a non-empty value wins. Your organisation makes the claim. A tax professional reviews it.

## Mail

Set `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `MAIL_FROM`, recreate, then Settings → Mail → Send test email. `MAIL_FROM` is a bare address, not `Name <a@b>`: it is the envelope sender too. `SMTP_PORT` is optional, and 465 is the only value accepted (`packages/app/src/lib/server/email/smtp-config.ts`). Until mail is set, donors get no receipt and Settings says so.

Port 465 and no other, 587 included. 587 opens in the clear and upgrades only if a strippable `STARTTLS` offer survives the path. This app refuses every other port. Postmark documents no 465 and cannot be used. A local mail catcher cannot be used either: a host on `localhost` or a private network is refused by name. Paste a key or password exactly as the provider shows it. The four values are separate so that nothing in a credential needs escaping.

| Provider | `SMTP_HOST` | `SMTP_USERNAME` | `SMTP_PASSWORD` |
| --- | --- | --- | --- |
| Resend | `smtp.resend.com` | `resend` | `re_xxxxxxxx` |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | your SES SMTP user | its SMTP password |
| Mailgun | `smtp.mailgun.org` | `postmaster@<your-domain>` | its password |
| SendGrid | `smtp.sendgrid.net` | `apikey` | `SG.xxxxxxxx` |
| ZeptoMail | `smtp.zeptomail.com` | `emailapikey` | the Mail Agent's send-mail token |
| your own MTA | `mail.example.org` | `user` | `password` |

## Payments

Each processor is the same three moves: its keys in `.env`, its payment notices registered with one command whose printed line goes in `.env` too, then one recreate. A form stays offline while any processor whose keys are set is missing its notice value, so an unset notice does not charge a donor (`packages/app/src/lib/server/forms/readiness.ts`). A donor who was charged and whose gift never reaches the books had a notice that was set and did not arrive. Payments in `/admin` shows each processor's standing and says which of those it is.

```sh
docker compose run --rm app node scripts/setup-webhook.ts stripe     # or paypal, chariot
docker compose up -d --force-recreate app                            # after adding the printed line
```

The command reads `.env` and `BETTER_AUTH_URL`, registers this deployment's notice address on that processor's account, and prints the line `.env` takes (two on Chariot's first run). Everything else it says goes to stderr. It exits 1 on a missing value or a refusal, and 2 on a name it does not know (`packages/app/scripts/setup-webhook.ts`). `run --rm` reads `.env` as it is now. `docker compose exec app …` reads what the running container started with, so it needs a recreate first. From a checkout, `pnpm -s setup-webhook:<name>` does the same against `packages/app/.env`.

Then, under Payments, press Set up recurring gifts on each processor that takes them, if its rows read Not set up. A form can go live once one processor can settle a gift: its keys and its payment-notice value. Keys alone leave the form offline (`packages/app/src/lib/server/forms/readiness.ts`).

On Fly.io the same command runs over SSH and the printed line is imported as a secret ([Deployment](../DEPLOY.md#flyio)).

### Stripe

`STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`, both from one page of one dashboard (Developers → API keys). A mismatched pair is refused by Stripe at the first charge, and the publishable key must start `pk_` because it is served to every browser. `setup-webhook stripe` prints `STRIPE_WEBHOOK_SECRET`. A test-mode endpoint and a live one have different signing secrets. A re-run deletes the endpoint and creates a new one. Install the printed secret before Stripe stops retrying deliveries to the old address, about three days. A delivery whose destination is already gone is not retried. Do it when nobody is giving. It is also the repair for an endpoint short of an event after an upgrade. An endpoint switched off is switched back on in Stripe's dashboard, and a lost secret is read there too (Workbench → Webhooks, the endpoint, reveal its signing secret), so neither needs a re-run. A failed charge under a repeating gift is one of the events already subscribed: each failed attempt Stripe reports is sent to the webhook destinations subscribed to Recurring charge failed. The checkbox under Integrations → Webhooks, on Recurring gifts, is Charge failed (`packages/app/src/lib/webhooks/catalog.ts`). A repeating gift's own first charge failing on the donation form is not one.

Bank debits: a donor whose bank could not be verified instantly confirms a deposit Stripe sends. The usual one is $0.01 with a bank descriptor starting `SM`. Two small deposits are the fallback. Stripe emails the confirmation link when it has the donor's email, which this form sends. This deployment sends nothing for that step, so leave Stripe's customer emails switched on (dashboard.stripe.com → Settings → Emails). Switched off, nobody tells the donor, and the gift expires unverified after ten days.

### PayPal

`PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`, one pair from one app in PayPal's developer dashboard. `PAYPAL_API_URL` is optional: unset is `https://api-m.paypal.com`, and a sandbox app takes `https://api-m.sandbox.paypal.com`. `setup-webhook paypal` registers the listener on that app, subscribed to every event this deployment reads, and prints `PAYPAL_WEBHOOK_ID`. A listener already at this address is kept and its subscription brought level, so a re-run is the repair after an upgrade adds an event. Without a listener, a one-off PayPal gift stays approved and is not captured. The capture is made from `CHECKOUT.ORDER.APPROVED` (`packages/app/src/lib/server/payments/paypal.ts`). A repeating gift is still collected by PayPal on its own schedule, and this deployment does not hear about it. Two refusals need something from you: a `BETTER_AUTH_URL` that is not `https://`, and an app already holding PayPal's cap of ten listeners. Delete one you no longer use, or use another app's credentials. Switch Customer disputes on for the app in PayPal's developer dashboard. A new app often already has it selected ([Refunds and disputes](../DEPLOY.md#refunds-and-disputes)).

PayPal retries a failed payment under a repeating gift on its own. The plan's failure threshold is 3 (`PAYMENT_FAILURE_THRESHOLD` in `packages/app/src/lib/server/payments/paypal.ts`), which is one cycle of attempts, and a gift that reaches it reads Payment failed. Each failed payment under a repeating gift that has already collected is sent to the webhook destinations subscribed to Recurring charge failed.

Charity rate: PayPal reports on no call which rate an account is on, so set `PAYPAL_CHARITY_RATE_APPROVED=true` only if PayPal has approved this organisation for it. Set wrongly, a donor covering fees is quoted less than the gift costs and the org nets less than the donor gave. Left unset on an approved account, the surplus reaches the org. Payments shows which rate is quoted.

### Chariot

Gifts from a donor-advised fund, one-time only. Chariot issues keys by email: sandbox keys from support@givechariot.com, and live keys from integrations@givechariot.com after Chariot reviews a test form's address, a recording of a gift made on it, a fund that is not yet integrated, and a go-live date. Set `CHARIOT_API_KEY`, save the organisation's EIN and notification address in Settings, then run `setup-webhook chariot`. It finds the organisation in Chariot's directory by that EIN, connects it with the notification address as Chariot's contact, and prints `CHARIOT_CONNECT_ID` and `CHARIOT_WEBHOOK_SECRET`, one line each. A Connect Chariot has not switched on still prints its id, and the terminal says no fund gift can be made until Chariot switches it on. A re-run with `CHARIOT_CONNECT_ID` in `.env` reads neither Settings nor Chariot's directory: it replaces the notice subscription and prints only the new `CHARIOT_WEBHOOK_SECRET`. Without it, a re-run gets back the Connect Chariot already holds, so the printed `CHARIOT_CONNECT_ID` is the same one. Take a sandbox id out of `.env` before using live keys. Sandbox and live are different servers, and a set id skips creating the Connect (`packages/app/src/lib/server/payments/webhook-setup.ts`). `CHARIOT_API_URL` is optional: unset is `https://api.givechariot.com`, and sandbox keys take `https://sandboxapi.givechariot.com`. Without the notice address registered, a grant never reads received, so a re-run is the repair.

A gift reads pending until you mark it received. The organisation matches the arriving payment by the tracking id `/admin` Gifts shows beside it and marks the grant received in Chariot's dashboard, and only then does it reach the books, with Chariot's fee. The donor gets an email when the grant request is sent and a thank-you when it is received. Neither is a tax receipt, because the fund's sponsor receipted the donor's contribution to the fund. A grant cancelled before it was received reads cancelled and emails nobody. One cancelled after it was marked received, through Chariot's support, reads Refunded: the whole gift comes out of the donor's total and the books as any refund does ([Refunds and disputes](../DEPLOY.md#refunds-and-disputes)), and the donor, thanked at receipt, is sent the refund notice. A grant received and cancelled before this deployment recorded the receipt is booked and refunded in one delivery, and nobody is emailed.

### NOWPayments

One-time crypto gifts. Set `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, and `NOWPAYMENTS_OUTCOME_CURRENCY`. NOWPayments notifies the address each payment names, so a gift is registered when it is created, not by `setup-webhook`. The payout currency is the lowercase code of the outcome wallet set in NOWPayments' dashboard, such as `usdttrc20`. A gift's minimum is priced against it, so a code that disagrees with the wallet quotes minimums for the wrong coin. A gift is valued at what arrived, not at what was quoted. NOWPayments has no sandbox this deployment reaches: the key is the live account's, and rehearsing is [a second deployment](../DEPLOY.md#a-rehearsal-deployment).

Set these in NOWPayments' dashboard before the first gift. Its help pages call the settings area Payment Settings in some places and Store Settings in others.

- The IPN secret is generated there and shown once. `NOWPAYMENTS_IPN_SECRET` is that value. A different secret refuses every notification, so a crypto gift settles only when the thirty-minute read below reaches it.
- Instant Payment Notifications: Timeout and Number of recurrent notifications. Set both as high as the dashboard allows. A notification this deployment could not take is sent again only that many times. A repeat is harmless. A gift still pending here whose notification's retries ran out is caught by the thirty-minute read below, one NOWPayments has since refunded included. A refund of a gift that already settled here is not: its own notification is the only thing that records it, and one whose retries ran out shows in NOWPayments' dashboard and never in `/admin`.
- One outcome wallet, in the coin `NOWPAYMENTS_OUTCOME_CURRENCY` names. This deployment does not name an outcome currency on the payment it creates (`createIntent` in `packages/app/src/lib/server/payments/nowpayments.ts`). Minimums are quoted against `NOWPAYMENTS_OUTCOME_CURRENCY`. A second wallet in the dashboard does not by itself send one coin there while those minimums stay on the first.
- Coins settings: at least one coin switched on. The donor's list is the coins switched on that NOWPayments also marks enabled and available for payment (`acceptedCoinOf` in `packages/app/src/lib/server/payments/nowpayments.ts`). A coin switched off later is refused when a donor picks it.
- The payout arrives net of NOWPayments' fee. A donor sends the amount quoted and the account is charged, so a gift a donor did not choose to cover the fee on lands short by it. The rate quoted to a donor is 1% (`NOWPAYMENTS_FEE_RULE` in `packages/app/src/lib/server/payments/fees.ts`). The fee read off a payment is the sum of its deposit, service, and withdrawal parts when that sum is in US dollars or in the coin the donor paid. A non-zero fee in any other coin, often the payout coin, is left for an operator to enter (`feeInCents` in `packages/app/src/lib/server/payments/nowpayments.ts`). A payment markup set in NOWPayments' dashboard is not cleared when the gift is created, so it stacks on that 1%.
- A second deposit to a gift's address is its own payment when NOWPayments reports it, recorded at what arrived. A deposit in the wrong coin or on the wrong network stays with NOWPayments until the account processes it. Neither becomes a gift here at every dashboard setting.

Let NOWPayments through the firewall. Its notifications arrive at the deployment's own address, and a bot or firewall rule in front of it drops them with no error here. An ordinary gift still pending is booked by the thirty-minute read below, so entering that gift by hand books it twice. What a dropped notification loses is a refund of a gift that already settled, and a repeat deposit that no notification names. NOWPayments gives its sending addresses to allowlist on request, at partners@nowpayments.io.

A missed notification is caught up every thirty minutes: the deployment reads each crypto gift still pending after half an hour, until a day after its address closes, and settles or closes it. A run reads at most 100. One payment's own fault does not stop the rest. A read NOWPayments does not answer stops the run (`packages/app/src/lib/server/donations/pending-crypto-read.ts`). A payment the read finds already refunded is settled and refunded in the same pass ([Refunds and disputes](../DEPLOY.md#refunds-and-disputes)). The one exception is a repeat deposit whose notification never arrived: nothing names that payment to read, so it appears in NOWPayments' dashboard and never in `/admin` until entered by hand.

## The spam check

A donation form solves a self-hosted proof of work (ALTCHA) before a gift is sent, and needs no account. To use Cloudflare Turnstile instead, create a widget at dash.cloudflare.com → Turnstile and set both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. With only one set, ALTCHA stays the check. The widget's hostname list names the deployment's own hostname and every site under Donation forms → Which sites your forms go on. A host the widget does not list renders the form and refuses every gift, because Cloudflare will not issue a challenge pass on an unauthorised host. The page that embeds the form also needs Turnstile's CSP entries ([Embed a form](embed.md)).

## QuickBooks

Optional. QuickBooks posts every settled gift and every correcting entry into the organisation's own books, and every refund and dispute of a gift it received. A deployment that never connects it still takes gifts through its processors.

Register an app with Intuit first. At [developer.intuit.com](https://developer.intuit.com), create an app and take its client id and secret from Keys and credentials. Each app carries two pairs: Development, which works only against sandbox companies, and Production, which works only against real ones. The Production pair does not exist until Intuit approves the questionnaire behind it. Take both halves from the same pair: a Development client id beside a Production secret is refused at the first call.

Register the return address on that same app, under Redirect URIs: this deployment's address followed by `/quickbooks/callback`, for example `https://donate.example.org/quickbooks/callback`. Without it registered, Intuit refuses the round trip and no company can be connected: the address sent to Intuit has to match one on the app to the character. A Development pair accepts a localhost redirect, so connecting a sandbox company from `pnpm dev` needs no tunnel. A Production pair accepts only `https` and refuses localhost and an IP address. A rehearsal deployment answers at its own address, so register that one too, or use a second app for it.

Then put the pair in `.env` and connect the company from Books. Set `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, and `QUICKBOOKS_API_URL`, recreate, then in `/admin` open Books → QuickBooks, where Setup shows the redirect address to copy, and press Choose a company. Intuit's consent screen opens. The callback stores the connection and shows its own page. Books is the Back to Books link on that page. The API address is which of Intuit's two this deployment talks to: `https://sandbox-quickbooks.api.intuit.com` for a sandbox company's Development pair, `https://quickbooks.api.intuit.com` for a real company's.

Back on Books, three things finish it:

- The accounts a gift is posted into, picked from the connected company's own chart: income, the processor's fee, and for each processor this deployment holds, the account its money lands in. They save together. A gift needs every one, and some saved alone would leave the books half told where to go.
- The start date, which is how much of this deployment's history goes over. At connect it is the instant the company was connected. A gift is sent only when that instant is at or before the gift (`start_at` in `packages/app/src/lib/server/accounting/outbox.ts`). Books shows that instant as a UTC calendar day. A gift earlier on that same UTC day stays out until the day is saved, which stores UTC midnight of the day in the box (`readAccountingDate` in `packages/app/src/lib/ledger/input-schema.ts`). A reconnect keeps the date, including a reconnect to a different company. Disconnect deletes the connection, so the next connect starts from that new instant (`disconnectQuickbooks` in `packages/app/src/lib/server/accounting/connection.ts`). Moving the date earlier queues the gifts and unsent corrections it newly covers, including ones from before the company was connected. They go over in date order at the delivery pace under [Scheduled runs](../DEPLOY.md#scheduled-runs), so a long history takes a while to drain, and a gift that settles meanwhile goes ahead of it. Moving it later drops gifts and unsent corrections before it that have not been sent yet. A gift already in QuickBooks stays there, and one the deployment has already started sending is not taken back. A refund or dispute moves with its gift: sent where the gift is sent, and dropped where the gift is.
- Nothing else. Gifts go over every minute from then on, and a page that says nothing about them is a page with nothing wrong.

A refund or dispute goes over only after its gift, and only to the company its gift went to. A refund of a gift QuickBooks received is sent after that gift, whatever day the refund lands. One of a gift the connected company never got, because it was dated before the start date or went to a company since disconnected, is never sent: those books hold nothing for it to take back. A dispute goes over the same way: the money leaving, the money put back if it is won, and any fee or amount its close corrects, won or lost.

When it stops. A gift that could not be sent is retried on its own, and one email arrives per outage rather than per gift. Gifts given up on show as a failed count with a Try these again press beside it. A credential Intuit has stopped honouring shows Sign in again: reconnecting keeps the accounts and the start date, and flushes whatever is waiting. An Intuit outage says so and offers no press, because the deployment keeps trying without you.

Disconnect revokes the credential at Intuit and drops the connection here. Nothing already in the books is touched, and nothing further is sent.

## Zapier

Optional. It starts a Zap on three events: a settled gift (each charge of a recurring gift included), a donor's first settled gift, and money from a gift going back to the donor, which is a refund or a dispute the organisation lost. A refund the processor reports as failed after its event was queued is dropped if that event has not gone out yet. One already sent has reached your Zaps, and no event follows to say the money came back. A gift refunded before its New Gift delivery went out is still delivered. Each reaches your Zaps within about a minute. A burst goes over at the delivery pace under [Scheduled runs](../DEPLOY.md#scheduled-runs).

On your dashboard, under Integrations → Zapier, press Make key. The page then shows the two things Zapier asks for: this deployment's address and the key. Copy the key then: it is shown once, and afterwards the page shows only its first and last characters. A key that is lost is replaced, never shown again.

Then open the Better Giving Zapier app, reached through the invite link Zapier gives whoever pushed it from `packages/zapier`. Connect an account with the address and the key, and build Zaps on New Gift, New Donor, or Gift Refunded. The Zapier page lists the same three as Settled gifts, New donors, and Refunds.

Replace key makes a new one, shown once like the first, and disconnects every Zap on the old one. Zapier turns off each Zap it can reach. Reconnect each one with the new key, then turn it on. Zapier only subscribes a Zap when it is turned on, so a Zap still on after the replace has to be turned off and on again.

When it stops. A delivery Zapier turns away is retried with a growing wait, and given up after three days. The page says so in a strip at the top, red when deliveries were given up in the past week and amber when your Zaps are more than an hour behind, both with a link to your Zaps on Zapier. A Zap that is off or erroring is the usual cause. A Zap that is turned off or deleted is dropped at once and never leaves anything behind.

## Your own systems

The read API and the webhooks are described at your deployment's address followed by `/integrations/openapi.json`. `/integrations/agent-prompt.md` says the same as instructions for an AI coding agent. Both are served without a key, and the dashboard's Integrations → API page links the first and copies the second.
