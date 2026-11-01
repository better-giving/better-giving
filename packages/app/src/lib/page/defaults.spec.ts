import { describe, expect, it } from 'vitest';
import { parsePage } from './catalog';
import { defaultCampaign, defaultDonationPage } from './defaults';
import { campaignShape } from './shape';

// node pool, no database: each default is a page the rule accepts for its own type.

describe('the default Donation page', () => {
	it('passes the rule for the Donation page', () => {
		const page = defaultDonationPage();
		expect(parsePage('donation_page', page)).toEqual({ ok: true, page });
	});

	// an empty heading, which the page draws as "Donate to" the organisation's name as it stands on
	// the day it is drawn (`titleHeading` in ../donate/page-view.tsx), so a rename reaches it.
	it('leaves its title to the organisation’s name and holds no share message', () => {
		expect(defaultDonationPage()).toEqual({
			heading: '',
			switches: { openOnMonthly: false, dedicationOn: false }
		});
	});
});

describe('the clean default campaign', () => {
	it('passes the rule for a campaign', () => {
		const page = defaultCampaign();
		expect(parsePage('campaign', page)).toEqual({ ok: true, page });
	});

	it('starts as the card, holding no story, photo, tier or question', () => {
		expect(campaignShape(defaultCampaign(), { logoImageId: null }).layout).toBe('card');
	});

	it('is made fresh each call, so editing one never edits the next', () => {
		expect(defaultCampaign()).not.toBe(defaultCampaign());
		expect(defaultCampaign().switches).not.toBe(defaultCampaign().switches);
	});
});
