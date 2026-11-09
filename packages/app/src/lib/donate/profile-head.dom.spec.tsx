import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { defaultCampaign, defaultDonationPage } from '../page/defaults';
import { PageView, type PageViewProps, profileLayout } from './page-view';
import type { DonateProfile } from './profile';

// the Donation page under its profile head, mounted: which layout its content picks, and each part
// on its own condition — the banner, the logo or its initials, the name and the EIN, the raised
// figure, About us, the page's heading over the box, and the footer. how any of it looks, and where
// ./page.css stands it at 60rem, is the stylesheet's and a person's looking at it.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** a profile with nothing filled in beyond the name: the compact layout's. */
const BARE: DonateProfile = {
	name: 'Maple Street Library Friends',
	taxId: '13-2468101',
	banner: null,
	logo: null,
	mission: null,
	vision: null,
	raised: { raisedMinor: 0, gifts: 0 },
	money: { locale: 'en-US', currency: 'USD' },
	footer: { addressLines: [], email: null, socialLinks: [] }
};

const FULL: DonateProfile = {
	...BARE,
	name: 'Harbor Light',
	banner: { src: '/image/banner-1' },
	logo: { src: '/image/logo-1', width: 400, height: 400 },
	mission: 'We keep families housed and fed through the winter.',
	vision: 'A county where nobody loses their home over a single bad month.',
	raised: { raisedMinor: 4_821_000, gifts: 612 },
	footer: {
		addressLines: ['2200 Lake Avenue', 'Cleveland, Ohio', 'United States'],
		email: null,
		socialLinks: [{ platform: 'instagram', href: 'https://instagram.com/harborlight' }]
	}
};

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
		profile,
		...over
	};
}

function mount(tree: ReactNode): HTMLElement {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

const draw = (profile: DonateProfile | null, over: Partial<PageViewProps> = {}) =>
	mount(<PageView {...props(profile, over)} />);

const head = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-head]');
const part = (root: HTMLElement, name: string) =>
	root.querySelector<HTMLElement>(`[data-area="${name}"]`);

describe('the layout the profile head picks', () => {
	it('is compact with no banner, no mission or vision and nothing raised', () => {
		expect(profileLayout(BARE)).toBe('compact');
		expect(head(draw(BARE))?.dataset.head).toBe('compact');
	});

	it.each([
		['a banner', { banner: { src: '/image/b' } }],
		['a mission', { mission: 'Books for every block.' }],
		['a vision', { vision: 'A library card in every pocket.' }],
		['anything raised', { raised: { raisedMinor: 2500, gifts: 1 } }]
	] as const)('is the profile layout with %s alone', (_, filled) => {
		expect(profileLayout({ ...BARE, ...filled })).toBe('profile');
		expect(head(draw({ ...BARE, ...filled }))?.dataset.head).toBe('profile');
	});

	it('takes the masthead’s place on the Donation page, under its own root layout', () => {
		const root = draw(FULL);
		expect(root.querySelector('.page-mast')).toBeNull();
		expect(root.querySelector('[data-donate-root]')?.getAttribute('data-layout')).toBe('profile');
	});

	it('draws the masthead and the Donation page’s own layout where no profile is handed', () => {
		const root = draw(null);
		expect(root.querySelector('.page-mast')).not.toBeNull();
		expect(root.querySelector('[data-donate-root]')?.getAttribute('data-layout')).toBe('donation');
		expect(head(root)).toBeNull();
	});

	it('leaves a campaign in its own layout, whatever it is handed', () => {
		const root = draw(FULL, { type: 'campaign', page: defaultCampaign(), pageName: 'Coats' });
		expect(root.querySelector('.page-mast')).not.toBeNull();
		expect(head(root)).toBeNull();
	});

	it('stands the parts in the order a phone reads them, the box before About us', () => {
		const root = draw(FULL);
		const order = [...root.querySelectorAll<HTMLElement>('[data-head] [data-area]')].map(
			(node) => node.dataset.area
		);
		expect(order).toEqual(['banner', 'who', 'title', 'raised', 'box', 'about']);
	});
});

describe('the banner', () => {
	it('draws the saved banner as decoration, out of the reading', () => {
		const banner = part(draw(FULL), 'banner');
		expect(banner?.getAttribute('aria-hidden')).toBe('true');
		const art = banner?.querySelector('img');
		expect(art?.getAttribute('src')).toBe('/image/banner-1');
		expect(art?.getAttribute('alt')).toBe('');
	});

	it('draws the brand’s band with no art where the profile layout has no banner', () => {
		const band = part(draw({ ...FULL, banner: null }), 'banner');
		expect(band?.className).toBe('page-profile-band');
		expect(band?.getAttribute('aria-hidden')).toBe('true');
		expect(band?.querySelector('img')).toBeNull();
	});

	it('draws neither in the compact layout', () => {
		expect(part(draw(BARE), 'banner')).toBeNull();
	});
});

describe('the logo', () => {
	it('names the organisation’s logo', () => {
		const logo = draw(FULL).querySelector('.page-profile-logo');
		expect(logo?.tagName).toBe('IMG');
		expect(logo?.getAttribute('alt')).toBe('Harbor Light logo');
		expect(logo?.getAttribute('src')).toBe('/image/logo-1');
	});

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
	it('is the page’s one h1', () => {
		const root = draw(FULL);
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

describe('the raised figure', () => {
	const raised = (gifts: number, raisedMinor: number) =>
		part(draw({ ...FULL, raised: { raisedMinor, gifts } }), 'raised')?.textContent;

	it('invites the first gift at nothing, with no figure and no count', () => {
		const said = raised(0, 0);
		expect(said).toBe('Be the first to give.');
	});

	it('counts one gift in the singular', () => {
		expect(raised(1, 2500)).toBe('$25 raised from 1 gift');
	});

	it('states many in full, never abbreviated, and groups the count', () => {
		expect(raised(18_402, 120_455_000)).toBe('$1,204,550 raised from 18,402 gifts');
	});
});

describe('About us', () => {
	it('draws under its own heading with the mission and the vision', () => {
		const about = part(draw(FULL), 'about');
		expect(about?.querySelector('h2')?.textContent).toBe('About us');
		expect(about?.textContent).toContain('We keep families housed');
		expect(about?.textContent).toContain('A county where nobody');
	});

	it('draws with either one alone', () => {
		expect(part(draw({ ...FULL, mission: null }), 'about')).not.toBeNull();
		expect(part(draw({ ...FULL, vision: null }), 'about')).not.toBeNull();
	});

	it('is left out where the organisation has written neither', () => {
		expect(part(draw({ ...FULL, mission: null, vision: null }), 'about')).toBeNull();
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
