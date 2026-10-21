import type { Provider, PaymentMethod as QuotedRail } from '@better-giving/form/v1';
import { envLine, RECREATE_APP, setupWebhookCommand } from '@better-giving/operator/deploy-split';
import { LOGS_SAY_WHY } from '$lib/deployment-logs';
import { readConfigEnv, type ConfigEnv } from '../config/env';
import {
	PROCESSOR_LABELS,
	PROCESSOR_NAMES,
	processorOf,
	refusing,
	sealed,
	type PaymentProvider,
	type ProcessorName
} from './provider';
import { CHARIOT_LIVE_API_URL, createChariotProvider } from './chariot';
import { createNowpaymentsProvider } from './nowpayments';
import {
	createPaypalProvider,
	PAYPAL_DEFAULT_API_URL,
	paypalApiOrigin,
	paypalSdkUrl,
	unusablePaypalAddress
} from './paypal';
import { createStripeProvider } from './stripe';
import { noticeVariable } from './webhook-secret';
import type { StripeUnreadableReason } from '@better-giving/operator/console/stripe-read';

// the one place a deployment's configuration becomes a `PaymentProvider`.
//
// two facts live here and are stated exactly once: which variables each processor cannot be called
// without, and what a processor answers where one of them is short. left to callers, the donation
// path writes its own rail map, the served config writes its own configured list and the Payments
// screen writes a third — and the first disagreement is silent, a donor offered a rail nothing can
// mint an order on.
//
// built per request from the env, never a module-scope singleton — the same rule the database
// handle and the Better Auth instance follow (CLAUDE.md), and for the same reason: the secrets
// only exist on a request's platform env, so a cached client is a cached copy of one deployment's
// environment. `createAuth(db, …)` in ../auth/index.ts, built per request at the gate over the
// screens behind the login (../auth/gate.ts), is that shape.
//
// it is deliberately not seeded onto the request context. what belongs there is what every surface
// may need and nothing that costs a read (src/request-context.ts); the set is built by the routes
// that serve a form or move money, and it builds each adapter only when one is asked for — so a
// page view that takes no donation constructs no client.
//
// what is imported rather than restated is the part that must never drift: `readConfigEnv` for
// what counts as set.

/** one processor, as this module has to know it: what it cannot be called without, and how. */
type Processor = {
	/** the variables this processor cannot be called without, for the sentence and for `configured`. */
	readonly requires: readonly (keyof ConfigEnv)[];
	/**
	 * the adapter, which answers `null` for a value it is short of.
	 *
	 * that is the same requirement as `requires` beside it, stated where the type system needs it — a
	 * variable read off `ConfigEnv` is optional whatever a list read at runtime has just proved. the
	 * two are held together by ./factory.spec.ts, which asks each processor for an adapter one
	 * variable at a time.
	 *
	 * every processor this app names has one. a processor named at the port with no adapter behind it
	 * is a compile error here rather than a state the rest of this module carries a branch for.
	 */
	readonly build: (env: ConfigEnv) => PaymentProvider | null;
	/**
	 * the value this processor holds and cannot be called with, and a clause naming it and the shape
	 * it has to take, or `null` where every one can.
	 *
	 * a value set in a shape no call can be made with is the same answer as one unset — the processor
	 * is not configured, never on `configured`, and the value is on `unset` — told apart only by the
	 * clause.
	 */
	readonly unusable?: (
		env: ConfigEnv
	) => { readonly variable: keyof ConfigEnv; readonly clause: string } | null;
	/**
	 * the script the donor's page starts this processor's SDK from, for `Provider.sdkUrl` in
	 * packages/form/src/v1.ts, or `null` where the entry names none and the page loads its adapter's
	 * own default.
	 */
	readonly sdkUrl?: (env: ConfigEnv) => string | null;
};

