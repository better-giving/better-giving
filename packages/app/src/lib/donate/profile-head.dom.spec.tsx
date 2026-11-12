import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { defaultCampaign, defaultDonationPage } from '../page/defaults';
import { PageView, type PageViewProps } from './page-view';
import type { DonateProfile } from './profile';

// the Donation page under its profile head, mounted: the layout its content picks — the card, the
// letter or the feature ($lib/page/profile-shape.ts) — and each part on its own condition in each:
// the banner, the logo or its initials, the name and the EIN, About us, the videos, the messages
// from donors, the page's heading over the box, and the footer. how any of it looks, and where
// ./page.css stands it at 60rem, is the stylesheet's and a person's looking at it.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** a profile with nothing filled in beyond the name: the card's. */
const BARE: DonateProfile = {
	name: 'Maple Street Library Friends',
	taxId: '13-2468101',
	banner: null,
	logo: null,
	mission: null,
	vision: null,
	footer: { addressLines: [], email: null, socialLinks: [] },
	messages: { messages: [], total: 0, next: null },
	videos: []
};

/** the card with everything it can hold: a banner, a logo and a short About us. */
const FULL: DonateProfile = {
	...BARE,
	name: 'Harbor Light',
	banner: { src: '/image/banner-1' },
	logo: { src: '/image/logo-1', width: 400, height: 400 },
	mission: 'We keep families housed and fed through the winter.',
	vision: 'A county where nobody loses their home over a single bad month.',
	footer: {
		addressLines: ['2200 Lake Avenue', 'Cleveland, Ohio', 'United States'],
		email: null,
		socialLinks: [{ platform: 'instagram', href: 'https://instagram.com/harborlight' }]
	}
};

const video = (n: number): DonateProfile['videos'][number] => ({
	videoId: `dQw4w9WgXc${n}`,
	title: `A winter night with the pantry crew, part ${n}`,
	durationSeconds: 192,
	posterUrl: `/images/poster-${n}`
});
const videos = (count: number) => Array.from({ length: count }, (_, n) => video(n + 1));

const message = (n: number) => ({
	name: `Donor ${n}.`,
	note: `Paying it forward, ${n}.`,
	receivedAt: '2026-11-07T10:00:00.000Z'
});
const messages = (shown: number, total: number): DonateProfile['messages'] => ({
	messages: Array.from({ length: shown }, (_, n) => message(n + 1)),
	total,
	next: shown < total ? 'cursor' : null
});

/** the letter: one video and an About us the card would hold. */
const LETTER: DonateProfile = { ...FULL, videos: videos(1) };
/** the feature: four videos, six of 48 messages, a banner and About us. */
const FEATURE: DonateProfile = { ...FULL, videos: videos(4), messages: messages(6, 48) };

const WIRING = {
	now: '2026-11-09T12:00:00.000Z',
	status: 'idle',
	arrived: null,
	onShowMore: () => {}
} as const;

function props(profile: DonateProfile | null, over: Partial<PageViewProps> = {}): PageViewProps {
	return {
		type: 'donation_page',
		page: defaultDonationPage(),
		pageName: null,
		org: {
			name: profile?.name ?? 'Harbor Light',
			mission: profile?.mission ?? null,
			vision: profile?.vision ?? null,
			info: {
				legalName: profile?.name ?? 'Harbor Light',
				ein: profile?.taxId ?? null,
				addressLines: profile?.footer.addressLines ?? [],
				email: null,
				socialLinks: profile?.footer.socialLinks ?? []
			}
		},
		look: { brandColour: '#1d6b4f' },
		sharing: { message: '', url: 'https://give.example.org/donate' },
		goal: null,
		money: { locale: 'en-US', currency: 'USD' },
		programs: [],
		programMode: 'none',
		donationBox: () => <div data-testid="box">the donation box</div>,
		donorMessages: WIRING,
		profile,
		...over
	};
}

function mount(tree: ReactNode) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const mounted = createRoot(host);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		host.remove();
	});
	return { host, render: (next: ReactNode) => act(() => mounted.render(next)) };
}

const draw = (profile: DonateProfile | null, over: Partial<PageViewProps> = {}) =>
	mount(<PageView {...props(profile, over)} />).host;

const layoutOf = (root: HTMLElement) =>
	root.querySelector<HTMLElement>('[data-donate-root]')?.dataset.layout;
const part = (root: HTMLElement, name: string) =>
	root.querySelector<HTMLElement>(`[data-area="${name}"]`);
