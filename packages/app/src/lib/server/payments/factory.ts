import { readConfigEnv, type ConfigEnv } from '../config/env';
import { refusing, sealed, type PaymentProvider } from './provider';
import { createStripeProvider } from './stripe';
import type { StripeUnreadableReason } from '@better-giving/operator/console/stripe-read';

// the one place a deployment's configuration becomes a `PaymentProvider`.
//
// built per request from `platform.env`, never a module-scope singleton — the same rule the D1
// handle and the Better Auth instance follow (CLAUDE.md), and for the same reason: the secrets
// only exist on a request's platform env, so a cached client is a cached copy of one deployment's
// environment. `createAuth(db, …)` in ../auth/index.ts, built per request at the gate over the
// screens behind the login (../auth/gate.ts), is that shape.
//
// it is deliberately not seeded onto the request context. what belongs there is what every surface
// may need and nothing that costs a read (src/request-context.ts); a provider is built by the two
// call sites that actually move money, and putting one on every request would construct a client
// for thousands of page views that never take a donation.
//
// what is imported rather than restated is the part that must never drift: `readConfigEnv` for
// what counts as set.

/**
 * the one variable no call to Stripe can be made without.
 *
 * it is what a call is authenticated with, so a deployment without it has nothing to build a client
 * around and every arm of the port refuses.
 *
 * the other two Stripe variables are deliberately not here, and each is left out for a reason of its
 * own rather than by a shared rule.
 *
 * `STRIPE_PUBLISHABLE_KEY`: nothing in this module sends it or reads it —
 * it is served to browsers by `publishedConfig` in ../forms/published-config.ts, which refuses to
 * serve a form without it. a deployment missing only that key can still take a donation through
 * an already-served form, so refusing here would be this module reporting somebody else's hole.
 *
 * `STRIPE_WEBHOOK_SECRET`: it is sent on no call at all. its one job is checking that an inbound
 * delivery came from Stripe, which is `verifyEvent`'s alone, and `createStripeProvider` in
 * ./stripe.ts refuses that arm without it — where the refusal belongs, since that is the only arm
 * that cannot be answered. required here, it would refuse every outbound call as well, including the
 * one that registers this deployment's endpoint — and registering an endpoint is the only thing that
 * mints a signing secret. a deployment would be refused for a value it had no way to obtain, and the
 * setup button on the console could never be pressed.
 *
 * neither omission makes a deployment ready to take donations, and neither is this module's claim
 * that it is. what a deployment is short of beyond this one is the console's to report, beside the
 * boxes those values are pasted into (`packages/console-ui/src/lib/payments-fold.tsx`).
 */
const REQUIRED_VAR = 'STRIPE_SECRET_KEY' as const satisfies keyof ConfigEnv;

/**
 * why a read this deployment made against its Stripe account could not be made, for the console
 * surface to carry beside the sentence.
 *
 * here rather than in the two routes that answer with it, because the fact it states is this
 * module's: `no_key` has to mean exactly the deployment `build` below refuses for want of
 * {@link REQUIRED_VAR}, read through the same `readConfigEnv`. computed in a route, it would be a
 * second opinion about which deployments can call Stripe at all, and the day this module required a
 * second value the two would part company with nothing failing.
 *
 * a key that is a publishable one is `failed` and not `no_key`, which is the right side for it: the
 * slot is filled, so the boxes an operator is looking at say a key is set, and a console drawing
 * nothing there would leave the one screen that could tell them silent.
 *
 * `source` is the raw platform env, the same entry point {@link createPaymentProvider} takes.
 */
export function stripeUnreadableReason(source: unknown): StripeUnreadableReason {
	return readConfigEnv(source)[REQUIRED_VAR] ? 'failed' : 'no_key';
}

/**
 * the provider this deployment is configured for.
 *
 * `source` is the raw platform env, narrowed by `readConfigEnv` — the same entry point
 * every other reader of the deploy-time values takes, so a blank value, a whitespace-only value
 * and a binding all mean "absent" here exactly as they do everywhere else.
 *
 * every path returns a provider; none throws and none returns null. a caller's error handling is
 * `if (!result.ok)` and nothing else.
 *
 * and every path is `sealed`, including the one where building fails. the argument-evaluation
 * order is what makes that worth writing carefully: `sealed(build(source))` evaluates `build`
 * before the seal exists, so a throw inside it would reach the caller — and one of the two callers
 * is a webhook route, where an exception is a 500 and a 500 is a delivery Stripe brings back for
 * three days.
 */
export function createPaymentProvider(source: unknown): PaymentProvider {
	try {
		return sealed(build(source));
	} catch (error) {
		logFactoryFault(error);
		return refusing(
			'internal_error',
			'The payment provider could not be built at all, which is not a state this app is ' +
				'supposed to be able to reach. Nothing about the deployment fixes it. It is a bug in ' +
				'this app, and the cause is in this deployment’s logs (the Cloudflare dashboard, or `pnpm run logs` from a checkout). No payment was taken.'
		);
	}
}

function build(source: unknown): PaymentProvider {
	const env = readConfigEnv(source);

	// one variable, so one sentence. what a deployment is short of beyond this is the console's to
	// report — a refusal here names what stopped this call, and nothing about the rest of the setup.
	const secretKey = env[REQUIRED_VAR];
	if (!secretKey) {
		return refusing(
			'not_configured',
			`This deployment cannot take a payment: \`${REQUIRED_VAR}\` is not set. Open the ` +
				'console (`better-giving open`) and set it under Donation processor.'
		);
	}

	// `null` where the deployment holds no signing secret, never an empty string standing in for one.
	// the adapter's own type is what carries the distinction: an empty string is a secret that
	// verifies nothing and reports a signature mismatch, which sends an operator to check a value
	// against the endpoint it was minted for instead of telling them there is none.
	return createStripeProvider({ secretKey, webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null });
}

/**
 * writes the fault to the log without becoming one.
 *
 * `console.error(…, error)` serialises the value it is given, which runs whatever getter the
 * thrower supplied — so the `catch` that exists to have no throw site would have one. swallowing
 * the second failure is right here: the caller is already returning a refusal that names the fault
 * and points at the logs, and re-throwing would defeat the guard it is called from.
 */
function logFactoryFault(error: unknown): void {
	try {
		console.error('the payment factory threw while building a provider:', error);
	} catch {
		// nothing to report it to, and nothing this function may throw.
	}
}
