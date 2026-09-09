import { FOLD_LABELS, JOB_NOTES, JOB_WORDS, SETUP_JOBS } from '@better-giving/operator/setup-folds';
import { describe, expect, it } from 'vitest';
import type { OrgProfile } from '../db/schema';
import type { ConfigEnv } from './env';
import type { SetupFacts } from './readiness';
import { setupOutstanding, setupReadiness } from './readiness';

// the five lines this deployment draws about its own set-up.
//
// every fact is handed in (./readiness.ts), so all of it is looked at with no database and no
// platform env — which is what makes this a pure-value spec rather than a `*.workers.spec.ts`
// against D1 (CONTRIBUTING.md → Tests).
//
// **the words are asserted through the shared record and never spelled here.** a case quoting
// `Configured` would pass while the console said something else, which is the one drift promoting
// those words to `@better-giving/operator/setup-folds` exists to close.

/** a profile with both identity fields filled in and no address to reach anyone at. */
const filledIn = {
	legalName: 'Ridgeline Trust',
	taxId: '12-3456789',
	notificationEmail: null
} as unknown as OrgProfile;

/** every value the five read set, which is the deployment nothing is outstanding on. */
const allSet: ConfigEnv = {
	STRIPE_SECRET_KEY: 'sk_live_x',
	STRIPE_PUBLISHABLE_KEY: 'pk_live_x',
	STRIPE_WEBHOOK_SECRET: 'whsec_x',
	SMTP_HOST: 'smtp.example.org',
	SMTP_USERNAME: 'apikey',
	SMTP_PASSWORD: 'secret',
	MAIL_FROM: 'giving@example.org'
};

const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({
	password: true,
	profile: { ...filledIn, notificationEmail: 'alerts@example.org' } as OrgProfile,
	config: allSet,
	...over
});

const line = (over: Partial<SetupFacts>, id: string) => {
	const found = setupReadiness(facts(over)).find((one) => one.id === id);
	if (found === undefined) throw new Error(`no line for ${id}`);
	return found;
};

describe('a deployment with all five done', () => {
	const lines = setupReadiness(facts());

	it('draws the five in the order both surfaces read them', () => {
		expect(lines.map((one) => one.id)).toEqual([...SETUP_JOBS]);
	});

	it('names each of them in the words the console uses', () => {
		expect(lines.map((one) => one.label)).toEqual(SETUP_JOBS.map((id) => FOLD_LABELS[id]));
	});

	it('has nothing outstanding and so draws no sentence on any line', () => {
		expect(setupOutstanding(lines)).toBe(0);
		expect(lines.every((one) => one.word === JOB_WORDS.ready)).toBe(true);
		expect(lines.map((one) => one.note)).toEqual([null, null, null, null, null]);
	});
});

describe('one job at a time left undone', () => {
	it('reads the dashboard password off the fact it is handed', () => {
		expect(line({ password: false }, 'password').word).toBe(JOB_WORDS.todo);
	});

	it('holds the organisation incomplete while an identity field is blank', () => {
		const blank = { ...filledIn, legalName: '' } as OrgProfile;
		expect(line({ profile: blank }, 'organisation').state).toBe('todo');
	});

	it('holds payments incomplete on either half of the pair that charges a card', () => {
		const { STRIPE_SECRET_KEY: _secret, ...noSecret } = allSet;
		const { STRIPE_PUBLISHABLE_KEY: _public, ...noPublishable } = allSet;
		expect(line({ config: noSecret }, 'payments').state).toBe('todo');
		expect(line({ config: noPublishable }, 'payments').state).toBe('todo');
	});

	it('does not hold payments on the webhook secret, which no one-off charge needs', () => {
		const { STRIPE_WEBHOOK_SECRET: _hook, ...noHook } = allSet;
		expect(line({ config: noHook }, 'payments').state).toBe('ready');
	});

	// a deployment with no website of its own gives on the donation page it serves on its own
	// address, so there is no site to wait on and nothing here reads the `site` table at all
	// (./setup-state.ts). the fold stays on the console for the operator who does have one.
	it('draws no line for the site list, which is a fold on the console and no job here', () => {
		expect(setupReadiness(facts()).map((one) => one.id)).not.toContain('sites');
	});

	it('holds mail incomplete on any one of the four it cannot send without', () => {
		for (const name of ['SMTP_HOST', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'MAIL_FROM'] as const) {
			const { [name]: _dropped, ...rest } = allSet;
			expect(line({ config: rest }, 'smtp').state).toBe('todo');
		}
	});

	it('does not hold mail on the port, which defaults rather than being asked for', () => {
		expect(line({ config: allSet }, 'smtp').state).toBe('ready');
	});

	it('holds notifications incomplete while no address is stored', () => {
		expect(line({ profile: filledIn }, 'notifications').state).toBe('todo');
	});

	it('holds every one of the five incomplete on a deployment set up for nothing', () => {
		const nothing = setupReadiness({ password: false, profile: null, config: {} });
		expect(setupOutstanding(nothing)).toBe(5);
		// a sentence is what a row adds where its label cannot say what the job is for, which is
		// `SMTP` and `Notifications` and nothing else: three rows saying `Incomplete` over a
		// sentence saying so would be the word spelled twice.
		expect(nothing.filter((one) => one.note !== null).map((one) => one.id)).toEqual([
			'smtp',
			'notifications'
		]);
		expect(nothing.find((one) => one.id === 'smtp')?.note).toBe(JOB_NOTES.smtp);
		expect(nothing.find((one) => one.id === 'notifications')?.note).toBe(JOB_NOTES.notifications);
	});
});