/** the areas the body draws, in source order, the letter's and the feature's rail left out. */
const order = (root: HTMLElement) =>
	[...root.querySelectorAll<HTMLElement>('main [data-area]')]
		.map((node) => node.dataset.area)
		.filter((name) => name !== 'rail');

describe('the layout the Donation page’s content picks', () => {
	it.each([
		['card', BARE],
		['card', FULL],
		['letter', LETTER],
		['letter', { ...BARE, messages: messages(3, 3) }],
		['feature', FEATURE]
	] as const)('draws the %s', (layout, profile) => {
		expect(layoutOf(draw(profile))).toBe(layout);
	});

	it('marks the root as the profile head’s, in place of the masthead', () => {
		const root = draw(FULL);
		expect(root.querySelector('.page-mast')).toBeNull();
		expect(root.querySelector('[data-donate-root]')?.hasAttribute('data-profile')).toBe(true);
	});

	it('keeps its layout when the messages’ total moves from 6 to 48', () => {
		const at = (total: number) => ({ ...BARE, videos: videos(2), messages: messages(6, total) });
		const { host, render } = mount(<PageView {...props(at(6))} />);
		expect(layoutOf(host)).toBe('letter');
		render(<PageView {...props(at(48))} />);
		expect(layoutOf(host)).toBe('letter');
	});

	it('draws the masthead and the Donation page’s own layout where no profile is handed', () => {
		const root = draw(null);
		expect(root.querySelector('.page-mast')).not.toBeNull();
		expect(layoutOf(root)).toBe('donation');
		expect(root.querySelector('[data-donate-root]')?.hasAttribute('data-profile')).toBe(false);
	});

	it('leaves a campaign in its own layout, whatever it is handed', () => {
		const root = draw(FULL, { type: 'campaign', page: defaultCampaign(), pageName: 'Coats' });
		expect(root.querySelector('.page-mast')).not.toBeNull();
		expect(root.querySelector('[data-donate-root]')?.hasAttribute('data-profile')).toBe(false);
		expect(root.querySelector('.page-profile-name')).toBeNull();
	});

	it.each([
		['card', FULL],
		['letter', LETTER],
		['feature', FEATURE]
	] as const)('draws no raised figure in the %s', (_, profile) => {
		const root = draw(profile);
		expect(part(root, 'raised')).toBeNull();
		expect(root.textContent).not.toMatch(/raised|Be the first/);
	});

	it.each([
		['card', FULL],
		['letter', LETTER],
		['feature', FEATURE]
	] as const)('draws the box exactly once in the %s, in a part of its own', (_, profile) => {
		const boxes = draw(profile).querySelectorAll('[data-testid="box"]');
		expect(boxes).toHaveLength(1);
		expect(boxes[0]?.closest<HTMLElement>('[data-area]')?.dataset.area).toBe('box');
	});

	it.each([
		['letter', LETTER],
		['feature', FEATURE]
	] as const)('stands the %s’s box ahead of everything after it', (_, profile) => {
		const areas = order(draw(profile));
		for (const after of ['about', 'videos', 'messages'].filter((one) => areas.includes(one)))
			expect(areas.indexOf('box')).toBeLessThan(areas.indexOf(after));
	});
});

describe('the card', () => {
	it('stands the banner, the name and EIN, About us, then the box', () => {
		expect(order(draw(FULL))).toEqual(['banner', 'who', 'title', 'about', 'box']);
	});

	it('stands the box straight under the name where nothing is written', () => {
		expect(order(draw(BARE))).toEqual(['who', 'title', 'box']);
	});

	it('draws the saved banner as decoration, out of the reading', () => {
		const banner = part(draw(FULL), 'banner');
		expect(banner?.getAttribute('aria-hidden')).toBe('true');
		const art = banner?.querySelector('img');
		expect(art?.getAttribute('src')).toBe('/image/banner-1');
		expect(art?.getAttribute('alt')).toBe('');
	});

	it('draws no banner, and no band in its place, where none is saved', () => {
		const root = draw({ ...FULL, banner: null });
		expect(part(root, 'banner')).toBeNull();
		expect(root.querySelector('.page-profile-band')).toBeNull();
	});

	it('draws About us under its own heading with the mission and the vision', () => {
		const about = part(draw(FULL), 'about');
		expect(about?.querySelector('h2')?.textContent).toBe('About us');
		expect(about?.textContent).toContain('We keep families housed');
		expect(about?.textContent).toContain('A county where nobody');
	});

	it('draws About us with either one alone, and leaves it out with neither', () => {
		expect(part(draw({ ...FULL, mission: null }), 'about')).not.toBeNull();
		expect(part(draw({ ...FULL, vision: null }), 'about')).not.toBeNull();
		expect(part(draw({ ...FULL, mission: null, vision: null }), 'about')).toBeNull();
	});

	it('draws a wordmark logo whole, named for the organisation', () => {
		const logo = draw({
			...FULL,
			logo: { src: '/image/logo-1', width: 1200, height: 300 }
		}).querySelector('.page-profile-logo');
		expect(logo?.hasAttribute('data-wide')).toBe(true);
		expect(logo?.getAttribute('alt')).toBe('Harbor Light logo');
	});
});

