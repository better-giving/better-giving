import { describe, expect, it } from 'vitest';
import { editorBlocks, layoutPictures, lookPictures, shareChannelPictures } from './block-edit';
import { defaultCampaign, defaultDonationPage } from './defaults';

// node pool, no database: the block list and the pictures as the editor is drawn from a draft.

describe('the block list', () => {
	it('offers each block the catalog’s variants, and the donation box none', () => {
		const blocks = editorBlocks(defaultDonationPage(), 'USD');

		expect(
			blocks.map(({ id, label, summary, variant }) => ({ id, label, summary, variant }))
		).toEqual([
			{ id: 'title', label: 'Title', summary: 'The page’s name', variant: 'left' },
			{ id: 'programs', label: 'Program choice', summary: '', variant: 'cards' },
			{ id: 'donate', label: 'Donation box', summary: '', variant: null },
			{ id: 'about', label: 'About us', summary: '', variant: 'stacked' },
			{ id: 'share', label: 'Share buttons', summary: '', variant: 'buttons' },
			{ id: 'footer', label: 'Organisation details', summary: '', variant: 'footer' }
		]);
		expect(blocks.find(({ id }) => id === 'about')?.variants).toEqual([
			{ value: 'stacked', label: 'Stacked' },
			{ value: 'side-by-side', label: 'Side by side' },
			{ value: 'statement', label: 'Statement' }
		]);
		expect(blocks.find(({ id }) => id === 'donate')?.variants).toEqual([]);
	});
});

describe('an FAQ block', () => {
	it('is summed up as its questions, joined by commas', () => {
		const draft = defaultCampaign();
		const answer = {
			type: 'doc' as const,
			content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Yes.' }] }]
		};
		draft.blocks.push({
			id: 'faq',
			type: 'faq',
			variant: 'open',
			background: 'none',
			items: [
				{ question: 'Deductible?', answer },
				{ question: 'Monthly?', answer }
			]
		});
		const faq = editorBlocks(draft, 'USD').find(({ id }) => id === 'faq');
		expect(faq?.summary).toBe('Deductible?, Monthly?');
	});
});

describe('an impact tiers block', () => {
	it('seeds each tier’s amount grouped, as its money box draws it', () => {
		const draft = defaultCampaign();
		draft.blocks.push({
			id: 'tiers',
			type: 'impact-tiers',
			variant: 'cards',
			background: 'none',
			tiers: [
				{ amountMinor: 2_000_000, buys: 'a well' },
				{ amountMinor: 2500, buys: 'a coat' },
				{ amountMinor: 123_456_750, buys: 'a school' }
			]
		});
		const tiers = editorBlocks(draft, 'USD').find(({ id }) => id === 'tiers');
		expect(tiers?.text).toMatchObject({
			kind: 'impact-tiers',
			tiers: [
				{ amount: '20,000', buys: 'a well' },
				{ amount: '25', buys: 'a coat' },
				{ amount: '1,234,567.50', buys: 'a school' }
			]
		});
	});
});

describe('a photo block', () => {
	const photoId = '01926f3e-7c1a-7b2e-9d4f-3a5b6c7d8e9f';

	it('is offered its sheet with the photo placed and what describes it', () => {
		const draft = defaultCampaign();
		draft.blocks[0] = {
			id: 'hero',
			type: 'hero',
			variant: 'wide',
			background: 'none',
			imageId: photoId,
			alt: null
		};
		const [hero] = editorBlocks(draft, 'USD');
		expect(hero).toEqual({
			id: 'hero',
			type: 'hero',
			label: 'Cover photo',
			summary: '',
			variant: 'wide',
			variants: [
				{ value: 'wide', label: 'Wide' },
				{ value: 'framed', label: 'Framed' }
			],
			background: 'none',
			backgrounds: [{ value: 'none', label: 'None' }],
			removable: true,
			movesUp: false,
			movesDown: true,
			text: { kind: 'photo', imageId: photoId, alt: '' }
		});
	});

	it('with no photo yet says so, and opens its sheet with no photo placed', () => {
		const [hero] = editorBlocks(defaultCampaign(), 'USD');
		expect([hero?.summary, hero?.text]).toEqual([
			'No photo yet',
			{ kind: 'photo', imageId: null, alt: '' }
		]);
	});
});

describe('the layout pictures', () => {
	it('are the catalog’s layouts, each named', () => {
		expect(layoutPictures()).toEqual([
			{ value: 'box-right', label: 'Box beside' },
			{ value: 'banner', label: 'Banner' },
			{ value: 'column', label: 'Column' },
			{ value: 'cover', label: 'Cover' }
		]);
	});
});

describe('the look and share pictures', () => {
	it('are the catalog’s shades, corners and palettes, each named', () => {
		expect(lookPictures()).toEqual({
			shades: [
				{ value: 'light', label: 'Light' },
				{ value: 'warm', label: 'Warm' },
				{ value: 'cool', label: 'Cool' }
			],
			corners: [
				{ value: 'square', label: 'Square' },
				{ value: 'soft', label: 'Soft' },
				{ value: 'round', label: 'Round' }
			],
			palettes: [
				{ value: 'plain', label: 'Plain' },
				{ value: 'tint', label: 'Tinted' },
				{ value: 'duo', label: 'Two-tone' },
				{ value: 'bright', label: 'Bright' },
				{ value: 'bold', label: 'Bold' }
			]
		});
	});

	it('offers every share button, named as its button says it', () => {
		expect(shareChannelPictures()).toEqual([
			{ value: 'facebook', label: 'Facebook' },
			{ value: 'whatsapp', label: 'WhatsApp' },
			{ value: 'email', label: 'Email' },
			{ value: 'copy-link', label: 'Copy link' },
			{ value: 'linkedin', label: 'LinkedIn' },
			{ value: 'x', label: 'X' }
		]);
	});
});
