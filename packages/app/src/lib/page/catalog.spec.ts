import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	FAQ_MAX,
	HEADING_MAX,
	PHOTOS_MAX,
	parsePage,
	SHARE_MESSAGE_MAX,
	TIERS_MAX
} from './catalog';

// node pool, no database: the rule is a pure function of the page type and the document.

const IMAGE = '0b8a2f9e-2c4f-4f7a-9f55-0f2d6c3a9e11';
const switches = { openOnMonthly: false, dedicationOn: false };
const blank = { type: 'doc', content: [{ type: 'paragraph' }] };
const words = (text: string) => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
});

function page(rest: Record<string, unknown> = {}) {
	return { heading: '', switches, ...rest };
}

describe('what a campaign holds', () => {
	it('accepts every content key at once', () => {
		const input = page({
			heading: 'Fill the winter pantry',
			lede: 'Help us keep 1,200 families fed.',
			story: words('Last winter, 1,214 households came through our doors.'),
			hero: { imageId: IMAGE, alt: 'Volunteers at the market' },
			photos: [{ imageId: IMAGE, alt: null }],
			tiers: [{ amountMinor: 2500, buys: 'a week of meals' }],
			faq: [{ question: 'Is it deductible?', answer: words('Yes.') }],
			shareMessage: 'I just gave. Join me?'
		});
		expect(parsePage('campaign', input)).toEqual({ ok: true, page: input });
	});

	it('accepts a campaign holding nothing yet, which draws as the card', () => {
		expect(parsePage('campaign', page())).toEqual({ ok: true, page: page() });
	});

	it('accepts sections with nothing to show, which leave themselves out at render', () => {
		const input = page({ story: blank, photos: [], tiers: [], faq: [] });
		expect(parsePage('campaign', input)).toEqual({ ok: true, page: input });
	});

	it.each(['layout', 'palette', 'look', 'blocks', 'shareChannels'])(
		'refuses %s, which a content-only page has no place for',
		(key) => {
			expect(parsePage('campaign', page({ [key]: 'box-right' }))).toMatchObject({ ok: false });
		}
	);

	it('refuses a heading over its length, naming the limit', () => {
		expect(parsePage('campaign', page({ heading: 'x'.repeat(HEADING_MAX + 1) }))).toEqual({
			ok: false,
			path: ['heading'],
			message: `a heading holds at most ${HEADING_MAX} characters`
		});
	});
});

describe('photos', () => {
	it.each(['url', 'src'])('refuses a %s on a photo', (key) => {
		expect(
			parsePage(
				'campaign',
				page({ hero: { imageId: IMAGE, alt: null, [key]: 'https://x.test/a.jpg' } })
			)
		).toMatchObject({ ok: false, path: ['hero'] });
	});

	it('refuses an image id that is an address, not an id', () => {
		expect(
			parsePage('campaign', page({ hero: { imageId: 'https://x.test/a.jpg', alt: null } }))
		).toEqual({
			ok: false,
			path: ['hero', 'imageId'],
			message: 'an image id is the id a stored photo was given on upload, never an address'
		});
	});

	it('refuses a photo beyond the cap beside the cover', () => {
		const photos = Array.from({ length: PHOTOS_MAX + 1 }, () => ({ imageId: IMAGE, alt: null }));
		expect(parsePage('campaign', page({ photos }))).toMatchObject({ ok: false, path: ['photos'] });
	});
});

describe('tiers and questions', () => {
	const tier = { amountMinor: 2500, buys: 'a week of meals' };

	it('holds a story to the rich-text rule', () => {
		expect(
			parsePage('campaign', page({ story: { type: 'doc', content: [{ type: 'heading' }] } }))
		).toMatchObject({ ok: false, path: expect.arrayContaining(['story']) });
	});

	it('refuses a tier beyond the cap', () => {
		const tiers = Array.from({ length: TIERS_MAX + 1 }, () => tier);
		expect(parsePage('campaign', page({ tiers }))).toEqual({
			ok: false,
			path: ['tiers'],
			message: `a campaign holds at most ${TIERS_MAX} impact tiers`
		});
	});

	it('refuses a tier that does not say what it buys', () => {
		expect(parsePage('campaign', page({ tiers: [{ amountMinor: 2500, buys: '' }] }))).toEqual({
			ok: false,
			path: ['tiers', 0, 'buys'],
			message: 'a tier says what its amount buys'
		});
	});

	it.each([0, -5, 12.5])('refuses a tier amount of %d', (amountMinor) => {
		expect(parsePage('campaign', page({ tiers: [{ amountMinor, buys: 'x' }] }))).toMatchObject({
			ok: false,
			path: ['tiers', 0, 'amountMinor']
		});
	});

	it('refuses a question beyond the cap', () => {
		const faq = Array.from({ length: FAQ_MAX + 1 }, () => ({ question: 'q', answer: blank }));
		expect(parsePage('campaign', page({ faq }))).toMatchObject({ ok: false, path: ['faq'] });
	});

	it('holds an answer to the rich-text rule', () => {
		expect(
			parsePage(
				'campaign',
				page({ faq: [{ question: 'q', answer: { type: 'doc', content: 'no' } }] })
			)
		).toMatchObject({ ok: false, path: expect.arrayContaining(['faq', 0, 'answer']) });
	});
});

