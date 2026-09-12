import type { SetupJobId, SetupJobState } from '@better-giving/operator/setup-folds';
import { FOLD_LABELS, JOB_NOTES, JOB_WORDS, SETUP_JOBS } from '@better-giving/operator/setup-folds';
import { identityMissing } from '../org/identity';
import type { OrgProfile } from '../db/schema';
import type { ConfigEnv } from './env';
import { MAIL_SMTP_VARS } from './env';

// how far this deployment's own set-up has got, as a reading and never as a control.
//
// **it reports and repairs nothing, and that is the whole of what makes it allowed here.** every
// one of the five is settled on the operator console, fold by fold, beside the press that finishes
// it — this says which of them are done in the console's own words and sends the reader there. a
// screen that could repair one of these would be the console built twice, and the second copy is
// the one that goes stale.
//
// **the jobs are `SETUP_JOBS`'s and the words are `@better-giving/operator/setup-folds`'s, and none
// of either is spelled here.** the operator meets these five on the console first, and a deployment
// calling the same job something else is a reader working out whether they are two jobs or one.
//
// **the site list is a fold on the console and no job here.** this deployment's forms are given on
// the donation page it serves on its own address whether or not an organisation has a website of
// its own, so a gate waiting on a typed site would hold the dashboard shut on a deployment that is
// taking gifts. the fold stays where an operator who does have a website types
// one (packages/console-ui/src/lib/home-sections.ts); nothing on this side reads it.
//
// **every fact is read on this deployment, from the values it was started with and its own rows.**
// nothing here reaches Stripe, dials a mail host or asks Cloudflare anything: a page that made five
// network calls to say five words would take seconds to draw and would report a third party's bad
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
	 * refuses is an unfinished job, because a line calling it done stands the gate aside for a
	 * password box that can never succeed.
	 *
	 * it is always true on a screen behind the sign-in, because reaching one means having typed it.
	 * the line is drawn anyway: the five are the five the console reports on, and a list that
	 * quietly holds four is a list an operator has to count.
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
 * **neither webhook value is on a pair, and that is the distinction this list is about rather than
 * an omission.** without one a settled charge is never heard about, which is what stops a recurring
 * gift being written down — but a one-off gift is still charged, and this line answers whether one
 * can be. the console's payments fold is where the difference between the two is drawn and acted
 * on. `PAYPAL_CHARITY_RATE_APPROVED` is off them for a reason of its own: it picks which published
 * fee table a donor covering fees is quoted from (../payments/fees.ts), and unset is an answer
 * rather than a gap.
 *
 * a pair rather than a flat list of everything payments needs, because the two are alternatives:
 * an organisation on PayPal alone holds no Stripe key and is set up, and the same in reverse.
 */
const CHARGE_PAIRS: readonly (readonly (keyof ConfigEnv)[])[] = [
	['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY'],
	['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']
];

/** whether each of the five is done, from the facts alone. */
function states(facts: SetupFacts): Record<SetupJobId, boolean> {
	const profile = facts.profile;
	return {
		password: facts.password,
		// the same list the block on the two screens that write a form is drawn from
		// (../forms/readiness.ts), so a deployment serving no form and a row reading `Incomplete`
		// are one fact stated twice rather than two readings that can disagree.
		organisation: identityMissing(profile).length === 0,
		payments: CHARGE_PAIRS.some((pair) => allSet(facts.config, pair)),
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

/** whether anything on the list is still outstanding, which is what a screen leads with. */
export const setupOutstanding = (lines: readonly SetupLine[]): number =>
	lines.filter((line) => line.state === 'todo').length;