describe('the letter', () => {
	it('stands the name, the box, About us, the videos and the messages, in that order', () => {
		const root = draw({ ...LETTER, messages: messages(1, 1) });
		expect(layoutOf(root)).toBe('letter');
		expect(order(root)).toEqual(['banner', 'who', 'title', 'box', 'about', 'videos', 'messages']);
	});

	it('holds the box alone in its rail', () => {
		const rail = part(draw(LETTER), 'rail');
		expect([...(rail?.children ?? [])].map((child) => child.getAttribute('data-area'))).toEqual([
			'box'
		]);
	});

	it('draws videos and no messages with no part for the messages', () => {
		const root = draw({ ...BARE, videos: videos(2) });
		expect(order(root)).toEqual(['who', 'title', 'box', 'videos']);
		expect(root.textContent).not.toContain('Messages from donors');
	});

	it('draws messages and no videos with no part for the videos', () => {
		const root = draw({ ...BARE, messages: messages(3, 3) });
		expect(order(root)).toEqual(['who', 'title', 'box', 'messages']);
		expect(root.textContent).not.toContain('Videos');
	});

	it('draws the messages as the list plane', () => {
		const root = draw({ ...BARE, messages: messages(3, 3) });
		expect(part(root, 'messages')?.dataset.shape).toBe('list');
	});

	it('leaves the messages out where the route wires no Show more', () => {
		const root = draw({ ...LETTER, messages: messages(1, 1) }, { donorMessages: undefined });
		expect(part(root, 'messages')).toBeNull();
	});

	it('leaves About us out where nothing is written', () => {
		expect(part(draw({ ...LETTER, mission: null, vision: null }), 'about')).toBeNull();
	});
});

describe('the feature', () => {
	it('stands the cover, the name, the box, the videos, the messages and About us', () => {
		expect(order(draw(FEATURE))).toEqual([
			'banner',
			'who',
			'title',
			'box',
			'videos',
			'messages',
			'about'
		]);
	});

	it('draws the saved banner as its cover photo, the scrim’s ground, out of the reading', () => {
		const cover = part(draw(FEATURE), 'banner');
		expect(cover?.dataset.cover).toBe('photo');
		expect(cover?.getAttribute('aria-hidden')).toBe('true');
		expect(cover?.querySelector('img')?.getAttribute('src')).toBe('/image/banner-1');
	});

	it('draws the brand’s own ground with no photo and no scrim where no banner is saved', () => {
		const cover = part(draw({ ...FEATURE, banner: null }), 'banner');
		expect(cover?.dataset.cover).toBe('none');
		expect(cover?.querySelector('img')).toBeNull();
	});

	it('draws the messages as cards', () => {
		expect(part(draw(FEATURE), 'messages')?.dataset.shape).toBe('cards');
	});

	it('draws three videos and one message as a one-card Messages grid', () => {
		const root = draw({ ...BARE, videos: videos(3), messages: messages(1, 1) });
		expect(layoutOf(root)).toBe('feature');
		const shown = part(root, 'messages');
		expect(shown?.dataset.shape).toBe('cards');
		expect(shown?.querySelectorAll('li')).toHaveLength(1);
	});

	it('draws About us as the closing band, and none where nothing is written', () => {
		const about = part(draw(FEATURE), 'about');
		expect(about?.className).toBe('page-about-area');
		expect(about?.closest('main')).not.toBeNull();
		expect(part(draw({ ...FEATURE, mission: null, vision: null }), 'about')).toBeNull();
	});

	it('leaves the videos out where there are none', () => {
		const root = draw({ ...BARE, messages: messages(6, 48), videos: videos(0) });
		expect(part(root, 'videos')).toBeNull();
	});
});

