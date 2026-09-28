import { describe, expect, it } from 'vitest';
import { draftFromPage, pageCatalog, pageFromDraft } from './ai-catalog';
import { HEADING_MAX } from './catalog';
import { LAYOUTS, PALETTES } from './keys';
import { defaultCampaign, defaultDonationPage } from './defaults';

// node pool, no database: the prompt is a string built from the catalog, and a draft goes through
// the page rule like any other write.

describe('the drafting prompt', () => {
	it.each([
		[
			'donation_page',
			[
				'title',
				'story',
				'impact-tiers',
				'faq',
				'about-us',
				'org-info',
				'share',
				'program-chooser',
				'DonationFlow'
			],
			'goal-bar'
		],
		[
			'campaign',
			[
				'title',
				'story',
				'impact-tiers',
				'faq',
				'about-us',
				'org-info',
				'share',
				'goal-bar',
				'DonationFlow'
			],
			'program-chooser'
		]
	] as const)(
		'on a %s names every block it takes and not the one it forbids',
		(type, taken, forbidden) => {
			const prompt = pageCatalog(type).prompt();
			for (const name of taken) expect(prompt).toContain(`- ${name}:`);
			expect(prompt).not.toContain(forbidden);
		}
	);

	it('says what each layout and each palette does', () => {
		const prompt = pageCatalog('campaign').prompt();
		for (const name of [...LAYOUTS, ...PALETTES]) {
			expect(prompt).toMatch(new RegExp(`^- ${name}: \\w`, 'm'));
		}
	});
});

describe('a draft becoming a page', () => {
	const draft = (blocks: unknown[]) => ({ layout: 'column', palette: 'duo', blocks });
	const flow = { id: 'donate', type: 'DonationFlow', background: 'none', props: {} };

	it('stores the DonationFlow as the donation box and lifts each block’s props beside its frame, onto the page it redrafts', () => {
		const onto = { ...defaultCampaign(), goalMinor: 5_000_000, shareMessage: 'Join me' };
		const title = {
			id: 'title',
			type: 'title',
			variant: 'center',
			background: 'tint',
			props: { heading: 'Clean water for Kisumu' }
		};
		expect(pageFromDraft('campaign', draft([title, flow]), onto)).toEqual({
			ok: true,
			page: {
				...onto,
				layout: 'column',
				palette: 'duo',
				blocks: [
					{
						id: 'title',
						type: 'title',
						variant: 'center',
						background: 'tint',
						heading: 'Clean water for Kisumu'
					},
					{ id: 'donate', type: 'donation-box', background: 'none' }
				]
			}
		});
	});

	it('refuses through the page rule a block the page type forbids', () => {
		const goal = { id: 'goal', type: 'goal-bar', variant: 'bar', background: 'none', props: {} };
		expect(pageFromDraft('donation_page', draft([goal, flow]), defaultDonationPage())).toEqual({
			ok: false,
			path: ['blocks', 0, 'type'],
			message: 'block 1 (id "goal"): the Donation page takes no goal-bar; only a campaign does'
		});
	});

	it('refuses a prop the block does not carry', () => {
		const share = {
			id: 'share',
			type: 'share',
			variant: 'icons',
			background: 'none',
			props: { colour: 'red' }
		};
		expect(pageFromDraft('campaign', draft([share, flow]), defaultCampaign())).toEqual({
			ok: false,
			path: ['blocks', 0],
			message:
				'block 1 (id "share"): share carries no "colour"; it carries id, type, variant and background'
		});
	});

	it('keeps what the operator owns from the page it redrafts, whatever the draft says', () => {
		const onto = {
			...defaultCampaign(),
			look: { shade: 'cool' as const, corner: 'square' as const, brandColour: '#1f6feb' },
			shareMessage: 'Join me',
			switches: { openOnMonthly: true, dedicationOn: false },
			goalMinor: 5_000_000,
			endsAt: Date.UTC(2026, 11, 31),
			endsZone: 'America/New_York',
			settings: {
				revenueAccountId: '4110',
				minMinor: 500,
				maxMinor: null,
				currency: 'USD',
				programMode: 'none' as const,
				programId: null,
				suggestedAmounts: [],
				allowedOrigins: []
			}
		};
		const grabbing = {
			...draft([flow]),
			look: { shade: 'warm', corner: 'round', brandColour: '#ff0000' },
			shareMessage: 'Give now!',
			switches: { openOnMonthly: false, dedicationOn: true },
			goalMinor: 1,
			endsAt: 1,
			endsZone: 'Asia/Tokyo',
			settings: { minMinor: 1 }
		};
		expect(pageFromDraft('campaign', grabbing, onto)).toEqual({
			ok: true,
			page: {
				...onto,
				layout: 'column',
				palette: 'duo',
				blocks: [{ id: 'donate', type: 'donation-box', background: 'none' }]
			}
		});
	});

	it.each([null, ''])(
		'drops a DonationFlow variant of %j, which the box has none of',
		(variant) => {
			const result = pageFromDraft('campaign', draft([{ ...flow, variant }]), defaultCampaign());
			expect(result).toMatchObject({
				ok: true,
				page: { blocks: [{ id: 'donate', type: 'donation-box', background: 'none' }] }
			});
		}
	);

	it('places a refused prop under props, where the draft put it', () => {
		const title = {
			id: 'title',
			type: 'title',
			variant: 'left',
			background: 'none',
			props: { heading: 'x'.repeat(HEADING_MAX + 1) }
		};
		expect(pageFromDraft('campaign', draft([title, flow]), defaultCampaign())).toEqual({
			ok: false,
			path: ['blocks', 0, 'props', 'heading'],
			message: `block 1 (id "title"): a heading holds at most ${HEADING_MAX} characters`
		});
	});
});

describe('a page handed back as a draft', () => {
	it('nests each block’s values under props and names the donation box DonationFlow', () => {
		const onto = defaultCampaign();
		expect(draftFromPage(onto)).toEqual({
			layout: 'box-right',
			palette: 'tint',
			blocks: [
				{
					id: 'title',
					type: 'title',
					variant: 'left',
					background: 'none',
					props: { heading: '' }
				},
				{ id: 'goal', type: 'goal-bar', variant: 'bar', background: 'none', props: {} },
				{
					id: 'story',
					type: 'story',
					variant: 'plain',
					background: 'none',
					props: { body: { type: 'doc', content: [{ type: 'paragraph' }] } }
				},
				{ id: 'donate', type: 'DonationFlow', background: 'none', props: {} },
				{ id: 'share', type: 'share', variant: 'buttons', background: 'none', props: {} },
				{ id: 'footer', type: 'org-info', variant: 'footer', background: 'none', props: {} }
			]
		});
	});

	it('comes back through pageFromDraft as the page it was', () => {
		const onto = defaultDonationPage();
		expect(pageFromDraft('donation_page', draftFromPage(onto), onto)).toEqual({
			ok: true,
			page: onto
		});
	});
});
