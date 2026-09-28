import { describe, expect, it } from 'vitest';
import { editorBlocks, layoutPictures } from './block-edit';
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
			text: { kind: 'photo', imageId: photoId, alt: '' }
		});
	});

	it('with no photo yet says so, and has no photo to replace', () => {
		const [hero] = editorBlocks(defaultCampaign(), 'USD');
		expect([hero?.summary, hero?.text]).toEqual(['No photo yet', null]);
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
