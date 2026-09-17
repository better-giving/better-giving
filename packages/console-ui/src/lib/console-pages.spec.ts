import { FOLD_LABELS, JOB_WORDS } from '@better-giving/operator/setup-folds';
import { describe, expect, it } from 'vitest';
import type { HomeSection, SectionId, SectionState } from './home-sections';
import { firstUnfinishedPage, railGroups } from './console-pages';
import { processorLinks } from './processor-links';

// the console's pages as values: where `/` sends a ready deployment, what the rail lists and marks,
// and where each address that moved now sends the browser.
//
// every input is a value, so all of it is read here with no binary and no rendered router.

const IDS: readonly SectionId[] = [
	'password',
	'organisation',
	'payments',
	'sites',
	'smtp',
	'notifications'
];

/** the six rows, every job done except the ones named. */
const rows = (...todo: readonly SectionId[]): HomeSection[] =>
	IDS.map((id) => {
		const state: SectionState | null = id === 'sites' ? null : todo.includes(id) ? 'todo' : 'ready';
		return {
			id,
			state,
			label: FOLD_LABELS[id],
			tone: state === 'todo' ? 'attention' : state === null ? 'note' : 'done',
			word: state === null ? null : JOB_WORDS[state],
			note: null
		};
	});

describe('the page `/` opens on', () => {
	it('is the password page when nothing is unfinished', () => {
		expect(firstUnfinishedPage(rows())).toBe('/password');
	});

	it('is the first unfinished page in rail order', () => {
		expect(firstUnfinishedPage(rows('smtp', 'organisation'))).toBe('/organisation');
		expect(firstUnfinishedPage(rows('notifications', 'smtp'))).toBe('/smtp');
		expect(firstUnfinishedPage(rows('notifications'))).toBe('/notifications');
	});

	it('is Stripe when no processor is set up, since either one takes a gift', () => {
		expect(firstUnfinishedPage(rows('payments', 'smtp'))).toBe('/payments/stripe');
	});

	it('is the password page when that is unfinished, ahead of every job', () => {
		expect(firstUnfinishedPage(rows('payments', 'password'))).toBe('/password');
	});
});

const LOGOS = {
	stripe: '/stripe.png',
	paypal: '/paypal.png',
	chariot: '/chariot.png',
	nowpayments: '/nowpayments.png'
};

/** every cell of the rail, flat, as `label → href`. */
const cells = (groups: ReturnType<typeof railGroups>) =>
	groups.flatMap((group) => group.destinations.map((d) => `${d.label} → ${d.href}`));

describe('the rail', () => {
	it('lists every page in set-up order, the processors under their own heading', () => {
		const groups = railGroups(rows(), processorLinks(new Set()), LOGOS);
		expect(cells(groups)).toEqual([
			'Dashboard password → /password',
			'Organisation → /organisation',
			'Stripe → /payments/stripe',
			'PayPal → /payments/paypal',
			'Chariot → /payments/chariot',
			'NOWPayments → /payments/nowpayments',
			'Sites → /sites',
			'SMTP → /smtp',
			'Notifications → /notifications'
		]);
		expect(groups.map((group) => group.heading)).toEqual([
			undefined,
			'Donation processor',
			undefined
		]);
	});

	it('marks each processor by whether its own pair is held, not by the payments job', () => {
		const held = new Set(['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']);
		const [, processors] = railGroups(rows(), processorLinks(held), LOGOS);
		expect(processors?.destinations.map((d) => d.status)).toEqual([
			{ tone: 'attention', mark: 'circle-dashed', label: 'Not set up' },
			{ tone: 'done', mark: 'check', label: 'Configured' },
			{ tone: 'attention', mark: 'circle-dashed', label: 'Not set up' },
			{ tone: 'attention', mark: 'circle-dashed', label: 'Not set up' }
		]);
		expect(processors?.destinations.map((d) => d.mark)).toEqual([
			{ src: '/stripe.png' },
			{ src: '/paypal.png' },
			{ src: '/chariot.png' },
			{ src: '/nowpayments.png' }
		]);
	});

	it('marks a job by its row: a tick when done, an outline when not', () => {
		const [first] = railGroups(rows('organisation'), processorLinks(new Set()), LOGOS);
		expect(first?.destinations.map((d) => d.status)).toEqual([
			{ tone: 'done', mark: 'check', label: 'Configured' },
			{ tone: 'attention', mark: 'circle-dashed', label: 'Incomplete' }
		]);
	});

	it('marks the sites cell in the note ink, and not at all where its row carries no word', () => {
		const sites = (word: string | null) =>
			railGroups(
				rows().map((row) =>
					row.id === 'sites' ? { ...row, word, mark: 'circle-dashed' as const } : row
				),
				processorLinks(new Set()),
				LOGOS
			)[2]?.destinations[0]?.status;
		expect(sites('2 listed')).toEqual({ tone: 'note', mark: 'circle-dashed', label: '2 listed' });
		expect(sites(null)).toBeUndefined();
	});
});

/** where a moved address's loader sends the browser, read off the redirect it throws. */
async function sentTo(clientLoader: () => unknown): Promise<string | null> {
	try {
		await clientLoader();
	} catch (thrown) {
		if (thrown instanceof Response) return `${thrown.status} ${thrown.headers.get('Location')}`;
		throw thrown;
	}
	return null;
}

describe('an address that moved', () => {
	it('sends /configuration to the password page, the first value it held', async () => {
		const { clientLoader } = await import('../routes/configuration');
		expect(await sentTo(clientLoader)).toBe('307 /password');
	});

	it('sends /payments to Stripe’s page', async () => {
		const { clientLoader } = await import('../routes/payments');
		expect(await sentTo(clientLoader)).toBe('307 /payments/stripe');
	});

	it('sends /receipts to the mail page', async () => {
		const { clientLoader } = await import('../routes/receipts');
		expect(await sentTo(clientLoader)).toBe('307 /smtp');
	});
});
