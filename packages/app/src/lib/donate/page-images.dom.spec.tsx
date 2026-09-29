import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { type Page, parsePage } from '../page/catalog';
import type { PageType } from '../page/keys';
import { PageView, type PageViewProps } from './page-view';
import { EndedCampaignPage } from './plain-page';

// the images a page draws beside its blocks' own photos, through the renderer: the organisation's
// logo in the masthead, a program's photo on its chooser option, and the caption on a hero or image
// block marked as an AI illustration, the cover's included — and the logo on an ended campaign's
// screen, which is drawn beside the renderer rather than by it. every one is drawn from the
// deployment's image route by its stored id. how any of it looks is left to a person looking at it.

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

const frame = { background: 'none' };
const title = { ...frame, id: 'title', type: 'title', variant: 'left', heading: '' };
const box = { ...frame, id: 'donate', type: 'donation-box' };
const chooser = (variant: 'cards' | 'list') => ({
	...frame,
	id: 'programs',
	type: 'program-chooser',
	variant
});
const hero = (variant: 'wide' | 'framed') => ({
	...frame,
	id: 'hero',
	type: 'hero',
	variant,
	imageId: HERO,
	alt: null
});
const image = (variant: 'column' | 'wide') => ({
	...frame,
	id: 'image',
	type: 'image',
	variant,
	imageId: IMAGE,
	alt: null
});
const page = (type: PageType, layout: string, blocks: unknown[]) =>
	parsed(type, {
		layout,
		palette: 'tint',
		switches: { openOnMonthly: false, dedicationOn: false },
		blocks
	});

/** the page with the named blocks marked as AI illustrations, as the page's loader marks them. */
const marked = (shown: Page, ids: readonly string[]): Page => ({
	...shown,
	blocks: shown.blocks.map((block) =>
		ids.includes(block.id) ? { ...block, illustration: true } : block
	)
});

function props(type: PageType, shown: Page, over: Partial<PageViewProps> = {}): PageViewProps {
	return {
		type,
		page: shown,
		pageName: type === 'campaign' ? 'Winter coat drive' : null,
		org: {
			name: ORG,
			mission: null,
			vision: null,
			info: { legalName: ORG, ein: null, addressLines: [], email: null, links: [] }
		},
		look: { brandColour: '#1d6b4f', shade: 'warm', corner: 'soft' },
		sharing: { channels: [], message: '', url: 'https://give.example.org/donate' },
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

const donationPage = (variant: 'cards' | 'list' = 'cards') =>
	page('donation_page', 'box-right', [title, chooser(variant), box]);

describe('the logo atop the page', () => {
	const masthead = (logo: PageViewProps['logo']) =>
		mount(<PageView {...props('donation_page', donationPage(), { logo })} />).querySelector(
			'.page-mast'
		);

	it('none: the name alone, as the masthead has always drawn it', () => {
		const mast = masthead(null);
		expect(mast?.querySelector('img')).toBeNull();
		expect(mast?.querySelector('.page-mast-name')?.textContent).toBe(ORG);
	});

	it.each([
		['wide', 420, 80],
		['exactly twice as wide as tall', 200, 100]
	])('%s: stands in for the name, carrying it as its alt', (_, width, height) => {
		const mast = masthead({ imageId: LOGO, width, height });
		const logo = mast?.querySelector('img');

		expect(logo?.getAttribute('src')).toBe(`/image/${LOGO}`);
		expect(logo?.getAttribute('alt')).toBe(ORG);
		expect(logo?.parentElement?.className).toBe('page-mast-name');
		expect(mast?.textContent).toBe('');
	});

	it.each([
		['square', 80, 80],
		['just under twice as wide', 199, 100],
		['tall', 60, 120]
	])('%s: stands beside the name and says nothing of its own', (_, width, height) => {
		const mast = masthead({ imageId: LOGO, width, height });
		const logo = mast?.querySelector('img');

		expect(logo?.getAttribute('src')).toBe(`/image/${LOGO}`);
		expect(logo?.getAttribute('alt')).toBe('');
		expect(logo?.nextElementSibling?.textContent).toBe(ORG);
	});

	it('is atop a campaign under the cover too', () => {
		const cover = page('campaign', 'cover', [hero('wide'), title, box]);
		const root = mount(
			<PageView
				{...props('campaign', cover, { logo: { imageId: LOGO, width: 420, height: 80 } })}
			/>
		);
		expect(root.querySelector('.page-mast img')?.getAttribute('alt')).toBe(ORG);
	});

	describe('on an ended campaign', () => {
		const ended = (logo: PageViewProps['logo']) =>
			mount(
				<EndedCampaignPage
					name="Winter coat drive"
					orgName={ORG}
					logo={logo}
					look={{ brandColour: '#1d6b4f', shade: 'warm', corner: 'soft' }}
				/>
			).querySelector('.page-mast');

		it('a wide logo stands in for the name, carrying it as its alt', () => {
			const mast = ended({ imageId: LOGO, width: 420, height: 80 });
			const logo = mast?.querySelector('img');

			expect(logo?.getAttribute('src')).toBe(`/image/${LOGO}`);
			expect(logo?.getAttribute('alt')).toBe(ORG);
			expect(mast?.textContent).toBe('');
		});

		it('none: the name alone, as the ended screen has always drawn it', () => {
			const mast = ended(null);
			expect(mast?.querySelector('img')).toBeNull();
			expect(mast?.querySelector('.page-mast-name')?.textContent).toBe(ORG);
		});
	});
});

describe.each(['cards', 'list'] as const)('program photos on the chooser, %s', (variant) => {
	const options = (programPhotos: PageViewProps['programPhotos']) =>
		[
			...mount(
				<PageView {...props('donation_page', donationPage(variant), { programPhotos })} />
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

describe('the Illustration caption through the page', () => {
	const captions = (shown: Page, ids: readonly string[] = []) =>
		[
			...mount(<PageView {...props('campaign', marked(shown, ids))} />).querySelectorAll(
				'figcaption'
			)
		].map((caption) => ({
			block: caption.closest<HTMLElement>('[data-block]')?.dataset.block,
			said: caption.textContent
		}));

	it.each([
		['wide', 'column'],
		['framed', 'wide']
	] as const)('on a %s hero and a %s image', (heroVariant, imageVariant) => {
		const shown = page('campaign', 'box-right', [
			hero(heroVariant),
			title,
			box,
			image(imageVariant)
		]);
		expect(captions(shown, ['hero', 'image'])).toEqual([
			{ block: 'hero', said: 'Illustration' },
			{ block: 'image', said: 'Illustration' }
		]);
	});

	it('under the cover', () => {
		const shown = page('campaign', 'cover', [hero('wide'), title, box]);
		const root = mount(<PageView {...props('campaign', marked(shown, ['hero']))} />);
		const cover = root.querySelector('figure.page-hero[data-variant="cover"]');

		expect(cover?.querySelector(':scope > figcaption')?.textContent).toBe('Illustration');
		expect(cover?.querySelector('.page-hero-over [data-block="title"]')).not.toBeNull();
	});

	it('only on the blocks whose photo is one', () => {
		const shown = page('campaign', 'box-right', [hero('framed'), title, box, image('column')]);
		expect(captions(shown, ['image'])).toEqual([{ block: 'image', said: 'Illustration' }]);
		expect(captions(shown)).toEqual([]);
	});
});