/**
 * the variables no call to a processor can be made without, per processor.
 *
 * they are what a call is authenticated with, so a deployment short of one has nothing to build a
 * client around and every arm of the port refuses.
 *
 * `PAYPAL_CLIENT_ID` is on PayPal's list though it is the half of its pair the browser gets, and
 * that is not the exception it looks like: PayPal authenticates a server call with the pair
 * together, so a deployment holding only the secret can make no call at all. `STRIPE_PUBLISHABLE_KEY`
 * is left off Stripe's for the opposite reason and is argued below.
 *
 * `PAYPAL_WEBHOOK_ID` is off this list on `STRIPE_WEBHOOK_SECRET`'s argument rather than one of its
 * own: it is sent on no outbound call, and `verifyEvent` in ./paypal.ts is the one arm that reads it
 * — where the refusal belongs, since that is the only arm that cannot be answered without it.
 * required here, it would refuse every outbound call on a deployment that can take a gift and merely
 * cannot hear about it settling. `PAYPAL_CHARITY_RATE_APPROVED` is off it because
 * it is not a credential at all — it picks which published fee table a donor is quoted from
 * (./fees.ts), and unset is an answer rather than a gap.
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
 * mints a signing secret. a deployment would be refused for a value it had no way to obtain, and
 * `scripts/setup-webhook.ts` could never run.
 *
 * neither omission makes a deployment ready to take donations, and neither is this module's claim
 * that it is. what a deployment is short of beyond this one is the Payments screen's to report
 * (`packages/app/src/routes/_app.admin.payments.tsx`).
 *
 * total over `ProcessorName`, so a processor named at the port without a credential list here is a
 * compile error rather than one this module reports as configured on a deployment holding nothing.
 */
const PROCESSORS: Readonly<Record<ProcessorName, Processor>> = Object.freeze({
	stripe: {
		requires: ['STRIPE_SECRET_KEY'],
		build: (env) => {
			const secretKey = env.STRIPE_SECRET_KEY;
			if (secretKey === undefined) return null;
			// `null` where the deployment holds no signing secret, never an empty string standing in
			// for one. the adapter's own type is what carries the distinction: an empty string is a
			// secret that verifies nothing and reports a signature mismatch, which sends an operator
			// to check a value against the endpoint it was minted for instead of telling them there
			// is none.
			return createStripeProvider({
				secretKey,
				webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null
			});
		}
	},
	paypal: {
		requires: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
		build: (env) => {
			const clientId = env.PAYPAL_CLIENT_ID;
			const clientSecret = env.PAYPAL_CLIENT_SECRET;
			if (clientId === undefined || clientSecret === undefined) return null;
			// `null` where the deployment holds no listener id, never an empty string standing in for
			// one — the same distinction Stripe's entry above draws, and the adapter's own type is
			// what carries it. an empty string would verify nothing and come back as a delivery PayPal
			// did not vouch for, sending an operator to compare an id they do not have against a
			// listener that is fine. `PAYPAL_API_URL` is off the list for `CHARIOT_API_URL`'s reason
			// below: unset is an answer.
			return createPaypalProvider({
				clientId,
				clientSecret,
				apiUrl: env.PAYPAL_API_URL ?? PAYPAL_DEFAULT_API_URL,
				webhookId: env.PAYPAL_WEBHOOK_ID ?? null
			});
		},
		unusable: (env) =>
			env.PAYPAL_API_URL === undefined || paypalApiOrigin(env.PAYPAL_API_URL) !== null
				? null
				: { variable: 'PAYPAL_API_URL', clause: unusablePaypalAddress(env.PAYPAL_API_URL) },
		// null for a host with no `api-m.` label: the entry then names no script and the donor's page
		// loads `PAYPAL_CORE_URL` (packages/form/src/embed/paypal.ts), which refuses keys issued at
		// any other address.
		sdkUrl: (env) => paypalSdkUrl(env.PAYPAL_API_URL ?? PAYPAL_DEFAULT_API_URL)
	},
	chariot: {
		requires: ['CHARIOT_API_KEY'],
		build: (env) => {
			const apiKey = env.CHARIOT_API_KEY;
			if (apiKey === undefined) return null;
			// `CHARIOT_API_URL` is off the list because unset is an answer — the live address — and
			// `CHARIOT_WEBHOOK_SECRET` for Stripe's signing secret's reason above: `verifyEvent` in
			// ./chariot.ts is the one arm that reads it.
			return createChariotProvider({
				apiKey,
				apiUrl: env.CHARIOT_API_URL ?? CHARIOT_LIVE_API_URL,
				webhookSecret: env.CHARIOT_WEBHOOK_SECRET ?? null
			});
		}
	},
	nowpayments: {
		// the payout coin is a credential here in all but name: every coin's minimum is asked against
		// it and no call reads it off the account (`NowpaymentsCredentials.outcomeCurrency` in
		// ./nowpayments.ts), so a deployment without it can price no gift.
		requires: ['NOWPAYMENTS_API_KEY', 'NOWPAYMENTS_OUTCOME_CURRENCY'],
		build: (env) => {
			const apiKey = env.NOWPAYMENTS_API_KEY;
			const outcomeCurrency = env.NOWPAYMENTS_OUTCOME_CURRENCY;
			if (apiKey === undefined || outcomeCurrency === undefined) return null;
			// `NOWPAYMENTS_IPN_SECRET` for Stripe's signing secret's reason above: the IPN arm is its
			// one reader.
			return createNowpaymentsProvider({
				apiKey,
				outcomeCurrency,
				ipnSecret: env.NOWPAYMENTS_IPN_SECRET ?? null
			});
		}
	}
});

