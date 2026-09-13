import { JOB_NOTES, SETUP_JOBS } from '@better-giving/operator/setup-folds';
import { describe, expect, it } from 'vitest';
import type { DeployedVar, HomeReading } from '../api/types';
import type { SectionId, SectionState } from './home-sections';
import { heldNames, readSections } from './home-sections';

// what the six folds say, off the reading the binary answered with.
//
// which face is on screen is the binary's and is asserted there
// (`packages/console/internal/deployment`); every word a row carries is this side's, so all of it
// is looked at here without a cloudflare account, a network or a deployment.

const ADDRESS = 'https://better-giving.example.workers.dev';

const VARS: DeployedVar[] = [
	{ name: 'BETTER_AUTH_URL', kind: 'value', value: ADDRESS },
	{ name: 'STRIPE_PUBLISHABLE_KEY', kind: 'value', value: 'pk_live_x' },
	{ name: 'TURNSTILE_SITE_KEY', kind: 'value', value: '0x4' },
	{ name: 'ADMIN_PASSWORD', kind: 'value', value: 'twelve chars' },
	{ name: 'BETTER_AUTH_SECRET', kind: 'value', value: 'signing' },
	{ name: 'SMTP_HOST', kind: 'value', value: 'smtp.example.org' },
	{ name: 'SMTP_PORT', kind: 'value', value: '465' },
	{ name: 'SMTP_USERNAME', kind: 'value', value: 'postmaster' },
	{ name: 'SMTP_PASSWORD', kind: 'value', value: 're_key' },
	{ name: 'MAIL_FROM', kind: 'value', value: 'a@b.org' },
	{ name: 'TURNSTILE_SECRET_KEY', kind: 'value', value: '0x4secret' },
	{ name: 'STRIPE_SECRET_KEY', kind: 'value', value: 'sk_live_x' },
	{ name: 'STRIPE_WEBHOOK_SECRET', kind: 'value', value: 'whsec_x' }
];

const ORG = {
	legal_name: 'Example Org',
	tax_id: '12-3456789',
	address_line1: '1 High Street',
	city: 'Leeds',
	country: 'United Kingdom',
	notification_email: 'gifts@example.org'
};

/** a deployment with every value set, one site listed and a whole organisation stored. */
const reading = (over: Partial<HomeReading> = {}): HomeReading => ({
	face: { kind: 'ready', address: ADDRESS },
	values: { vars: { kind: 'read', vars: VARS } },
	sites: ['https://give.example.org'],
	// where the deployment answers, which is where it serves its donation page: the same address the
	// face carries, never a second one.
	donatePage: ADDRESS,
	org: ORG,
	// the rows read this not at all: what it gates is whether the deployment is asked about its
	// Stripe account, which is the page's question and not a fold's.
	holdsStripeKey: true,
	...over
});

/** the same reading with some of the seventeen unset. */
const without = (...names: readonly string[]): HomeReading =>
	reading({
		values: {
			vars: {
				kind: 'read',
				vars: VARS.map((row) =>
					names.includes(row.name) ? { name: row.name, kind: 'absent' } : row
				)
			}
		}
	});

/** the Stripe values the fixture above holds, which a deployment on PayPal alone holds none of. */
const STRIPE_VALUES = [
	'STRIPE_SECRET_KEY',
	'STRIPE_PUBLISHABLE_KEY',
	'STRIPE_WEBHOOK_SECRET'
] as const;

/** the same reading with PayPal's own set stored and Stripe's gone, less whatever is named. */
const onPaypalAlone = (...short: readonly string[]): HomeReading => {
	const paypal: DeployedVar[] = [
		{ name: 'PAYPAL_CLIENT_ID', kind: 'value', value: 'A21aa' },
		{ name: 'PAYPAL_CLIENT_SECRET', kind: 'value', value: 'EKx7' },
		{ name: 'PAYPAL_WEBHOOK_ID', kind: 'value', value: '1TE12345' }
	];
	const read = without(...STRIPE_VALUES);
	const vars = read.values.vars;
	return {
		...read,
		values: {
			vars:
				vars.kind === 'read'
					? {
							kind: 'read',
							vars: [...vars.vars, ...paypal.filter((row) => !short.includes(row.name))]
						}
					: vars
		}
	};
};

