import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { type Page, parsePage } from '../page/catalog';
import type { PageType } from '../page/keys';
import { PageView, type PageViewProps } from './page-view';
import { EndedCampaignPage, PlainPage } from './plain-page';

// the images a page draws beside its own photos, through the renderer: the organisation's logo in
// the site nav and a program's photo on its chooser option — and the logo on an ended campaign's
// screen, which is drawn beside the renderer rather than by it. every one is drawn from the
// deployment's image route by its stored id, and the cover and the photos beside it draw as plain
// photos with nothing captioning them. how any of it looks is left to a person looking at it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORG = 'Northside Neighbors';
const LOGO = '0192a4c1-0000-7000-8000-00000000000a';
const HERO = '0192a4c1-0000-7000-8000-000000000001';
const IMAGE = '0192a4c1-0000-7000-8000-000000000002';

const PROGRAMS = [
	{ id: 'prog-food', name: 'Food pantry' },
	{ id: 'prog-coats', name: 'Winter coats' },
	{ id: 'prog-club', name: 'After-school club' }
];
const PHOTOS = { 'prog-food': 'img-food', 'prog-coats': 'img-coats', 'prog-club': 'img-club' };

function parsed(type: PageType, input: unknown): Page {
	const result = parsePage(type, input);
	if (!result.ok) throw new Error(result.message);
	return result.page;
}

const switches = { openOnMonthly: false, dedicationOn: false };
const donationPage = () => parsed('donation_page', { heading: '', switches });
const campaign = (content: Record<string, unknown> = {}) =>
	parsed('campaign', { heading: 'Coats', switches, ...content });