/**
 * why a read this deployment made against its Stripe account could not be made, for an operator
 * screen to carry beside the sentence.
 *
 * here rather than in the route that answers with it, because the fact it states is this
 * module's: `no_key` has to mean exactly the deployment {@link Processors.for} refuses for want of
 * Stripe's entry in {@link PROCESSORS}, read through the same `readConfigEnv`. computed in a
 * route, it would be a second opinion about which deployments can call Stripe at all, and the day
 * this module required a second value the two would part company with nothing failing.
 *
 * a key that is a publishable one is `failed` and not `no_key`, which is the right side for it: the
 * value is set, and a screen saying nothing there would leave the operator no way to tell.
 *
 * Stripe's alone. `STRIPE_UNREADABLE_REASONS` in `packages/operator/src/console/stripe-read.ts` is
 * the union it answers in and its members are worded for that account.
 *
 * `source` is the raw platform env, the same entry point {@link createPaymentProviders} takes.
 */
export function stripeUnreadableReason(source: unknown): StripeUnreadableReason {
	return configuredFor(readConfigEnv(source), 'stripe') ? 'failed' : 'no_key';
}

/**
 * the variables this deployment cannot call one processor without, whatever it currently holds.
 *
 * the list {@link Processors.unset} filters, exported for the one caller that has no env to filter
 * it against: ./processors.testing.ts hands a spec a set built over a port rather than over a
 * deployment, and a list spelled there would be variable names a case asserts on that no deployment
 * reads.
 */
export function requiredCredentials(name: ProcessorName): readonly (keyof ConfigEnv)[] {
	return PROCESSORS[name].requires;
}

/**
 * the public key each processor's browser SDK is started with, or null for a processor with no
 * browser half.
 *
 * one variable per processor and separate from {@link PROCESSORS}'s `requires`, because the two
 * halves are short in different ways and fix differently. a deployment holding the server half and
 * not this one can charge and cannot serve a form — the Payments screen reports it, and
 * `publishedConfig` in ../forms/published-config.ts refuses over it — while one holding this and
 * not the server half serves a form that fails at the last step.
 *
 * PayPal's is its client id, which is on its `requires` as well: the pair authenticates a server
 * call and the id alone starts the SDK, so the one variable is short in both ways at once.
 *
 * NOWPayments' is null: a crypto gift is an address the donor pays from their own wallet, and no
 * script is started on the donor's page. null means no browser half is owed, so it is never named
 * as short, and never an entry in `ServedProcessors.providers` — `Provider.publishableKey` in
 * packages/form/src/v1.ts is what an adapter on the donor's page starts an SDK with.
 */
const BROWSER_VARS: Readonly<Record<ProcessorName, keyof ConfigEnv | null>> = Object.freeze({
	stripe: 'STRIPE_PUBLISHABLE_KEY',
	paypal: 'PAYPAL_CLIENT_ID',
	chariot: 'CHARIOT_CONNECT_ID',
	nowpayments: null
});