describe('what a page carries beside its content', () => {
	const endsAt = Date.UTC(2026, 11, 31);

	it('accepts a campaign with its name, a goal, an end date and a share message', () => {
		const input = page({
			name: 'Coats for Kids',
			goalMinor: 5_000_000,
			endsAt,
			endsZone: 'America/New_York',
			shareMessage: 'I just gave to clean water. Join me?'
		});
		expect(parsePage('campaign', input)).toEqual({ ok: true, page: input });
	});

	it.each([
		['blank', '  '],
		['past a heading’s length', 'x'.repeat(HEADING_MAX + 1)]
	])('refuses a campaign name that is %s', (_, name) => {
		expect(parsePage('campaign', page({ name }))).toMatchObject({ ok: false, path: ['name'] });
	});

	it('accepts a label beside each of a campaign’s suggested amounts', () => {
		const input = page({
			amountLabels: [
				{ amountMinor: 2500, label: 'A coat' },
				{ amountMinor: 5000, label: 'Two coats' }
			]
		});
		expect(parsePage('campaign', input)).toEqual({ ok: true, page: input });
	});

	it('refuses an amount label over its length, naming the limit', () => {
		const label = 'x'.repeat(41);
		expect(parsePage('campaign', page({ amountLabels: [{ amountMinor: 2500, label }] }))).toEqual({
			ok: false,
			path: ['amountLabels', 0, 'label'],
			message: 'an amount’s label holds at most 40 characters'
		});
	});

	it('refuses a fifth amount label', () => {
		const amountLabels = [1, 2, 3, 4, 5].map((n) => ({ amountMinor: n * 1000, label: `L${n}` }));
		expect(parsePage('campaign', page({ amountLabels }))).toEqual({
			ok: false,
			path: ['amountLabels'],
			message: 'a campaign labels at most 4 suggested amounts'
		});
	});

	it('refuses an end date without the time zone it ends in', () => {
		expect(parsePage('campaign', page({ endsAt }))).toEqual({
			ok: false,
			path: ['endsZone'],
			message: 'an end date names the time zone its day ends in'
		});
	});

	it('refuses a time zone without an end date', () => {
		expect(parsePage('campaign', page({ endsZone: 'America/New_York' }))).toEqual({
			ok: false,
			path: ['endsAt'],
			message: 'a time zone belongs to an end date, and there is none'
		});
	});

	it('refuses a time zone the runtime does not know', () => {
		expect(parsePage('campaign', page({ endsAt, endsZone: 'Mars/Olympus' }))).toEqual({
			ok: false,
			path: ['endsZone'],
			message: '"Mars/Olympus" is not a time zone'
		});
	});

	it.each([
		['goalMinor', 5_000_000, 'the Donation page has no goal; only a campaign does'],
		['endsAt', endsAt, 'the Donation page has no end date; only a campaign does'],
		['endsZone', 'UTC', 'the Donation page has no end date; only a campaign does'],
		['name', 'Spring', 'the Donation page has no name; only a campaign does'],
		['lede', 'Help', 'the Donation page has no lede; only a campaign does'],
		['story', blank, 'the Donation page has no story; only a campaign does'],
		[
			'hero',
			{ imageId: IMAGE, alt: null },
			'the Donation page has no cover photo; only a campaign does'
		],
		['photos', [], 'the Donation page has no photos; only a campaign does'],
		['tiers', [], 'the Donation page has no impact tiers; only a campaign does'],
		['faq', [], 'the Donation page has no questions; only a campaign does'],
		['amountLabels', [], 'the Donation page has no suggested amount labels; only a campaign does']
	])('refuses %s on the Donation page', (key, value, message) => {
		expect(parsePage('donation_page', page({ [key]: value }))).toEqual({
			ok: false,
			path: [key],
			message
		});
	});

	it('accepts the Donation page’s heading and share message', () => {
		const input = page({ heading: 'Give today', shareMessage: 'Join me' });
		expect(parsePage('donation_page', input)).toEqual({ ok: true, page: input });
	});

	it('refuses a share message over its length', () => {
		const shareMessage = 'x'.repeat(SHARE_MESSAGE_MAX + 1);
		expect(parsePage('campaign', page({ shareMessage }))).toEqual({
			ok: false,
			path: ['shareMessage'],
			message: `a share message holds at most ${SHARE_MESSAGE_MAX} characters`
		});
	});

	const settings = {
		revenueAccountId: '4110',
		minMinor: 500,
		maxMinor: null,
		currency: 'USD',
		programMode: 'none',
		programId: null,
		suggestedAmounts: [2500, 5000],
		allowedOrigins: []
	};

	it('carries the draft donation settings', () => {
		expect(parsePage('donation_page', page({ settings }))).toEqual({
			ok: true,
			page: page({ settings })
		});
	});

	it('refuses draft donation settings off their rule, naming where', () => {
		const loose = { ...settings, suggestedAmounts: [2500, 0] };
		expect(parsePage('campaign', page({ settings: loose }))).toEqual({
			ok: false,
			path: ['settings', 'suggestedAmounts', 1],
			message: 'an amount is a whole number of minor units above zero'
		});
	});
});

describe('one rule', () => {
	it('is the only function the catalog exports, and no schema it exports passes a page', async () => {
		const exported = Object.entries(await import('./catalog'));
		const functions = exported.filter(([, value]) => typeof value === 'function');
		expect(functions.map(([name]) => name)).toEqual(['parsePage']);
		const valid = page();
		expect(parsePage('campaign', valid).ok).toBe(true);
		for (const [name, value] of exported) {
			if (value instanceof z.ZodType)
				expect([name, value.safeParse(valid).success]).toEqual([name, false]);
		}
	});
});