describe('the logo', () => {
	it('names the organisation’s logo', () => {
		const logo = draw(FULL).querySelector('.page-profile-logo');
		expect(logo?.tagName).toBe('IMG');
		expect(logo?.getAttribute('alt')).toBe('Harbor Light logo');
		expect(logo?.getAttribute('src')).toBe('/image/logo-1');
		expect(logo?.hasAttribute('data-wide')).toBe(false);
	});

	it.each([
		['twice as wide as it is tall', 800, 400, true],
		['a wordmark', 1200, 300, true],
		['a little under twice as wide', 799, 400, false]
	])(
		'draws a logo %s whole at its own shape where the masthead counts it wide',
		(_, width, height, wide) => {
			const logo = draw({ ...FULL, logo: { src: '/image/logo-1', width, height } }).querySelector(
				'.page-profile-logo'
			);
			expect(logo?.hasAttribute('data-wide')).toBe(wide);
			expect(logo?.getAttribute('alt')).toBe('Harbor Light logo');
		}
	);

	it.each([
		['The Hope Fund', 'HF'],
		['Eastside Animal Rescue', 'EA'],
		['Kiva', 'K']
	])('draws %s’s initials as %s where there is no logo, out of the reading', (name, letters) => {
		const badge = draw({ ...BARE, name }).querySelector('.page-profile-badge');
		expect(badge?.textContent).toBe(letters);
		expect(badge?.getAttribute('aria-hidden')).toBe('true');
	});

	it('draws no badge for a name with no letter, and still draws the name', () => {
		const root = draw({ ...BARE, name: '1 2 3' });
		expect(root.querySelector('.page-profile-badge')).toBeNull();
		expect(root.querySelector('h1')?.textContent).toBe('1 2 3');
	});
});

describe('the name and the EIN', () => {
	it.each([
		['card', FULL],
		['letter', LETTER],
		['feature', FEATURE]
	] as const)('is the page’s one h1 in the %s', (_, profile) => {
		const root = draw(profile);
		expect([...root.querySelectorAll('h1')].map((h) => h.textContent)).toEqual(['Harbor Light']);
	});

	it('steps a name past 28 characters down and draws all of it', () => {
		const long =
			'The Cuyahoga County Council for Housing, Hunger Relief and Family Stability Services, Inc.';
		const name = draw({ ...FULL, name: long }).querySelector('h1');
		expect(name?.hasAttribute('data-long')).toBe(true);
		expect(name?.textContent).toBe(long);
	});

	it('draws a name of 28 characters at its full step', () => {
		const name = draw({ ...FULL, name: 'x'.repeat(28) }).querySelector('h1');
		expect(name?.hasAttribute('data-long')).toBe(false);
	});

	it('labels the EIN where one is stated, and draws none without', () => {
		expect(draw(FULL).querySelector('.page-profile-ein')?.textContent).toBe('EIN 13-2468101');
		expect(draw({ ...FULL, taxId: null }).querySelector('.page-profile-ein')).toBeNull();
	});
});

describe('the page’s own heading', () => {
	it('stands over the donation box as its heading, the words it was saved with', () => {
		const page = { ...defaultDonationPage(), heading: 'Keep a family housed this winter' };
		const box = part(draw(FULL, { page }), 'box');
		expect(box?.querySelector('h2')?.textContent).toBe('Keep a family housed this winter');
		expect(box?.firstElementChild?.tagName).toBe('H2');
	});

	it('draws no heading over the box where none is saved', () => {
		expect(part(draw(FULL), 'box')?.querySelector('h2')).toBeNull();
	});

	it('reads in the preview, where the box under it is inert', () => {
		const page = { ...defaultDonationPage(), heading: 'Keep a family housed this winter' };
		const heading = part(draw(FULL, { page, preview: true }), 'box')?.querySelector('h2');
		expect(heading?.closest('[inert]')).toBeNull();
	});
});

describe('the footer', () => {
	it('draws the ways to reach the organisation, which the head has already named', () => {
		const footer = draw(FULL).querySelector('footer');
		expect(footer?.textContent).toContain('2200 Lake Avenue, Cleveland, Ohio, United States');
		expect(footer?.querySelector('a[aria-label="Instagram, opens in a new tab"]')).not.toBeNull();
		expect(footer?.querySelector('.page-org-name')).toBeNull();
		expect(footer?.querySelector('a[href^="mailto:"]')).toBeNull();
	});

	it('is left off where the organisation states no way to reach it', () => {
		expect(draw(BARE).querySelector('footer')).toBeNull();
	});
});