function props(type: PageType, shown: Page, over: Partial<PageViewProps> = {}): PageViewProps {
	return {
		type,
		page: shown,
		pageName: type === 'campaign' ? 'Winter coat drive' : null,
		org: {
			name: ORG,
			mission: null,
			vision: null,
			info: { legalName: ORG, ein: null, addressLines: [], email: null, socialLinks: [] }
		},
		look: { brandColour: '#1d6b4f' },
		sharing: { message: '', url: 'https://give.example.org/donate' },
		goal: null,
		money: { locale: 'en-US', currency: 'usd' },
		programs: PROGRAMS,
		programMode: 'choice',
		donationBox: () => <div>the donation box</div>,
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

describe('the logo in the site nav', () => {
	const brand = (logo: PageViewProps['logo']) =>
		mount(<PageView {...props('donation_page', donationPage(), { logo })} />).querySelector(
			'.ds-site-nav-brand'
		);

	it('none: the name alone', () => {
		const home = brand(null);
		expect(home?.querySelector('img')).toBeNull();
		expect(home?.textContent).toBe(ORG);
	});

	it.each([
		['wide', 420, 80],
		['exactly twice as wide as tall', 200, 100]
	])('%s: stands in for the name, carrying it as its alt', (_, width, height) => {
		const home = brand({ imageId: LOGO, width, height });
		const logo = home?.querySelector('img');

		expect(logo?.getAttribute('src')).toBe(`/image/${LOGO}`);
		expect(logo?.getAttribute('alt')).toBe(ORG);
		expect(home?.textContent).toBe('');
	});

	it.each([
		['square', 80, 80],
		['just under twice as wide', 199, 100],
		['tall', 60, 120]
	])('%s: stands beside the name and says nothing of its own', (_, width, height) => {
		const home = brand({ imageId: LOGO, width, height });
		const logo = home?.querySelector('img');

		expect(logo?.getAttribute('src')).toBe(`/image/${LOGO}`);
		expect(logo?.getAttribute('alt')).toBe('');
		expect(home?.textContent).toBe(ORG);
	});

	it('is atop a campaign with a cover too', () => {
		const cover = campaign({ hero: { imageId: HERO, alt: null } });
		const root = mount(
			<PageView
				{...props('campaign', cover, { logo: { imageId: LOGO, width: 420, height: 80 } })}
			/>
		);
		expect(root.querySelector('.ds-site-nav-brand img')?.getAttribute('alt')).toBe(ORG);
	});

	describe('on an ended campaign', () => {
		const ended = (logo: PageViewProps['logo']) =>
			mount(
				<EndedCampaignPage
					name="Winter coat drive"
					orgName={ORG}
					logo={logo}
					look={{ brandColour: '#1d6b4f' }}
					footer={{ legalName: ORG, ein: null, addressLines: [], email: null, socialLinks: [] }}
				/>
			);

		it('a wide logo stands in for the name, carrying it as its alt', () => {
			const home = ended({ imageId: LOGO, width: 420, height: 80 }).querySelector(
				'.ds-site-nav-brand'
			);
			expect(home?.querySelector('img')?.getAttribute('alt')).toBe(ORG);
			expect(home?.textContent).toBe('');
		});

		it('none: the name alone, with the Donate link to / and its menu button drawn', () => {
			const root = ended(null);
			expect(root.querySelector('.ds-site-nav-brand')?.textContent).toBe(ORG);
			expect(root.querySelector('.ds-site-nav-link')?.getAttribute('href')).toBe('/');
			expect(root.querySelector('.ds-site-nav-toggle')).not.toBeNull();
		});

		it('draws a plain page with no site nav', () => {
			const root = mount(
				<PlainPage look={{ brandColour: null }}>
					<p>Nothing to share</p>
				</PlainPage>
			);
			expect(root.querySelector('.ds-site-nav')).toBeNull();
		});
	});
});

describe('program photos on the chooser', () => {
	const options = (programPhotos: PageViewProps['programPhotos']) =>
		[
			...mount(
				<PageView {...props('donation_page', donationPage(), { programPhotos })} />
			).querySelectorAll('.page-choose-option')
		].map((option) => ({
			name: option.querySelector('.page-choose-name')?.textContent,
			photo: option.querySelector('img')?.getAttribute('src') ?? null,
			alt: option.querySelector('img')?.getAttribute('alt') ?? null
		}));

	it('every program with a photo: each drawn by its id, and where it’s needed most without one', () => {
		expect(options(PHOTOS)).toEqual([
			{ name: 'Where it’s needed most', photo: null, alt: null },
			{ name: 'Food pantry', photo: '/image/img-food', alt: '' },
			{ name: 'Winter coats', photo: '/image/img-coats', alt: '' },
			{ name: 'After-school club', photo: '/image/img-club', alt: '' }
		]);
	});

	it('no photos: every option as it has always drawn', () => {
		expect(options(undefined).map((option) => option.photo)).toEqual([null, null, null, null]);
		expect(options({}).map((option) => option.photo)).toEqual([null, null, null, null]);
	});

	it('a mix: only the programs with one', () => {
		const mix = { 'prog-food': 'img-food', 'prog-club': 'img-club' };
		expect(options(mix).map((option) => option.photo)).toEqual([
			null,
			'/image/img-food',
			null,
			'/image/img-club'
		]);
	});

	it('a photo keyed to no program on the chooser draws nowhere', () => {
		expect(options({ 'prog-archived': 'img-old' }).map((option) => option.photo)).toEqual([
			null,
			null,
			null,
			null
		]);
	});
});

describe('the cover’s and the photos’ own', () => {
	it('draws each as a plain photo', () => {
		const shown = campaign({
			hero: { imageId: HERO, alt: null },
			photos: [{ imageId: IMAGE, alt: null }]
		});
		const root = mount(<PageView {...props('campaign', shown)} />);
		expect(root.querySelector('[data-area="cover"] .page-photo')?.getAttribute('src')).toBe(
			`/image/${HERO}`
		);
		expect(root.querySelector('[data-area="photos"] .page-photo')?.getAttribute('src')).toBe(
			`/image/${IMAGE}`
		);
		expect(root.querySelector('figure, figcaption')).toBeNull();
	});
});