/** which processors a donation form may be served on here, and what to say where there are none. */
export type ServedProcessors = {
	/**
	 * one entry per processor this deployment can charge on, start an SDK for, and settle a gift
	 * through, in `PROCESSOR_NAMES` order.
	 *
	 * settlement is the notice variable as well as the two halves (`settlementReady`). a processor
	 * whose charge keys are set and whose notice variable is not is not named here: a donor would
	 * be charged and the gift would stay pending.
	 *
	 * `Provider` in packages/form/src/v1.ts is a set on the wire, so a deployment holding a second
	 * processor names it beside the first rather than replacing it, and each adapter on the donor's
	 * page takes its own entry by name.
	 */
	readonly providers: readonly Provider[];
	/**
	 * every processor whose credentials are set, browser half or not, in `PROCESSOR_NAMES` order —
	 * what a refusal names as the accounts it read.
	 */
	readonly configured: readonly ProcessorName[];
	/**
	 * whether any processor can settle a gift on a form served here.
	 *
	 * an entry in `providers`, or a processor with no browser half that is settlement-ready. the
	 * answer a refusal turns on, rather than `providers` being empty. a processor with no browser
	 * half is never in `providers` (see {@link BROWSER_VARS}), so read off that list a deployment
	 * holding NOWPayments' values and its IPN secret would be refused and told to set what it
	 * already holds. keys without the notice variable are not enough: the gift would be charged
	 * and never marked paid.
	 */
	readonly serves: boolean;
	/**
	 * what is short, for the refusal a caller states where `serves` is false.
	 *
	 * read on that arm alone. it names the variables whose setting would change the answer and says
	 * of any processor whose credentials are set that this release reads them from nothing — which
	 * is the sentence an operator whose PayPal boxes are full has to be given instead of one naming
	 * a Stripe variable they have never seen.
	 */
	readonly shortfall: string;
	/**
	 * where those values come from and what sets them, for the same refusal's `fix`.
	 *
	 * the companion to `shortfall` above and read on the same arm. it is the half that can send an
	 * operator to a dashboard they hold no account on, so it names whichever processors this
	 * deployment has evidently started on — see {@link startedOn}.
	 */
	readonly fix: string;
};

/**
 * which processors a donation form served by this deployment may be paid on.
 *
 * here rather than in the reader that serves the config, for the reason {@link
 * stripeUnreadableReason} is here: what counts as a processor this deployment can charge on is this
 * module's fact, and a second reading of the same variables somewhere else is the one that parts
 * company the day a processor's list changes.
 */
export function servedProcessors(source: unknown): ServedProcessors {
	const env = read(source);
	if (env === null) {
		return {
			providers: [],
			configured: [],
			serves: false,
			shortfall: 'this deployment’s configuration could not be read',
			fix: processorSetupFix(PROCESSOR_NAMES)
		};
	}

	const providers = PROCESSOR_NAMES.flatMap((name) => {
		const browserVar = BROWSER_VARS[name];
		if (browserVar === null) return [];
		const publishableKey = env[browserVar];
		if (publishableKey === undefined) return [];
		if (!settlementReady(env, name)) return [];
		const sdkUrl = PROCESSORS[name].sdkUrl?.(env) ?? null;
		return [sdkUrl === null ? { name, publishableKey } : { name, publishableKey, sdkUrl }];
	});

	const configured = PROCESSOR_NAMES.filter((name) => configuredFor(env, name));
	const serves = PROCESSOR_NAMES.some((name) => settlementReady(env, name));
	return {
		providers,
		configured,
		serves,
		shortfall: shortfall(env),
		fix: processorSetupFix(startedOn(env))
	};
}

/**
 * the processors this deployment has evidently started on: those with at least one of their own
 * variables set, and every one of them where none has been.
 *
 * an operator who filled one of PayPal's two boxes is setting PayPal up whatever else is unset, and
 * a fix naming Stripe's dashboard sends them somewhere they hold no account. a fresh fork holds
 * nothing at all, and there is no choice to read off it — so both are named and the sentence says
 * either is enough, rather than picking for them.
 */
function startedOn(env: ConfigEnv): readonly ProcessorName[] {
	const started = PROCESSOR_NAMES.filter((name) =>
		setupVars(name).some((variable) => env[variable])
	);
	return started.length === 0 ? PROCESSOR_NAMES : started;
}

