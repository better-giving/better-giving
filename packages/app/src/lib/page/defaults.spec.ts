import { describe, expect, it } from 'vitest';
import { parsePage } from './catalog';
import { defaultCampaign, defaultDonationPage } from './defaults';

// node pool, no database: each default is a page the rule accepts for its own type.

describe('the default Donation page', () => {
	it('passes the rule for the Donation page', () => {
		const page = defaultDonationPage();
		expect(parsePage('donation_page', page)).toEqual({ ok: true, page });
	});

	// an empty heading, which the page draws as "Donate to" the organisation's name as it stands on
	// the day it is drawn (`titleHeading` in ../donate/page-view.tsx), so a rename reaches it.
	it('is laid out as the design draws it, its title left to the organisation’s name', () => {
		const page = defaultDonationPage();
		expect({ layout: page.layout, palette: page.palette, look: page.look }).toEqual({
			layout: 'box-right',
			palette: 'tint',
			look: undefined
		});
		expect(page.blocks).toEqual([
			expect.objectContaining({
				type: 'title',
				variant: 'left',
				heading: ''
			}),
			expect.objectContaining({ type: 'program-chooser', variant: 'cards' }),
			expect.objectContaining({ type: 'donation-box' }),
			expect.objectContaining({ type: 'about-us', variant: 'stacked', background: 'soft' }),
			expect.objectContaining({ type: 'share', variant: 'buttons' }),
			expect.objectContaining({ type: 'org-info', variant: 'footer' })
		]);
	});
});

describe('the clean default campaign', () => {
	it('passes the rule for a campaign', () => {
		const page = defaultCampaign();
		expect(parsePage('campaign', page)).toEqual({ ok: true, page });
	});

	it('holds the design’s blocks in order, its hero, goal bar and story waiting on content', () => {
		expect(defaultCampaign().blocks).toEqual([
			expect.objectContaining({ type: 'hero', variant: 'framed', imageId: null, alt: null }),
			expect.objectContaining({ type: 'title', variant: 'left', heading: '' }),
			expect.objectContaining({ type: 'goal-bar', variant: 'bar' }),
			expect.objectContaining({
				type: 'story',
				variant: 'plain',
				body: { type: 'doc', content: [{ type: 'paragraph' }] }
			}),
			expect.objectContaining({ type: 'donation-box' }),
			expect.objectContaining({ type: 'share', variant: 'buttons' }),
			expect.objectContaining({ type: 'org-info', variant: 'footer' })
		]);
	});

	it('is made fresh each call, so editing one never edits the next', () => {
		expect(defaultCampaign()).not.toBe(defaultCampaign());
		expect(defaultCampaign().blocks).not.toBe(defaultCampaign().blocks);
	});
});