const rowOf = (read: HomeReading, id: SectionId) =>
	readSections(read).find((section) => section.id === id);

const stateOf = (read: HomeReading, id: SectionId): SectionState | null | undefined =>
	rowOf(read, id)?.state;

const noteOf = (read: HomeReading, id: SectionId): string | null | undefined =>
	readSections(read).find((section) => section.id === id)?.note;

describe('the six folds', () => {
	// the order is the deploy's, not a preference: cloudflare holds a secret against a worker, so
	// there is nothing to store a credential on until the first deploy has landed.
	it('are drawn in the order what has to be true before the next thing can be', () => {
		expect(readSections(reading()).map((section) => section.id)).toEqual([
			'password',
			'organisation',
			'payments',
			'sites',
			'smtp',
			'notifications'
		]);
	});

	// one word for every fold that is a job and is done, and the same word wherever a reader lands: a
	// shut row is read on its own as often as it is read down the ledger. the sites row is no job and
	// reads under neither word, which is the case after this one.
	it('report ready with the word and the resolved tone', () => {
		const jobs = readSections(reading()).filter((section) =>
			(SETUP_JOBS as readonly SectionId[]).includes(section.id)
		);
		expect(jobs).toHaveLength(SETUP_JOBS.length);
		for (const section of jobs) {
			expect(section.state).toBe('ready');
			expect(section.word).toBe('Configured');
			expect(section.tone).toBe('done');
		}
	});

	// a sentence beside `Configured` reads as a job outstanding, said by the only line on the page
	// able to say otherwise.
	it('say nothing beside a fold that is done', () => {
		for (const section of readSections(reading())) expect(section.note).toBe(null);
	});

	// the fold an operator opens and edits, which the deployment waits on for nothing: an empty list
	// is a deployment giving on its own donation page, so a row saying `Incomplete` would report work
	// nobody owes.
	it('state what the site list holds rather than whether a job is done', () => {
		const empty = rowOf(reading({ sites: [], donatePage: '' }), 'sites');
		expect(empty?.state).toBe(null);
		expect(empty?.word).toBe('None listed');
		expect(empty?.tone).toBe('note');
		expect(rowOf(reading(), 'sites')?.word).toBe('1 listed');
		const two = rowOf(reading({ sites: ['https://a.example', 'https://b.example'] }), 'sites');
		expect(two?.word).toBe('2 listed');
		expect(two?.tone).toBe('note');
	});

	// the ledger has two shapes and this row wears the one that says nothing is finished, in the ink
	// that says nothing is owed. it wears it whatever is listed: the fold is a way in and there is
	// always another address to add, so a tick over a count would report a job that was never open.
	it('draw the sites row as an outline in the note ink, listed or not', () => {
		for (const read of [
			reading(),
			reading({ sites: [] }),
			reading({ sites: [], donatePage: '' })
		]) {
			const row = rowOf(read, 'sites');
			expect(row?.tone).toBe('note');
			expect(row?.mark).toBe('circle-dashed');
		}
	});

	// the shape is the one row's and no other: every job row reads the shape its own tone chooses.
	it('leave the mark to the tone on every row that is a job', () => {
		for (const section of readSections(reading())) {
			if (section.id === 'sites') continue;
			expect(section.mark).toBeUndefined();
		}
	});

	// the fold is not empty over a deployment that has typed no site: the donation page it serves at
	// its own address is the list's first row, and `None listed` over that row is the row
	// contradicting the fold it is a way into. no word rather than one naming the page, which the
	// fold's own first row already does.
	it('carry no word where nothing but the donation page is listed', () => {
		expect(rowOf(reading({ sites: [] }), 'sites')?.word).toBe(null);
	});

	// the count is the operator's own list and the donation page is not one of it: the fold draws
	// that page whether or not anything is typed, so counting it would report the deployment as
	// holding one site more than it holds.
	it('count the typed sites and never the donation page', () => {
		expect(rowOf(reading(), 'sites')?.word).toBe('1 listed');
		expect(rowOf(reading({ donatePage: '' }), 'sites')?.word).toBe('1 listed');
	});

	// the fold is drawn wherever it was drawn before, and a stored list changes nothing about that:
	// the page it is a way into is the same page.
	it('draw the sites fold whether or not anything is listed', () => {
		for (const read of [reading(), reading({ sites: [] })]) {
			expect(readSections(read).map((section) => section.id)).toEqual([
				'password',
				'organisation',
				'payments',
				'sites',
				'smtp',
				'notifications'
			]);
		}
	});

	it('read a blank identity box in the profile as not done', () => {
		expect(stateOf(reading({ org: null }), 'organisation')).toBe('todo');
	});

	// the label names what the job is, so `Incomplete` beside it is the whole of the row: a sentence
	// saying the job is unfinished is that word spelled a second time.
	it('say nothing beside an unfilled organisation past the word', () => {
		expect(noteOf(reading({ org: null }), 'organisation')).toBe(null);
	});

	// a box the save takes blank is not a job left undone: plenty of countries have no state level
	// and no postcode, and a suite number is a suite number.
	it('read an identity whose optional boxes are blank as done', () => {
		const { notification_email: _, ...identity } = ORG;
		expect(stateOf(reading({ org: identity }), 'organisation')).toBe('ready');
	});

	// alerts that reach nobody are a deployment nobody is watching: a receipt that failed and a
	// payment with no gift against it are seen by a person or by no one.
	it('read a profile holding no notification address as not done', () => {
		const { notification_email: _, ...identity } = ORG;
		const read = reading({ org: identity });
		expect(stateOf(read, 'notifications')).toBe('todo');
		expect(noteOf(read, 'notifications')).toBe(JOB_NOTES.notifications);
	});

	it('read a stored notification address as done', () => {
		expect(stateOf(reading(), 'notifications')).toBe('ready');
	});

	// the profile is stored whole, so there is no press that saves an address onto a deployment
	// holding no identity — the row is unfinished, and it says what it is for rather than which
	// fold stands in front of it: the press names that fold when it is refused over its boxes.
	it('read notifications as unfinished over no identity, and name no other fold', () => {
		const read = reading({ org: null });
		expect(stateOf(read, 'notifications')).toBe('todo');
		expect(noteOf(read, 'notifications')).toBe(JOB_NOTES.notifications);
	});

	// the credential that lets anybody in at all, read under the same word as every other fold: a
	// spelling of its own would only say anything to somebody scanning all of them.
	it('read a dashboard password nobody has stored as incomplete', () => {
		const read = without('ADMIN_PASSWORD');
		expect(stateOf(read, 'password')).toBe('todo');
		const password = readSections(read).find((one) => one.id === 'password');
		expect(password?.word).toBe('Incomplete');
		expect(password?.tone).toBe('attention');
	});

	// minted on the first deploy and typed by nobody, so a row waiting on it would report this
	// console's own machinery as an operator's job.
	it('read the password as ready with the secret it mints for itself unset', () => {
		expect(stateOf(without('BETTER_AUTH_SECRET'), 'password')).toBe('ready');
	});

	it('read a missing stripe key as not done and a missing mail credential as not done', () => {
		const read = without('STRIPE_SECRET_KEY', 'SMTP_PASSWORD');
		expect(stateOf(read, 'payments')).toBe('todo');
		expect(stateOf(read, 'smtp')).toBe('todo');
		// the one label that names a protocol rather than a job, and so the one row carrying a
		// sentence: what stripe is for is on its own label, and what SMTP is for is not.
		expect(noteOf(read, 'payments')).toBe(null);
		expect(noteOf(read, 'smtp')).toBe(JOB_NOTES.smtp);
	});

	// the row waits on the pair that charges and on neither webhook value: without one a settled
	// charge is never heard about, and a one-off gift is still taken — which is what this row is
	// about (`CHARGE_PAIRS` in packages/app/src/lib/server/config/readiness.ts).
	it('read a missing publishable key as a payments fold that is not done', () => {
		expect(stateOf(without('STRIPE_PUBLISHABLE_KEY'), 'payments')).toBe('todo');
	});

	it('read the Stripe pair alone as done, with nothing stored to verify a delivery', () => {
		expect(stateOf(without('STRIPE_WEBHOOK_SECRET'), 'payments')).toBe('ready');
	});

	// the two processors are alternatives and neither is the one that counts: an organisation on
	// PayPal alone holds no Stripe key and is set up, which is the reading the deployment makes and
	// the one this row is read against.
	it('read a deployment holding PayPal\u2019s pair and no Stripe key as done', () => {
		expect(stateOf(onPaypalAlone(), 'payments')).toBe('ready');
	});

	it('read PayPal\u2019s client id without its secret as not done', () => {
		expect(stateOf(onPaypalAlone('PAYPAL_CLIENT_SECRET'), 'payments')).toBe('todo');
	});

	// the webhook id is the same kind of value the signing secret is: without it a settled charge is
	// never heard about, and a gift is still taken.
	it('read PayPal\u2019s pair as done with no webhook id stored', () => {
		expect(stateOf(onPaypalAlone('PAYPAL_WEBHOOK_ID'), 'payments')).toBe('ready');
	});

	it('read a deployment holding neither processor\u2019s pair as not done', () => {
		const read = without(...STRIPE_VALUES);
		expect(stateOf(read, 'payments')).toBe('todo');
	});

	// a name held in a form nothing can read back is a name that is set: what cannot be done with it
	// is draw it in a box, which is the one thing this reading does not need.
	it('read a value held in a form nothing can read back as set', () => {
		const read = reading({
			values: {
				vars: {
					kind: 'read',
					vars: VARS.map((row) =>
						row.name === 'STRIPE_PUBLISHABLE_KEY' ? { name: row.name, kind: 'withheld' } : row
					)
				}
			}
		});
		expect(stateOf(read, 'payments')).toBe('ready');
	});

	// the deployment defaults the port to 465 and asks for one only where a provider wants another,
	// so a fold waiting on it would report working mail as a job left undone.
	it('read mail as done over a deployment that stores no port', () => {
		expect(stateOf(without('SMTP_PORT'), 'smtp')).toBe('ready');
	});

	it('read a missing mail credential as incomplete', () => {
		expect(stateOf(without('SMTP_HOST'), 'smtp')).toBe('todo');
	});
});

describe('the names a deployment holds', () => {
	it('count a withheld value as held and an absent one as not', () => {
		const read = without('SMTP_HOST');
		const vars = read.values.vars;
		const withheld: HomeReading['values'] =
			vars.kind === 'read'
				? {
						vars: {
							kind: 'read',
							vars: vars.vars.map((row) =>
								row.name === 'STRIPE_SECRET_KEY' ? { name: row.name, kind: 'withheld' } : row
							)
						}
					}
				: read.values;
		const held = heldNames(withheld.vars);
		expect(held.has('STRIPE_SECRET_KEY')).toBe(true);
		expect(held.has('SMTP_HOST')).toBe(false);
	});

	it('hold nothing over a read that did not land', () => {
		expect(heldNames({ kind: 'unreachable', detail: '' }).size).toBe(0);
	});
});