/**
 * every variable a processor cannot serve a form without: its credentials, the half the browser
 * is handed, and the notice variable (`noticeVariable` in ./webhook-secret.ts).
 *
 * deduplicated, because PayPal's client id is both a credential and the browser half — the pair
 * authenticates a server call and the id alone starts the SDK, so naming it twice would be one
 * variable an operator is asked to set two ways. the notice name is not restated here: that
 * function is the one table.
 */
function setupVars(name: ProcessorName): readonly (keyof ConfigEnv)[] {
	const browserVar = BROWSER_VARS[name];
	const vars =
		browserVar === null
			? [...PROCESSORS[name].requires, noticeVariable(name)]
			: [...PROCESSORS[name].requires, browserVar, noticeVariable(name)];
	return [...new Set(vars)];
}

/**
 * whether this processor can settle a gift on a form served here.
 *
 * the charge credentials `configuredFor` already requires, the browser half {@link BROWSER_VARS}
 * already requires (none, where it is null), and the notice variable set. `PROCESSORS.requires`
 * stays the charge credentials alone: `scripts/setup-webhook.ts` registers the endpoint that mints
 * Stripe's signing secret, and a builder that refused without it could never be asked to.
 */
function settlementReady(env: ConfigEnv, name: ProcessorName): boolean {
	if (!configuredFor(env, name)) return false;
	const browserVar = BROWSER_VARS[name];
	if (browserVar !== null && env[browserVar] === undefined) return false;
	return env[noticeVariable(name)] !== undefined;
}

/**
 * where each processor's values come from and what sets them, as one sentence per processor.
 *
 * stated here rather than at the refusals, because the two that read it are a served config that
 * cannot be assembled and a quote whose processor refused — and a sentence written twice is one
 * that names the dashboard a variable moved away from.
 *
 * the charge keys of one processor come off one screen, and saying so is the part an operator
 * acts on: a secret key beside a publishable key from a different account is valid on both halves
 * and refused at the first charge. the notice value is named in the same sentence.
 * `settlementReady` withholds a form until it is set (DEPLOY.md, "All three or none"), so the
 * charge-key pair on its own does not finish the job.
 */
const SETUP_FIXES: Readonly<Record<ProcessorName, string>> = Object.freeze({
	stripe:
		'In the org’s own Stripe dashboard, take the secret key and the publishable key from the ' +
		`same screen, add \`${envLine('STRIPE_SECRET_KEY')}\` and ` +
		`\`${envLine('STRIPE_PUBLISHABLE_KEY')}\` to \`.env\`, run ` +
		`\`${setupWebhookCommand('stripe')}\`, add the \`STRIPE_WEBHOOK_SECRET\` line it prints, ` +
		`then recreate the app: \`${RECREATE_APP}\`.`,
	paypal:
		'In the org’s own PayPal developer dashboard, take the client id and the secret from the ' +
		`same app, add \`${envLine('PAYPAL_CLIENT_ID')}\` and ` +
		`\`${envLine('PAYPAL_CLIENT_SECRET')}\` to \`.env\`, run ` +
		`\`${setupWebhookCommand('paypal')}\`, add the \`PAYPAL_WEBHOOK_ID\` line it prints, ` +
		`then recreate the app: \`${RECREATE_APP}\`.`,
	// the key alone leaves no Connect, no event subscription and no signing secret behind it, so the
	// fix runs the script that makes all three.
	chariot:
		'Chariot issues the org’s API key by email. Add ' +
		`\`${envLine('CHARIOT_API_KEY')}\` to \`.env\`, check the EIN and the notification address in Settings, run ` +
		`\`${setupWebhookCommand('chariot')}\`, add the two lines it prints to \`.env\`, then recreate ` +
		`the app: \`${RECREATE_APP}\`.`,
	nowpayments:
		'In the org’s own NOWPayments dashboard, take the API key, and the code of the coin set as ' +
		'the payout wallet under Payment Settings (such as `usdttrc20`). Generate ' +
		'`NOWPAYMENTS_IPN_SECRET` once under Payment Settings in the NOWPayments dashboard, then add ' +
		`\`${envLine('NOWPAYMENTS_API_KEY')}\`, \`${envLine('NOWPAYMENTS_OUTCOME_CURRENCY')}\`, and ` +
		`\`${envLine('NOWPAYMENTS_IPN_SECRET')}\` to \`.env\`, then recreate the app: \`${RECREATE_APP}\`.`
});

