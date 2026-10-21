import type { SetupJobId, SetupJobState } from '@better-giving/operator/setup-folds';
import { FOLD_LABELS, JOB_NOTES, JOB_WORDS, SETUP_JOBS } from '@better-giving/operator/setup-folds';
import { identityMissing } from '../org/identity';
import type { OrgProfile } from '../db/schema';
import type { ProcessorName } from '../payments/provider';
import type { ConfigEnv } from './env';
import { MAIL_SMTP_VARS } from './env';

// how far this deployment's own set-up has got, as a reading and never as a control.
//
// **it reports and repairs nothing.** every one of the five is settled where its value lives — a
// row on Settings, or a line in `.env` — and this says which of them are done, in the fold labels
// `@better-giving/operator/setup-folds` spells.
//
// **the jobs are `SETUP_JOBS`'s and the words are `@better-giving/operator/setup-folds`'s, and none
// of either is spelled here.** a deployment calling the same job two things is a reader working out
// whether they are two jobs or one.
//
// **the site list is no job here.** this deployment takes gifts on the donation page it serves at
// `/donate` on its own address whether or not an organisation has a website of its own, so a line
// waiting on a typed site would call a deployment that is taking gifts unfinished. an operator who
// does have a website lists it under Donation forms; nothing on this side reads it.
//
// **every fact is read on this deployment, from the values it was started with and its own rows.**
// nothing here reaches Stripe, dials a mail host or asks any third party anything: a page that made
// five network calls to say five words would take seconds to draw and would report a third party's bad
// afternoon as this deployment's fault. so what it answers is whether a job has been set up, which
// is what an operator can act on, and never whether the third party behind it is up right now.
//
// **presence, and nothing past it.** a value that is set but wrong — a live Stripe key where a test
// one was meant, a mail password since rotated — reads as configured here, because the only way to
// tell is to spend the call this module refuses to make. what that costs is said on the screen
// rather than hidden: a line says the job is set up, never that it works.

/** one job's whole line: what it is called, how it stands, and what is still waiting on it. */
export type SetupLine = {
	readonly id: SetupJobId;
	readonly label: string;
	readonly state: SetupJobState;
	/** the state as a word, which is `Configured` or `Incomplete` on both operator surfaces. */
	readonly word: string;
	/** the one thing the label cannot say for itself, and `null` wherever it can. */
	readonly note: string | null;
};

/**
 * everything the five are read off, gathered by the caller.
 *
 * handed in rather than read here, so the whole of this module is looked at in ./readiness.spec.ts
 * with no database and no platform env — the arrangement every pure reader in this app is under.
 */
export type SetupFacts = {
	/**
	 * whether this deployment holds a dashboard password it will authenticate against.
	 *
	 * usability rather than presence, and it is the one job read past presence: what the paragraph
	 * above refuses is spending a network call, and this costs none — the rule is
	 * `@better-giving/operator/admin-password`'s and the reading is local. a value the sign-in path
	 * refuses is an unfinished job, because a line calling it done reports a password box that can
	 * never succeed as set up.
	 */
	readonly password: boolean;
	readonly profile: OrgProfile | null;
	readonly config: ConfigEnv;
};

/**
 * whether every value one job cannot work without is set.
 *
 * `readConfigEnv` in ./env.ts has already dropped a blank and trimmed the rest, so presence here is
 * presence of something an operator actually typed.
 */
const allSet = (config: ConfigEnv, names: readonly (keyof ConfigEnv)[]): boolean =>
	names.every((name) => config[name] !== undefined);

/**
 * the pair of keys each processor charges on, and a deployment holding either pair can take a gift.
 *
 * **no webhook value is on a pair, and that is the distinction this list is about rather than an
 * omission.** without one a settled charge is never heard about, which is what stops a recurring
 * gift being written down — but a one-off gift is still charged, and this line answers whether one
 * can be. the Payments screen is where the difference between the two is drawn and acted
 * on. `PAYPAL_CHARITY_RATE_APPROVED` is off them for a reason of its own: it picks which published
 * fee table a donor covering fees is quoted from (../payments/fees.ts), and unset is an answer
 * rather than a gap. `CHARIOT_API_URL` and `PAYPAL_API_URL` are off for the same reason: unset is
 * each processor's own default address.
 * `NOWPAYMENTS_IPN_SECRET` is off by the webhook rule, though the IPN is the only way a crypto
 * payment is ever heard to settle: the payment is still created without it. NOWPayments' second member is its outcome currency rather than a
 * browser half, which it has none of: a coin's minimum is quoted against it, so no payment can be
 * offered without it.
 *
 * a pair rather than a flat list of everything payments needs, because the four are alternatives:
 * an organisation on any one of them alone holds no key for the other three and is set up.
 */
const CHARGE_PAIRS: Readonly<Record<ProcessorName, readonly (keyof ConfigEnv)[]>> = {
	stripe: ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY'],
	paypal: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
	chariot: ['CHARIOT_API_KEY', 'CHARIOT_CONNECT_ID'],
	nowpayments: ['NOWPAYMENTS_API_KEY', 'NOWPAYMENTS_OUTCOME_CURRENCY']
};

/**
 * every processor whose charge pair is set, in `CHARGE_PAIRS`' order: the payments job here, and
 * which processors the notices line on the donation-form screens asks about (../forms/readiness.ts).
 */
export function chargingProcessors(config: ConfigEnv): ProcessorName[] {
	return (Object.keys(CHARGE_PAIRS) as ProcessorName[]).filter((processor) =>
		allSet(config, CHARGE_PAIRS[processor])
	);
}

/** whether each of the five is done, from the facts alone. */
function states(facts: SetupFacts): Record<SetupJobId, boolean> {
	const profile = facts.profile;
	return {
		password: facts.password,
		// the same list the block on the two screens that write a form is drawn from
		// (../forms/readiness.ts), so a deployment serving no form and a row reading `Incomplete`
		// are one fact stated twice rather than two readings that can disagree.
		organisation: identityMissing(profile).length === 0,
		payments: chargingProcessors(facts.config).length > 0,
		smtp: allSet(facts.config, MAIL_SMTP_VARS),
		// the column is nullable and carries a not-blank check when it is set
		// (`org_profile_notification_email_not_blank_check` in ../db/schema.ts), so a row holding
		// anything at all is holding an address.
		notifications: profile?.notificationEmail != null
	};
}

/**
 * the five lines, in the order both operator surfaces read them.
 *
 * the order is `SETUP_JOBS`'s own, which is what keeps the two surfaces listing them the same way
 * without either one restating it.
 */
export function setupReadiness(facts: SetupFacts): SetupLine[] {
	const done = states(facts);
	return SETUP_JOBS.map((id) => {
		const state: SetupJobState = done[id] ? 'ready' : 'todo';
		return {
			id,
			label: FOLD_LABELS[id],
			state,
			word: JOB_WORDS[state],
			// a done job has no sentence, and neither has an unfinished one whose label already names
			// what the job is for — which is four of the five.
			note: state === 'ready' ? null : (JOB_NOTES[id] ?? null)
		};
	});
}
