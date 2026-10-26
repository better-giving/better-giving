import { describe, expect, it } from 'vitest';
import * as contentEdit from './content-edit';
import { editorSections, newPhotoSection, parseSlot } from './content-edit';
import { defaultCampaign, defaultDonationPage } from './defaults';

// node pool, no database: the sections as the editor is drawn from a draft.

const photoId = '01926f3e-7c1a-7b2e-9d4f-3a5b6c7d8e9f';
const answer = {
	type: 'doc' as const,
	content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Yes.' }] }]
};

describe('the sections a campaign lists', () => {
	it('are its content alone, in a fixed order, each saying it holds nothing yet', () => {
		expect(
			editorSections(defaultCampaign(), 'campaign', 'USD').map(({ id, label, summary, empty }) => ({
				id,
				label,
				summary,
				empty
			}))
		).toEqual([
			{ id: 'title', label: 'Title', summary: 'The page’s name', empty: false },
			{ id: 'story', label: 'Story', summary: 'No story yet', empty: true },
			{ id: 'cover', label: 'Cover photo', summary: 'No photo yet', empty: true },
			{ id: 'tiers', label: 'Impact tiers', summary: 'None yet', empty: true },
			{ id: 'faq', label: 'Questions', summary: 'None yet', empty: true }
		]);
	});

	it('lists each photo beside the cover in its place', () => {
		const draft = { ...defaultCampaign(), photos: [{ imageId: photoId, alt: 'Vans' }] };
		const photo = editorSections(draft, 'campaign', 'USD').find(({ id }) => id === 'photo-0');
		expect(photo).toEqual({
			id: 'photo-0',
			label: 'Photo 1',
			summary: 'Vans',
			empty: false,
			text: { kind: 'photo', slot: '0', imageId: photoId, alt: 'Vans', removable: true }
		});
	});

	it('sums up the questions, joined by commas', () => {
		const draft = {
			...defaultCampaign(),
			faq: [
				{ question: 'Deductible?', answer },
				{ question: 'Monthly?', answer }
			]
		};
		const faq = editorSections(draft, 'campaign', 'USD').find(({ id }) => id === 'faq');
		expect(faq?.summary).toBe('Deductible?, Monthly?');
	});

	it('seeds each tier’s amount grouped, as its money box draws it', () => {
		const draft = {
			...defaultCampaign(),
			tiers: [
				{ amountMinor: 2_000_000, buys: 'a well' },
				{ amountMinor: 2500, buys: 'a coat' },
				{ amountMinor: 123_456_750, buys: 'a school' }
			]
		};
		const tiers = editorSections(draft, 'campaign', 'USD').find(({ id }) => id === 'tiers');
		expect(tiers?.text).toMatchObject({
			kind: 'tiers',
			tiers: [
				{ amount: '20,000', buys: 'a well' },
				{ amount: '25', buys: 'a coat' },
				{ amount: '1,234,567.50', buys: 'a school' }
			]
		});
	});

	it('opens the cover’s sheet on the photo placed, which may be taken off', () => {
		const draft = { ...defaultCampaign(), hero: { imageId: photoId, alt: null } };
		const cover = editorSections(draft, 'campaign', 'USD').find(({ id }) => id === 'cover');
		expect(cover?.text).toEqual({
			kind: 'photo',
			slot: 'cover',
			imageId: photoId,
			alt: '',
			removable: true
		});
	});

	it('adds a photo after the rest, with none placed yet', () => {
		const draft = { ...defaultCampaign(), photos: [{ imageId: photoId, alt: null }] };
		expect(newPhotoSection(draft)).toMatchObject({
			id: 'photo-1',
			text: { kind: 'photo', slot: 'new', imageId: null, removable: false }
		});
	});
});

describe('the Donation page’s sections', () => {
	it('are its title alone, with no lede', () => {
		expect(editorSections(defaultDonationPage(), 'donation_page', 'USD')).toEqual([
			{
				id: 'title',
				label: 'Title',
				summary: 'The page’s name',
				empty: false,
				text: { kind: 'title', heading: '', lede: null }
			}
		]);
	});
});

describe('a photo’s slot', () => {
	it.each([
		['cover', { kind: 'cover' }],
		['new', { kind: 'new' }],
		['0', { kind: 'photo', at: 0 }],
		['7', { kind: 'photo', at: 7 }]
	])('reads %j', (posted, slot) => {
		expect(parseSlot(posted)).toEqual(slot);
	});

	it.each(['', '-1', '01', '1.5', 'hero'])('refuses %j', (posted) => {
		expect(parseSlot(posted)).toBeNull();
	});
});

describe('what the editor offers', () => {
	it('names no layout, look, variant, background, add or move', () => {
		const names = Object.keys(contentEdit).join(' ');
		expect(names).not.toMatch(/layout|look|palette|variant|background|channel|(^|[ _])move/i);
		expect(Object.values(contentEdit.CONTENT_FORMS)).toEqual([
			'content-title',
			'content-story',
			'content-tiers',
			'content-faq',
			'content-photo',
			'content-photo-remove',
			'page-share-message'
		]);
	});
});