/**
 * the sentence naming where these processors are set up from.
 *
 * more than one is prefaced rather than merely concatenated: two sets of instructions with nothing
 * between them read as several things to do, and any one set on its own is what actually finishes
 * the job.
 */
export function processorSetupFix(names: readonly ProcessorName[]): string {
	const fixes = names.map((name) => SETUP_FIXES[name]);
	return fixes.length > 1
		? `Any one processor is enough on its own. ${fixes.join(' ')}`
		: fixes.join(' ');
}

function shortfall(env: ConfigEnv): string {
	const lines = PROCESSOR_NAMES.map((name) => {
		const unset = setupVars(name).filter((variable) => !env[variable]);
		if (unset.length > 0) {
			return `\`${unset.join('` and `')}\` ${unset.length === 1 ? 'is' : 'are'} not set`;
		}
		return PROCESSORS[name].unusable?.(env)?.clause ?? null;
	}).filter((line) => line !== null);

	return lines.join(', and ');
}

/**
 * the processors this deployment can take a payment through, and the two ways to reach one.
 *
 * a value rather than one provider built from the env, because four questions have to be answered
 * from one place, and a caller answering any of them itself is how two of them come to disagree:
 * which processors this deployment can charge on, which one owns the rail a donor picked, what a
 * processor that cannot answer says, and which variables one it cannot call is short of.
 *
 * it is request-scoped like the provider it hands back — built from the env the request arrived on,
 * never a module-scope singleton (CLAUDE.md) — so a member of it may cache within one value and
 * never across one.
 */
export type Processors = {
	/**
	 * the processors this deployment can take a payment through, in `PROCESSOR_NAMES` order.
	 *
	 * credentials set *and* an adapter in this release, which is stricter than "the operator filled
	 * the boxes in" and is stricter on purpose: this is the list every union over processors is
	 * taken across, and a processor on it that cannot answer is `offeredRails` in
	 * ../forms/offered-rails.ts widening that processor's rails onto a deployment where nothing can
	 * mint them — a donor shown a way to pay that refuses at the last step.
	 *
	 * empty is a real deployment and not an edge: a fresh fork holds no processor variable at all
	 * and still has to serve /admin.
	 */
	readonly configured: readonly ProcessorName[];
	/**
	 * the adapter for one processor, sealed.
	 *
	 * never null: a processor this deployment cannot charge on gets a refusing provider whose
	 * sentence says which of the two it is short of, so a caller's error handling is
	 * `if (!result.ok)` and nothing else.
	 */
	for(name: ProcessorName): PaymentProvider;
	/**
	 * the adapter that settles this rail, through `processorOf` at the port.
	 *
	 * the one way a rail a donor picked selects an adapter. a caller choosing by hand is a caller
	 * holding a second copy of that table.
	 */
	forRail(rail: QuotedRail): PaymentProvider;
	/**
	 * the variables this deployment would have to set before it could call this processor at all, in
	 * {@link PROCESSORS}' own order and empty for one it can already call.
	 *
	 * the complement of `configured` above and the answer to the question that follows it: a refusal
	 * for a processor this deployment holds no keys for needs to say which values are missing, and
	 * which variables a processor cannot be called without is this module's fact. derived anywhere
	 * else it would be a second copy that stops matching the day a processor needs another one.
	 *
	 * a value held in a shape no call can be made with is on it too, after the empty ones: it is a
	 * line the operator has to write again. why it was refused is `shortfall`'s and the refusal's
	 * sentence.
	 *
	 * names only, and there is nothing else it could be: a value never leaves this module.
	 */
	unset(name: ProcessorName): readonly (keyof ConfigEnv)[];
};

/**
 * what this deployment's configuration resolves to.
 *
 * `source` is the raw platform env, narrowed by `readConfigEnv` — the same entry point every other
 * reader of the deploy-time values takes, so a blank value, a whitespace-only value and a binding
 * all mean "absent" here exactly as they do everywhere else.
 *
 * every path returns a provider; none throws and none returns null.
 *
 * and every path is `sealed`, including the one where building fails. the argument-evaluation order
 * is what makes that worth writing carefully: `sealed(build(...))` evaluates `build` before the seal
 * exists, so a throw inside it would reach the caller — and one of those callers is a webhook route,
 * where an exception is a 500 and a 500 is a delivery the processor brings back for three days.
 *
 * the env is read once per value rather than once per `for`, and that is the whole of the caching:
 * a `Processors` is already scoped to one request, and the adapters themselves are built on demand
 * because a page view that takes no donation should construct no client.
 */
