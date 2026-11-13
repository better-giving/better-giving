import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { PageView, type PageViewProps } from '../../donate/page-view';
import type { DonateProfile } from '../../donate/profile';
import { defaultCampaign, defaultDonationPage } from '../../page/defaults';
import { FundraiserPage } from './fundraiser-page';

// the entry card that starts a supporter's fundraiser, mounted on the pages that draw it: after a
// campaign's layout, after the Donation page's own and after its profile head's, and nowhere — with
// nothing in its place — while the feature is off.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROFILE: DonateProfile = {
	name: 'Harbor Light',
	taxId: '84-1234567',
	banner: null,
	logo: null,
	mission: 'We keep families housed and fed through the winter.',
	vision: null,
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

const videos = (count: number): DonateProfile['videos'] =>
	Array.from({ length: count }, (_, n) => ({
		videoId: `dQw4w9WgXc${n + 1}`,
		title: `A winter night with the pantry crew, part ${n + 1}`,
		durationSeconds: 192,
		posterUrl: `/images/poster-${n + 1}`
	}));

/** the card: nothing beyond the name, so the layout holds no mission, no videos and no messages. */
const BARE_PROFILE: DonateProfile = {
	...PROFILE,
	mission: null,
	messages: { messages: [], total: 0, next: null }
};

/** the letter: one video beside the mission and a message. */
const LETTER: DonateProfile = { ...PROFILE, videos: videos(1) };

/** the feature: a banner, four videos and six of 48 messages. */
const FEATURE: DonateProfile = {
	...PROFILE,
	banner: { src: '/image/banner-1' },
	videos: videos(4),
	messages: {
		messages: [1, 2, 3, 4, 5, 6].map((n) => ({
			name: `Donor ${n}`,
			note: `Note ${n}.`,
			receivedAt: '2026-11-07T10:00:00.000Z'
		})),
		total: 48,
		next: 'cursor'
	}
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

	it('stands after the profile head’s whole layout, the messages from donors included', () => {
		const root = mount(
			<PageView {...props({ profile: PROFILE, fundraiserEntry: true, donorMessages: WIRING })} />
		);
		const messages = root.querySelector('[data-area="messages"]');
		const entry = card(root);
		if (messages === null || entry === null)
			throw new Error('messages or the entry card is missing');
		expect(messages.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(areas(root).slice(-2)).toEqual(['fundraise', 'share']);
	});

	it.each([
		['card', BARE_PROFILE],
		['letter', LETTER],
		['feature', FEATURE]
	])('stands after the %s’s whole layout, its footer and closing parts included', (_, profile) => {
		const root = mount(
			<PageView {...props({ profile, fundraiserEntry: true, donorMessages: WIRING })} />
		);
		const all = areas(root);
		expect(all.slice(-2)).toEqual(['fundraise', 'share']);
		expect(all.filter((area) => area === 'fundraise')).toHaveLength(1);
		const entry = card(root);
		const earlier = [...root.querySelectorAll<HTMLElement>('main [data-area]')].filter(
			(node) => node.dataset.area !== 'fundraise' && node.dataset.area !== 'share'
		);
		expect(earlier.length).toBeGreaterThan(0);
		for (const node of earlier) {
			expect(node.compareDocumentPosition(entry as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
				Node.DOCUMENT_POSITION_FOLLOWING
			);
		}
	});

	// ../../donate/page.css sizes the card under the profile head by the root's `data-layout`: the
	// page's content width in the card and the feature, and the letter's own column tracks from 60rem.
	it.each([
		['card', BARE_PROFILE],
		['letter', LETTER],
		['feature', FEATURE]
	])(
		'stands in the %s’s content width, outside its layout, under the root naming it',
		(layout, profile) => {
			const root = mount(
				<PageView {...props({ profile, fundraiserEntry: true, donorMessages: WIRING })} />
			);
			const area = root.querySelector<HTMLElement>('[data-area="fundraise"]');
			const page = root.querySelector<HTMLElement>('.page');
			expect(page?.dataset.layout).toBe(layout);
			expect(page?.hasAttribute('data-profile')).toBe(true);
			expect(area?.className).toBe('page-in page-fundraise-area');
			expect(area?.parentElement?.matches('main.page-body')).toBe(true);
			expect([...(area?.children ?? [])]).toEqual([card(root)]);
		}
	);

	it('draws a bare profile with the feature on as the card, then the entry card, and no more area', () => {
		const root = mount(
			<PageView
				{...props({ profile: BARE_PROFILE, fundraiserEntry: true, donorMessages: WIRING })}
			/>
		);
		expect(card(root)).not.toBeNull();
		expect(root.querySelector('[data-area="more"]')).toBeNull();
		expect(root.querySelector('[data-area="messages"]')).toBeNull();
		expect(root.querySelector('[data-area="about"]')).toBeNull();
		expect(areas(root).slice(-2)).toEqual(['fundraise', 'share']);
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
});

describe('a supporter’s fundraiser page', () => {
	it('draws on the plain root, its messages as a list', () => {
		const root = mount(
			<FundraiserPage
				fundraiser={{
					title: 'Keep the pantry trucks running',
					story: 'I drive the Thursday route.',
					name: 'Maya Reyes',
					startedAt: '2026-11-02T09:30:00.000Z',
					photoId: null,
					raisedMinor: 324_000,
					goalMinor: 500_000,
					gifts: 41,
					goalReached: false,
					messages: PROFILE.messages
				}}
				org={{ name: 'Harbor Light', taxId: '84-1234567', logo: null }}
				look={{ brandColour: null }}
				money={{ locale: 'en-US', currency: 'USD' }}
				now={WIRING.now}
				sharing={{ message: '', url: 'https://give.example.org/f/keep-the-pantry-trucks' }}
				contact={{ addressLines: [], email: null, socialLinks: [] }}
				fundraiserEntry
				donationBox={<div data-testid="box" />}
				donorMessages={WIRING}
			/>
		);
		expect(root.querySelector<HTMLElement>('[data-donate-root]')?.dataset.layout).toBe('plain');
		const messages = root.querySelector<HTMLElement>('[data-area="messages"]');
		expect(messages).not.toBeNull();
		expect(messages?.dataset.shape).toBe('list');
	});
});
