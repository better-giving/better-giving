import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { PageView, type PageViewProps } from '../../donate/page-view';
import type { DonateProfile } from '../../donate/profile';
import { defaultCampaign, defaultDonationPage } from '../../page/defaults';

// the entry card that starts a supporter's fundraiser, mounted on the pages that draw it: under the
// Donation page's profile head between its content and its messages, after a campaign's layout and
// after the Donation page's own, and nowhere — with nothing in its place — while the feature is off.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROFILE: DonateProfile = {
	name: 'Harbor Light',
	taxId: '84-1234567',
	banner: null,
	logo: null,
	mission: 'We keep families housed and fed through the winter.',
	vision: null,
	raised: { raisedMinor: 4_821_000, gifts: 612 },
	money: { locale: 'en-US', currency: 'USD' },
	footer: { addressLines: ['2200 Lake Avenue'], email: null, socialLinks: [] },
	messages: {
		messages: [
			{ name: 'Maya R.', note: 'Paying it forward.', receivedAt: '2026-11-07T10:00:00.000Z' }
		],
		total: 1,
		next: null
	},
	videos: []
};

const WIRING = {
	now: '2026-11-09T12:00:00.000Z',
	status: 'idle',
	arrived: null,
	onShowMore: () => {}
} as const;

function props(over: Partial<PageViewProps> = {}): PageViewProps {
	return {
		type: 'donation_page',
		page: defaultDonationPage(),
		pageName: null,
		org: {
			name: 'Harbor Light',
			mission: PROFILE.mission,
			vision: null,
			info: {
				legalName: 'Harbor Light',
				ein: '84-1234567',
				addressLines: [],
				email: null,
				socialLinks: []
			}
		},
		look: { brandColour: null },
		sharing: { message: '', url: 'https://give.example.org/donate' },
		goal: null,
		money: { locale: 'en-US', currency: 'USD' },
		programs: [],
		programMode: 'none',
		donationBox: () => <div data-testid="box">the donation box</div>,
		...over
	};
}

function mount(tree: ReactNode): HTMLElement {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => root.render(tree));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return host;
}

const card = (root: HTMLElement) => root.querySelector<HTMLElement>('.page-fundraise');

/** the sections' areas in source order. */
const areas = (root: HTMLElement) =>
	[...root.querySelectorAll<HTMLElement>('[data-area]')].map((node) => node.dataset.area);

describe('the entry card', () => {
	it('says what a supporter does, and links to /fundraise with one secondary press', () => {
		const root = mount(<PageView {...props({ profile: PROFILE, fundraiserEntry: true })} />);
		const entry = card(root);
		expect(entry?.querySelector('h2')?.textContent).toBe('Raise money for Harbor Light');
		expect(entry?.getAttribute('aria-labelledby')).toBe(entry?.querySelector('h2')?.id);
		expect(entry?.textContent).toContain(
			'Every gift goes straight to Harbor Light, which sends the receipt.'
		);
		expect(entry?.textContent).toContain('Takes about two minutes. No password.');
		const presses = entry?.querySelectorAll('a, button') ?? [];
		expect(presses).toHaveLength(1);
		const start = presses[0];
		expect(start?.textContent).toBe('Start a fundraiser');
		expect(start?.getAttribute('href')).toBe('/fundraise');
		expect(start?.className).toContain('ds-btn-secondary');
		expect(root.querySelector('.ds-btn-primary')).toBeNull();
	});

	it('stands under the profile head after its content and before the messages from donors', () => {
		const root = mount(
			<PageView {...props({ profile: PROFILE, fundraiserEntry: true, donorMessages: WIRING })} />
		);
		const more = root.querySelector('[data-area="more"]');
		const sections = [...(more?.children ?? [])].map((node) => (node as HTMLElement).dataset.area);
		expect(sections).toEqual(['about', 'fundraise', 'messages']);
	});

	it('stands after a campaign’s layout, and after the Donation page’s own', () => {
		const campaign = mount(
			<PageView
				{...props({
					type: 'campaign',
					page: { ...defaultCampaign(), heading: 'Winter coat drive' },
					pageName: 'Winter coat drive',
					fundraiserEntry: true
				})}
			/>
		);
		expect(areas(campaign).slice(-2)).toEqual(['fundraise', 'share']);
		const donation = mount(<PageView {...props({ profile: null, fundraiserEntry: true })} />);
		expect(areas(donation).slice(-2)).toEqual(['fundraise', 'share']);
	});

	it('draws nothing in its place while Supporter fundraisers is off', () => {
		const on = mount(<PageView {...props({ profile: PROFILE, fundraiserEntry: true })} />);
		const off = mount(<PageView {...props({ profile: PROFILE, fundraiserEntry: false })} />);
		const absent = mount(<PageView {...props({ profile: PROFILE })} />);
		expect(card(on)).not.toBeNull();
		for (const root of [off, absent]) {
			expect(card(root)).toBeNull();
			expect(root.querySelector('[data-area="fundraise"]')).toBeNull();
			expect(root.innerHTML).not.toContain('/fundraise');
		}
		const campaign = mount(
			<PageView {...props({ type: 'campaign', page: defaultCampaign(), pageName: 'Coats' })} />
		);
		expect(campaign.querySelector('[data-area="fundraise"]')).toBeNull();
	});

	it('keeps the profile head’s more area out when the card is all it would hold and it is off', () => {
		const bare = { ...PROFILE, mission: null, messages: { messages: [], total: 0, next: null } };
		expect(
			mount(<PageView {...props({ profile: bare })} />).querySelector('[data-area="more"]')
		).toBeNull();
		expect(
			mount(<PageView {...props({ profile: bare, fundraiserEntry: true })} />).querySelector(
				'[data-area="more"] .page-fundraise'
			)
		).not.toBeNull();
	});
});
