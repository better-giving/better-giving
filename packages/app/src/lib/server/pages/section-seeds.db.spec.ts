import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Page } from '../../page/catalog';
import { defaultCampaign } from '../../page/defaults';
import { endOfDay } from '../../page/end-date';
import { createDb, type Db } from '../db/client';
import { page } from '../db/schema';
import { insertPage, SETTINGS } from './page-row.testing';
import { readPage } from './queries';
import { editBanner, readCampaignEditSeeds, readDonationPageEditSeeds } from './section-seeds';
import { client } from '$lib/server/db/database.testing';

// a db spec because the seeds read the draft's settings, the programs and the owned row.

let db: Db;

beforeAll(() => {
	db = createDb(client);
});

const ORIGIN = 'https://give.test';
const IMAGE = '0b8a2f9e-2c4f-4f7a-9f55-0f2d6c3a9e11';
const NOW = Date.parse('2026-10-28T12:00:00Z');

async function row(pageId: string) {
	const found = await readPage(db, pageId);
	if (found === null) throw new Error('the page is gone');
	return found;
}

const story = {
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Warm' }] }]
};

describe('a campaign’s card seeds', () => {
	it('seeds each card from the draft, an amount’s label beside it and a goal in major units', async () => {
		const ends = endOfDay({ day: '2099-12-31', timeZone: 'America/New_York', now: NOW });
		if (!ends.ok) throw new Error(ends.reason);
		const draft: Page = {
			...defaultCampaign(),
			name: 'Winter coat drive',
			story: story as Page['story'],
			hero: { imageId: IMAGE, alt: null },
			goalMinor: 1_500_000,
			amountLabels: [
				{ amountMinor: 5000, label: 'Two coats' },
				{ amountMinor: 9900, label: 'gone with its amount' }
			],
			shareMessage: 'Keep a child warm',
			endsAt: ends.endsAt,
			endsZone: 'America/New_York',
			settings: SETTINGS
		};
		const pageId = await insertPage(db, 'campaign', draft);

		const seeds = await readCampaignEditSeeds(db, {}, await row(pageId), ORIGIN);

		expect(seeds.general).toEqual({
			boxes: { name: 'Winter coat drive', slug: (await row(pageId)).slug },
			story
		});
		expect(seeds.media).toEqual({
			boxes: { hero_image_id: IMAGE, logo_image_id: '' },
			hero: { imageId: IMAGE, src: `/image/${IMAGE}` },
			logo: null
		});
		expect(seeds.goal).toEqual({
			boxes: {
				goal_mode: 'fixed',
				goal_amount: '15,000',
				amount: ['25', '50'],
				amount_label: ['', 'Two coats']
			},
			currency: 'USD'
		});
		expect(seeds.settings).toMatchObject({
			boxes: {
				program_mode: 'none',
				program_id: '',
				min_minor: '5',
				max_minor: '1,000',
				open_on_monthly: false,
				dedication_on: false,
				share_message: 'Keep a child warm',
				end_date: '2099-12-31'
			},
			currency: 'USD',
			retired: null
		});
	});

	it('seeds No goal and no amounts as blank boxes', async () => {
		const pageId = await insertPage(db, 'campaign', {
			...defaultCampaign(),
			settings: { ...SETTINGS, suggestedAmounts: [] }
		});

		const { goal } = await readCampaignEditSeeds(db, {}, await row(pageId), ORIGIN);

		expect(goal.boxes).toEqual({
			goal_mode: 'none',
			goal_amount: '',
			amount: [],
			amount_label: []
		});
	});
});

describe('the Donation page’s card seeds', () => {
	it('seeds its title, its giving settings and its switches from the draft', async () => {
		const pageId = await insertPage(db, 'donation_page', {
			heading: 'Give today',
			shareMessage: 'Join me',
			switches: { openOnMonthly: false, dedicationOn: true },
			settings: SETTINGS
		});

		const seeds = await readDonationPageEditSeeds(db, {}, await row(pageId), ORIGIN);

		expect(seeds.general).toEqual({ boxes: { heading: 'Give today' } });
		expect(seeds.giving).toMatchObject({
			boxes: { min_minor: '5', max_minor: '1,000', suggested_amounts: ['25', '50'] },
			currency: 'USD'
		});
		expect(seeds.settings).toMatchObject({
			boxes: { open_on_monthly: false, dedication_on: true, share_message: 'Join me' }
		});
	});
});

describe('the banner', () => {
	const document: Page = { ...defaultCampaign(), settings: SETTINGS };

	it('reads a campaign never published as not public, with no Unpublish and no End', async () => {
		const pageId = await insertPage(db, 'campaign', document);

		expect(editBanner(await row(pageId), NOW)).toEqual({
			state: 'not_public',
			address: `/${(await row(pageId)).slug}`,
			preview: `/preview/${pageId}`,
			unpublishable: false,
			endable: false
		});
	});

	it('reads an unpublished campaign as not public, offering End', async () => {
		const pageId = await insertPage(db, 'campaign', document, document);
		await db.update(page).set({ state: 'unpublished' }).where(eq(page.id, pageId));

		expect(editBanner(await row(pageId), NOW)).toMatchObject({
			state: 'not_public',
			unpublishable: false,
			endable: true
		});
	});

	it('reads a live campaign as public, or changed where its draft differs, offering Unpublish and End', async () => {
		const same = await insertPage(db, 'campaign', document, document);
		const changed = await insertPage(db, 'campaign', { ...document, heading: 'New' }, document);

		expect(editBanner(await row(same), NOW)).toMatchObject({
			state: 'public',
			unpublishable: true,
			endable: true
		});
		expect(editBanner(await row(changed), NOW)).toMatchObject({ state: 'changed' });
	});

	it('reads a campaign past its published end as ended, offering neither', async () => {
		const ends = endOfDay({ day: '2026-10-01', timeZone: 'UTC', now: Number.NEGATIVE_INFINITY });
		if (!ends.ok) throw new Error(ends.reason);
		const past = { ...document, endsAt: ends.endsAt, endsZone: 'UTC' };
		const pageId = await insertPage(db, 'campaign', past, past);

		expect(editBanner(await row(pageId), NOW)).toMatchObject({
			state: 'ended',
			unpublishable: false,
			endable: false
		});
	});

	it('gives the Donation page its address and no Unpublish', async () => {
		const pageId = await insertPage(db, 'donation_page');

		expect(editBanner(await row(pageId), NOW)).toEqual({
			state: 'public',
			address: '/donate',
			preview: `/preview/${pageId}`,
			unpublishable: false,
			endable: false
		});
	});
});
