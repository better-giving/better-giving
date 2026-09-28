import { describe, expect, it } from 'vitest';
import { editorBlocks, layoutPictures } from './block-edit';
import { defaultDonationPage } from './defaults';

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