export function createPaymentProviders(source: unknown): Processors {
	const env = read(source);
	// one adapter per processor for the set's life, so what an adapter keeps for the request it was
	// built on is shared by every caller in that request (`accountSelection` in ./nowpayments.ts).
	const built = new Map<ProcessorName, PaymentProvider>();
	const adapter = (name: ProcessorName): PaymentProvider => {
		const kept = built.get(name);
		if (kept !== undefined) return kept;
		const made = provider(env, name);
		built.set(name, made);
		return made;
	};
	return {
		configured: env === null ? [] : PROCESSOR_NAMES.filter((name) => configuredFor(env, name)),
		for: adapter,
		forRail: (rail) => adapter(processorOf(rail)),
		// a configuration that could not be read is every variable unset rather than none: the answer a
		// caller acts on is "this cannot be called", and an empty list there would read as a processor
		// that is ready.
		unset: (name) => {
			const empty = PROCESSORS[name].requires.filter((variable) => env === null || !env[variable]);
			const refused = env === null ? null : (PROCESSORS[name].unusable?.(env) ?? null);
			return refused === null ? empty : [...empty, refused.variable];
		}
	};
}

/**
 * the deploy-time values, or `null` where reading them threw.
 *
 * the platform env is somebody else's object and a getter on it may do anything, so the read is
 * inside the guard rather than in front of it: a throw here would reach the caller, and one of
 * those callers is a webhook route where an exception is a 500 and a 500 is a delivery the
 * processor brings back for three days.
 */
function read(source: unknown): ConfigEnv | null {
	try {
		return readConfigEnv(source);
	} catch (error) {
		logFactoryFault(error);
		return null;
	}
}

/** whether every variable this processor cannot be called without is set, in a shape it can use. */
function configuredFor(env: ConfigEnv, name: ProcessorName): boolean {
	const { requires, unusable } = PROCESSORS[name];
	return requires.every((variable) => env[variable]) && (unusable?.(env) ?? null) === null;
}

function provider(env: ConfigEnv | null, name: ProcessorName): PaymentProvider {
	if (env === null) return unbuildable(name);
	try {
		return sealed(build(env, name));
	} catch (error) {
		logFactoryFault(error);
		return unbuildable(name);
	}
}

/** what a processor answers where this app could not build it a provider at all. */
function unbuildable(name: ProcessorName): PaymentProvider {
	return refusing(
		name,
		'internal_error',
		'The payment provider could not be built at all, which is not a state this app is ' +
			'supposed to be able to reach. Nothing about the deployment fixes it. It is a bug in ' +
			`this app. No payment was taken. ${LOGS_SAY_WHY}`
	);
}

function build(env: ConfigEnv, name: ProcessorName): PaymentProvider {
	const { requires, build: adapter, unusable } = PROCESSORS[name];
	const refused = unusable?.(env) ?? null;
	if (refused !== null) {
		return refusing(
			name,
			'not_configured',
			`This deployment cannot take a payment through ${PROCESSOR_LABELS[name]}: ${refused.clause}. ` +
				'Correct it in `.env`, then recreate the app.'
		);
	}
	const built = adapter(env);
	if (built !== null) return built;

	// the variables this call cannot be made without, and nothing about the rest of the setup: what
	// a deployment is short of beyond these is the Payments screen's to report.
	const unset = requires.filter((variable) => !env[variable]);
	const one = unset.length === 1;
	return refusing(
		name,
		'not_configured',
		`This deployment cannot take a payment through ${PROCESSOR_LABELS[name]}: ` +
			`\`${unset.join('` and `')}\` ${one ? 'is' : 'are'} not set. Add ` +
			`${unset.map((variable) => `\`${envLine(variable)}\``).join(' and ')} to \`.env\`, then ` +
			'recreate the app.'
	);
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
