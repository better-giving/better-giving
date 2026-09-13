// what a press says when the console itself died part way through it.
//
// **it is a state of this console and never of the thing the press was addressed to.** the run was
// on a goroutine in the binary the operator is looking at, and it stopped where it stood — so
// nothing observed how far it got, and every arm the chain could have ended on is a claim about
// Cloudflare, Stripe or the deployment that nobody made. the binary answers it as its own kind
// carrying no member (`packages/console/internal/server/deploy.go` and
// `packages/console/internal/stripe/run.go`), and this is the sentence for it.
//
// **it says press again, and that is safe on all three presses that can meet it.** each of them
// reads what is there before it changes anything — the widget is found by name, the endpoints are
// listed off the account, the migrations are compared against the database's own table — so a
// second press repairs a half-finished first one rather than doubling it.
//
// **nothing the failure carried is in it.** the press it died inside was holding a password, a
// Cloudflare credential or a Stripe secret key, and a value raised from within one may be spelling
// any of them, so the binary drops it where it stands and the screen has this to say instead.
//
// it is a module rather than a literal in each of the three places that say it for
// ./unread-answer.ts's reason: this package's pool is node-only and collects `*.spec.ts`
// (packages/console-ui/vite.config.ts), so a sentence written inline in a component is one nothing
// here can hold.

/**
 * the sentence, with what the press had reached by the time it stopped.
 *
 * `held` is a whole sentence rather than a fragment, because the two presses that say this reached
 * different places: a deploy's work is on Cloudflare and a Stripe press's is on the processor
 * account, and an operator sent to look at the wrong one finds nothing and concludes nothing
 * happened.
 */
export const pressStopped = (held: string): string =>
	`This console stopped part way through this press and doesn't know how far it got. ${held} Press it again. It reads what is already there rather than assuming.`;

/** what a press that deploys had reached, which is the account the worker and the database are in. */
export const REACHED_CLOUDFLARE =
	'What reached Cloudflare before it stopped is what your deployment holds now.';

/** what a press that sets the processor up had reached, which is the Stripe account itself. */
export const REACHED_STRIPE =
	'What reached Stripe before it stopped is what your account holds now.';

/**
 * what a press that sets PayPal up had reached, which is the PayPal app's webhooks.
 *
 * the deployment is written last and in one write, so what could be part-way is the app — and the
 * next press finds a webhook already at this address and keeps it rather than adding a second.
 */
export const REACHED_PAYPAL =
	'What reached PayPal before it stopped is what your PayPal app holds now.';
