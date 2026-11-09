import type { FormConfig } from '@better-giving/form/v1';
import { defaultDonationPage } from '$lib/page/defaults';

// the loader data of a /donate page holding twelve donor messages, six of them handed, for the
// specs that press Show more through the real page: ../../routes/donate.show-more.dom.spec.tsx and
// ../../routes/preview.$pageId.show-more.dom.spec.tsx.

export const NOW = '2026-11-09T12:00:00.000Z';

/** the cursor the page's first six hand out; the specs' fetch answers the ask that carries it. */
export const CURSOR = 'cursor/after+6';

const CONFIG: FormConfig = {
	formId: 'ff000000-0000-4000-8000-000000000001',
	providers: [{ name: 'stripe', publishableKey: 'pk_test_spec' }],
	currency: 'usd',
	suggestedAmountsMinor: [1000, 2500, 5000],
	minAmountMinor: 500,
	maxAmountMinor: 500000,
	frequencies: ['one_time'],
	paymentMethods: ['card'],
	feeCoverage: 'optional',
	feeRules: {
		card: { percent: 0.029, fixedMinor: 30 },
		apple_pay: { percent: 0.029, fixedMinor: 30 },
		google_pay: { percent: 0.029, fixedMinor: 30 },
		ach: { percent: 0.008, fixedMinor: 0, capMinor: 500 },
		paypal: { percent: 0.0349, fixedMinor: 49 },
		venmo: { percent: 0.0349, fixedMinor: 49 },
		daf: { percent: 0.029, fixedMinor: 0, roundUpMinor: 100 },
		crypto: { percent: 0.01, fixedMinor: 0 }
	},
	locale: 'en-US',
	orgLegalName: 'Northside Neighbors',
	ein: '84-2913377',
	deductibilityStatement: 'Northside Neighbors is a 501(c)(3).',
	turnstileSiteKey: '1x00000000000000000000AA'
};

const FIRST_SIX = Array.from({ length: 6 }, (_, at) => ({
	name: 'Maya R.',
	note: `Newest ${at + 1}`,
	receivedAt: NOW
}));

/** `kind: 'page'` loader data, as `loadPageView` and `donateProfile` shape it. */
export const PAGE_LOADED = {
	kind: 'page',
	view: {
		config: CONFIG,
		type: 'donation_page',
		page: defaultDonationPage(),
		pageName: null,
		org: {
			name: 'Northside Neighbors',
			mission: null,
			vision: null,
			info: {
				legalName: 'Northside Neighbors',
				ein: '84-2913377',
				addressLines: ['40 Elm Street', 'Easton, PA 18042'],
				email: null,
				socialLinks: []
			}
		},
		look: { brandColour: null },
		sharing: { message: '', url: 'https://give.example.org/donate' },
		goal: null,
		money: { locale: 'en-US', currency: 'usd' }
	},
	profile: {
		name: 'Northside Neighbors',
		taxId: '84-2913377',
		banner: null,
		logo: null,
		mission: null,
		vision: null,
		raised: { raisedMinor: 0, gifts: 0 },
		money: { locale: 'en-US', currency: 'usd' },
		footer: { addressLines: [], email: null, socialLinks: [] },
		messages: { messages: FIRST_SIX, total: 12, next: CURSOR },
		videos: []
	},
	resuming: false,
	now: NOW
};

/** the six after the cursor, as the show-more read answers them: the last page. */
export const NEXT_SIX = {
	kind: 'messages',
	messages: Array.from({ length: 6 }, (_, at) => ({
		name: 'Ravi K.',
		note: `Older ${at + 1}`,
		receivedAt: NOW
	})),
	total: 12,
	next: null
} as const;
