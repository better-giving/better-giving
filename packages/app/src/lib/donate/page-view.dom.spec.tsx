import { brandScaleCss, generateBrandScale } from '@better-giving/form/styles/radix-scale';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Page } from '../page/catalog';
import { defaultCampaign, defaultDonationPage } from '../page/defaults';
import type { PageType } from '../page/keys';
import type { RichTextDocument } from '../rich-text/document';
import { brandScopeSelector, PageRoot } from './page-root';
import { initials, PageView, type PageViewProps, TITLE_LONG } from './page-view';

// the page's renderer, mounted: which whole layout a campaign is drawn in, which sections each
// layout draws and in what order, that a section with nothing in it is left out, and that the
// donation box is there once and early. how any of it looks is left to a person looking at it, and
// where ./page.css moves each section on a wide page is the stylesheet's.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const words = (...texts: string[]): RichTextDocument => ({
	type: 'doc',
	content: texts.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] }))
});

const PHOTO = '0192a4c1-0000-7000-8000-000000000001';
const LOGO = '0192a4c1-0000-7000-8000-00000000000a';
const tier = (amountMinor: number) => ({ amountMinor, buys: 'One new winter coat' });
const question = {
	question: 'Can I give monthly?',
	answer: words('Yes. Choose Monthly in the box.')
};

/** a campaign holding `content` beside the defaults. */
const campaign = (content: Partial<Page> = {}): Page => ({ ...defaultCampaign(), ...content });

const CARD = campaign({
	heading: 'Winter coat drive',
	lede: 'Every kid starts winter warm.',
	hero: { imageId: PHOTO, alt: 'Coats on a rack' },
	story: words('Last winter, 300 kids came without a coat.'),
	goalMinor: 1_500_000
});
const LETTER = campaign({
	...CARD,
	story: words('x'.repeat(400)),
	tiers: [tier(2500), tier(5000)],
	photos: [{ imageId: PHOTO, alt: null }]
});
const FEATURE = campaign({
	...CARD,
	tiers: [tier(2500), tier(5000)],
	photos: [{ imageId: PHOTO, alt: null }],
	faq: [question]
});

const PROGRAMS = [
	{
		id: 'prog-food',
		name: 'Food pantry',
		description: 'Groceries for 180 families, every Thursday.'
	},
	{ id: 'prog-coats', name: 'Winter coats' }
];

function props(type: PageType, page: Page, over: Partial<PageViewProps> = {}): PageViewProps {
	return {
		type,
		page,
		pageName: type === 'campaign' ? 'Winter coat drive' : null,
		org: {
			name: 'Northside Neighbors',
			mission: 'No family on the north side goes without food or warmth.',
			vision: 'A north side where every neighbor has what they need.',
			info: {
				legalName: 'Northside Neighbors',
				ein: '84-2913377',
				addressLines: ['40 Elm Street', 'Easton, PA 18042', 'United States'],
				email: 'hello@northsideneighbors.org',
				socialLinks: [{ platform: 'instagram', href: 'https://instagram.com/northside' }]
			}
		},
		look: { brandColour: '#1d6b4f' },
		sharing: { message: 'Help us get every kid a coat.', url: 'https://give.example.org/coats' },
		goal:
			type === 'campaign' && page.goalMinor !== undefined
				? { raisedMinor: 984000, goalMinor: page.goalMinor, endsAt: 'December 31' }
				: null,
		money: { locale: 'en-US', currency: 'usd' },
		programs: PROGRAMS,
		programMode: 'choice',
		donationBox: () => <div data-testid="box">the donation box</div>,
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

/** the areas the page draws, in source order, the rail's wrapper and the words' left out. */
const areas = (root: HTMLElement) =>
	[...root.querySelectorAll<HTMLElement>('[data-area]')]
		.map((node) => node.dataset.area)
		.filter((name) => name !== 'rail' && name !== 'words');

const layoutOf = (root: HTMLElement) =>
	root.querySelector<HTMLElement>('[data-donate-root]')?.dataset.layout;

describe('the whole layout a campaign is drawn in', () => {
	it.each([
		['card', CARD],
		['letter', LETTER],
		['feature', FEATURE]
	] as const)('draws the %s its content picks', (layout, page) => {
		expect(layoutOf(mount(<PageView {...props('campaign', page)} />))).toBe(layout);
	});

	it('draws the Donation page in its own layout', () => {
		expect(layoutOf(mount(<PageView {...props('donation_page', defaultDonationPage())} />))).toBe(
			'donation'
		);
	});

	it('draws a fresh campaign as the card, its title, box, share and footer alone', () => {
		const root = mount(<PageView {...props('campaign', defaultCampaign())} />);
		expect(layoutOf(root)).toBe('card');
		expect(areas(root)).toEqual(['title', 'box', 'share']);
		expect(root.querySelector('footer.ds-site-footer-compact')).not.toBeNull();
	});
});

describe('the site chrome', () => {
	it.each([
		['campaign', defaultCampaign(), true],
		['donation_page', defaultDonationPage(), false]
	] as const)(
		'heads the %s with the site nav, which draws Donate only on the campaign (%s)',
		(type, page, drawsDonate) => {
			const root = mount(<PageView {...props(type, page)} />);
			const first = root.querySelector('a[href], button');
			expect(first?.className).toBe('ds-site-nav-skip');
			expect(root.querySelector(first?.getAttribute('href') ?? '')).toBe(
				root.querySelector('main')
			);
			expect(root.querySelector('.ds-site-nav-link')?.getAttribute('href')).toBe(
				drawsDonate ? '/' : undefined
			);
			// without a link to fold, the bar draws no menu button under 40rem either.
			expect(root.querySelector('.ds-site-nav-toggle') !== null).toBe(drawsDonate);
			expect(root.querySelector('.ds-site-nav-brand')?.textContent).toBe('Northside Neighbors');
		}
	);

	it('states the legal block once, in the site footer, after the share row', () => {
		const root = mount(<PageView {...props('campaign', CARD)} />);
		const legal =
			'Northside Neighbors · EIN 84-2913377 · 40 Elm Street, Easton, PA 18042, United States';
		const lines = [...root.querySelectorAll('p')].filter((p) => p.textContent === legal);
		expect(lines).toHaveLength(1);
		const footer = lines[0]?.closest('footer');
		expect(footer?.className).toBe('ds-site-footer-compact');
		const share = root.querySelector('[data-area="share"]');
		expect(
			share !== null && footer !== null && footer !== undefined
				? share.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING
				: 0
		).toBeTruthy();
		expect(root.querySelector('main')?.contains(footer ?? null)).toBe(false);
	});
});

describe('the sections each layout draws, in order', () => {
	it('the card: cover, title, goal, box, lede, story', () => {
		const root = mount(<PageView {...props('campaign', CARD)} />);
		expect(areas(root)).toEqual(['cover', 'title', 'goal', 'box', 'lede', 'story', 'share']);
	});

	it('the letter: cover, title, goal, box and tiers, then lede, story, photos and questions', () => {
		const root = mount(
			<PageView {...props('campaign', { ...LETTER, tiers: [tier(2500)], faq: [question] })} />
		);
		expect(areas(root)).toEqual([
			'cover',
			'title',
			'goal',
			'box',
			'tiers',
			'lede',
			'story',
			'photos',
			'faq',
			'share'
		]);
		expect(root.querySelector('[data-area="faq"] details')).toBeNull();
	});

	it('the feature: cover, title, lede, goal, box, story, tiers, photos, questions and About us', () => {
		const root = mount(<PageView {...props('campaign', FEATURE)} />);
		expect(areas(root)).toEqual([
			'cover',
			'title',
			'lede',
			'goal',
			'box',
			'story',
			'tiers',
			'photos',
			'faq',
			'about',
			'share'
		]);
		expect(root.querySelector('[data-area="tiers"] [data-shape="cards"]')).not.toBeNull();
		expect(root.querySelector('[data-area="photos"] [data-shape="strip"]')).not.toBeNull();
		expect(root.querySelector('[data-area="faq"] details')).not.toBeNull();
	});

	it('the Donation page: title, chooser, box and About us', () => {
		const root = mount(<PageView {...props('donation_page', defaultDonationPage())} />);
		expect(areas(root)).toEqual(['title', 'chooser', 'box', 'about', 'share']);
	});

	it.each([
		['card', CARD],
		['letter', LETTER],
		['feature', FEATURE]
	] as const)('stands the %s’s box ahead of the story and everything after it', (_, page) => {
		const order = areas(mount(<PageView {...props('campaign', page)} />));
		for (const after of ['story', 'photos', 'faq', 'about', 'share'].filter((a) =>
			order.includes(a)
		))
			expect(order.indexOf('box')).toBeLessThan(order.indexOf(after));
	});

	it('draws the box once, outside every other section', () => {
		for (const [type, page] of [
			['campaign', CARD],
			['campaign', LETTER],
			['campaign', FEATURE],
			['donation_page', defaultDonationPage()]
		] as const) {
			const root = mount(<PageView {...props(type, page)} />);
			const boxes = root.querySelectorAll('[data-testid="box"]');
			expect(boxes).toHaveLength(1);
			const own = boxes[0]?.closest<HTMLElement>('[data-area]');
			expect(own?.dataset.area).toBe('box');
		}
	});
});

describe('a section with nothing in it is left out', () => {
	it('leaves out the goal bar where no goal is set', () => {
		const { goalMinor: _, ...page } = CARD;
		expect(areas(mount(<PageView {...props('campaign', page)} />))).not.toContain('goal');
	});

	it('leaves out a blank story and an empty lede', () => {
		const root = mount(
			<PageView
				{...props(
					'campaign',
					campaign({ story: { type: 'doc', content: [{ type: 'paragraph' }] } })
				)}
			/>
		);
		expect(areas(root)).not.toContain('story');
		expect(areas(root)).not.toContain('lede');
	});

	it('falls back to the organisation’s logo for the cover, and to none without one', () => {
		const page = campaign({ heading: 'Coats' });
		const withLogo = mount(
			<PageView
				{...props('campaign', page, { logo: { imageId: LOGO, width: 200, height: 200 } })}
			/>
		);
		expect(
			withLogo.querySelector('[data-area="cover"] [data-source="logo"] img')?.getAttribute('src')
		).toBe(`/image/${LOGO}`);
		const without = mount(<PageView {...props('campaign', page, { logo: null })} />);
		expect(areas(without)).not.toContain('cover');
	});

	it('leaves About us off the feature when the organisation has written neither', () => {
		const base = props('campaign', FEATURE);
		const root = mount(<PageView {...base} org={{ ...base.org, mission: null, vision: null }} />);
		expect(areas(root)).not.toContain('about');
	});

	it('draws no About us on the card or the letter', () => {
		expect(areas(mount(<PageView {...props('campaign', CARD)} />))).not.toContain('about');
		expect(areas(mount(<PageView {...props('campaign', LETTER)} />))).not.toContain('about');
	});

	it('draws the chooser only when donors choose among two programs or more', () => {
		const one = mount(
			<PageView
				{...props('donation_page', defaultDonationPage(), { programs: PROGRAMS.slice(0, 1) })}
			/>
		);
		expect(areas(one)).not.toContain('chooser');
		const pinned = mount(
			<PageView {...props('donation_page', defaultDonationPage(), { programMode: 'pinned' })} />
		);
		expect(areas(pinned)).not.toContain('chooser');
	});
});

describe('the title', () => {
	it('draws a campaign’s name for an empty heading, and the organisation on the Donation page', () => {
		const root = mount(<PageView {...props('campaign', campaign())} />);
		expect(root.querySelector('h1')?.textContent).toBe('Winter coat drive');
		const donation = mount(<PageView {...props('donation_page', defaultDonationPage())} />);
		expect(donation.querySelector('h1')?.textContent).toBe('Donate to Northside Neighbors');
	});

	it('draws a heading of its own over the name', () => {
		const root = mount(<PageView {...props('campaign', campaign({ heading: 'Coats for all' }))} />);
		expect(root.querySelector('h1')?.textContent).toBe('Coats for all');
	});

	const longOn = (root: HTMLElement) => root.querySelector('h1')?.hasAttribute('data-long');

	it.each([
		[28, false],
		[29, true]
	])('draws a %i-character title a step smaller: %s', (length, long) => {
		expect(TITLE_LONG).toBe(28);
		const root = mount(
			<PageView {...props('campaign', campaign({ heading: 'x'.repeat(length) }))} />
		);
		expect(longOn(root)).toBe(long);
	});

	it.each([
		['card', CARD],
		['letter', LETTER],
		['feature', FEATURE]
	] as const)('steps a long title down in the %s', (_, page) => {
		const root = mount(<PageView {...props('campaign', { ...page, heading: 'x'.repeat(29) })} />);
		expect(longOn(root)).toBe(true);
	});

	it('counts characters as a reader sees them, so 28 flags are not long', () => {
		const flags = '🇨🇦'.repeat(28);
		expect(longOn(mount(<PageView {...props('campaign', campaign({ heading: flags }))} />))).toBe(
			false
		);
	});

	it('counts the title without the spaces at its edges', () => {
		const padded = `  ${'x'.repeat(28)}  `;
		expect(longOn(mount(<PageView {...props('campaign', campaign({ heading: padded }))} />))).toBe(
			false
		);
	});

	it('counts the title it draws, so a long name standing in for an empty heading steps down', () => {
		const named = mount(
			<PageView {...props('campaign', campaign())} pageName={'Winter coat drive '.repeat(2)} />
		);
		expect(longOn(named)).toBe(true);
		const donation = mount(
			<PageView
				{...props('donation_page', defaultDonationPage())}
				org={{ ...props('donation_page', defaultDonationPage()).org, name: 'x'.repeat(19) }}
			/>
		);
		expect(longOn(donation)).toBe(true);
	});
});

describe('the one colour', () => {
	it('seeds the brand colour on the root and nothing else', () => {
		const root = mount(<PageView {...props('campaign', CARD)} />);
		const seeded = root.querySelector<HTMLElement>('[data-donate-root]');
		expect(seeded?.getAttribute('style')).toBe('--donate-primary: #1d6b4f;');
		expect(seeded?.hasAttribute('data-shade')).toBe(false);
		expect(seeded?.hasAttribute('data-palette')).toBe(false);
	});

	// happy-dom resolves no custom property, so the scale is held to the sheet the root renders and
	// the nodes its selector matches.
	it('renders the generated scale for a seeded page, scoped to its own root', () => {
		const host = mount(<PageView {...props('campaign', CARD)} look={{ brandColour: '#1d6b4f' }} />);
		const root = host.querySelector<HTMLElement>('[data-donate-root]');
		const scope = root?.getAttribute('data-brand-scope') ?? '';
		expect(scope).not.toBe('');
		const scale = generateBrandScale('#1d6b4f');
		if (scale === null) throw new Error('no scale');
		expect(root?.querySelector('style')?.textContent).toBe(
			brandScaleCss(brandScopeSelector(scope), scale)
		);
		expect([...document.querySelectorAll(brandScopeSelector(scope))]).toEqual([root]);
	});

	it('renders no scale for a page with no brand colour, so the registry default accent draws', () => {
		const host = mount(<PageView {...props('campaign', CARD)} look={{ brandColour: null }} />);
		expect(host.querySelector('[data-donate-root] style')).toBeNull();
	});

	it('gives two roots on one document their own scales, neither matching the other', () => {
		const host = mount(
			<>
				<PageRoot brandColour="#1d6b4f" layout="plain">
					{null}
				</PageRoot>
				<PageRoot brandColour="#1f6feb" layout="plain">
					{null}
				</PageRoot>
			</>
		);
		const roots = [...host.querySelectorAll<HTMLElement>('[data-donate-root]')];
		const scopes = roots.map((r) => r.getAttribute('data-brand-scope') ?? '');
		expect(new Set(scopes).size).toBe(2);
		for (const [i, root] of roots.entries()) {
			expect([...document.querySelectorAll(brandScopeSelector(scopes[i] ?? ''))]).toEqual([root]);
			expect(root.querySelector('style')?.textContent).toContain(
				generateBrandScale(i === 0 ? '#1d6b4f' : '#1f6feb')?.steps[1]
			);
		}
	});
});

describe('a name’s initials', () => {
	it.each([
		['Hope Foundation', 'HF'],
		['The Hope Fund', 'HF'],
		['Kiva', 'K'],
		['the north side food & coat bank', 'NS'],
		['The', 'T'],
		['  Elm   Street Neighbors ', 'ES'],
		['1% for the Planet', 'FT'],
		['e\u0301lan Vital', 'E\u0301V'],
		['\u00dftra\u00dfe Hilfe', 'SH'],
		['\ufb01rst Aid', 'FA'],
		['\u0627\u0644\u0647\u0644\u0627\u0644', '\u0647'],
		['\u0627\u0644', '\u0627'],
		['\u062c\u0645\u0639\u064a\u0629 \u0627\u0644\u0628\u0631', '\u062c\u200c\u0628'],
		['Hope \u062c\u0645\u0639\u064a\u0629', 'H\u062c'],
		['The 1%', 'T']
	])('%s: reads %s', (name, letters) => {
		expect(initials(name)).toBe(letters);
	});

	it('upper-cases the same in a Turkish-locale browser as on the server', () => {
		const turkish = vi.spyOn(String.prototype, 'toLocaleUpperCase').mockImplementation(function (
			this: string
		) {
			return this.replaceAll('i', '\u0130').toUpperCase();
		});
		onTestFinished(() => turkish.mockRestore());
		expect(initials('iCare Fund')).toBe('IF');
	});

	it('is empty for a name holding no letter', () => {
		expect(initials('1234')).toBe('');
	});
});

describe('the brand colour', () => {
	const seeded = (brandColour: string | null) =>
		mount(<PageView {...props('donation_page', defaultDonationPage())} look={{ brandColour }} />)
			.querySelector<HTMLElement>('[data-donate-root]')
			?.style.getPropertyValue('--donate-primary');

	it('is seeded on the page root', () => {
		expect(seeded('#1d6b4f')).toBe('#1d6b4f');
	});

	it('is seeded nowhere where the organisation has none', () => {
		expect(seeded(null)).toBe('');
	});
});

describe('the program chooser', () => {
	it('hands a pick to the route, and draws the pick it is handed', () => {
		const onProgramPick = vi.fn();
		const page = defaultDonationPage();
		const root = mount(
			<PageView
				{...props('donation_page', page, { onProgramPick, chosenProgramId: 'prog-food' })}
			/>
		);
		const radios = [
			...root.querySelectorAll<HTMLInputElement>('[data-area="chooser"] input[type="radio"]')
		];
		expect(radios.map((r) => r.parentElement?.textContent)).toEqual([
			'Where it’s needed most',
			'Food pantryGroceries for 180 families, every Thursday.',
			'Winter coats'
		]);
		expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
		act(() => radios[2]?.click());
		expect(onProgramPick).toHaveBeenLastCalledWith('prog-coats');
		act(() => radios[0]?.click());
		expect(onProgramPick).toHaveBeenLastCalledWith(null);
	});

	it('takes no pick while locked, and keeps each option reachable', () => {
		const onProgramPick = vi.fn();
		const page = defaultDonationPage();
		const root = mount(
			<PageView
				{...props('donation_page', page, {
					onProgramPick,
					chosenProgramId: 'prog-food',
					chooserLocked: true
				})}
			/>
		);
		const radios = [
			...root.querySelectorAll<HTMLInputElement>('[data-area="chooser"] input[type="radio"]')
		];
		expect(radios.map((r) => r.getAttribute('aria-disabled'))).toEqual(['true', 'true', 'true']);
		expect(radios.some((r) => r.disabled)).toBe(false);
		act(() => radios[2]?.click());
		expect(onProgramPick).not.toHaveBeenCalled();
		expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
	});
});

describe('share', () => {
	it.each([
		['campaign', defaultCampaign(), 'Share this campaign'],
		['donation_page', defaultDonationPage(), 'Share this page']
	] as const)('stands share in a region its heading names, on the %s', (type, page, heading) => {
		const root = mount(<PageView {...props(type, page)} />);
		const section = root.querySelector('[data-area="share"]');
		expect(section?.tagName.toLowerCase()).toBe('section');
		const name = section?.getAttribute('aria-labelledby') ?? '';
		expect(name).not.toBe('');
		const label = root.ownerDocument.getElementById(name);
		expect(label?.tagName.toLowerCase()).toBe('h2');
		expect(label?.textContent).toBe(heading);
		expect(section?.contains(label ?? null)).toBe(true);
	});

	it('copies the page’s address and says so at the press alone', async () => {
		const writeText = vi.fn(async () => {});
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
		onTestFinished(() => {
			vi.unstubAllGlobals();
		});
		const root = mount(<PageView {...props('campaign', defaultCampaign())} />);
		const press = root.querySelector<HTMLButtonElement>('[data-area="share"] button');
		await act(async () => press?.click());
		expect(writeText).toHaveBeenCalledWith('https://give.example.org/coats');
		expect(press?.getAttribute('aria-label')).toBe('Link copied');
		const share = root.querySelector('[data-area="share"]');
		// the region is there for a refused copy (./sections/share.tsx) and says nothing of a copy.
		expect(share?.querySelector('[role="status"]')?.textContent).toBe('');
	});

	it('draws the same buttons on every page, each opening its own share', () => {
		const root = mount(<PageView {...props('campaign', defaultCampaign())} />);
		const hrefs = [...root.querySelectorAll<HTMLAnchorElement>('[data-area="share"] a')].map(
			(a) => new URL(a.href).host || a.href.split(':')[0]
		);
		expect(hrefs).toEqual(['mailto', 'www.facebook.com', 'wa.me']);
		expect(root.querySelector('[data-area="share"] button')?.getAttribute('aria-label')).toBe(
			'Copy link'
		);
	});
});

describe('the preview', () => {
	it('follows nothing a click lands on', () => {
		const root = mount(<PageView {...props('campaign', FEATURE)} preview />);
		const link = root.querySelector<HTMLAnchorElement>('[data-area="share"] a');
		const event = new MouseEvent('click', { bubbles: true, cancelable: true });
		act(() => link?.dispatchEvent(event));
		expect(event.defaultPrevented).toBe(true);
	});

	/** a box standing in for the card, holding a control of its own. */
	const box = () => (
		<div data-testid="box">
			<button type="button">Donate</button>
		</div>
	);

	it.each([
		['campaign', FEATURE],
		['donation_page', defaultDonationPage()]
	] as const)('gives nothing on the %s outside the donation box a tab stop', (type, page) => {
		const root = mount(<PageView {...props(type, page, { donationBox: box })} preview />);
		const controls = [
			...root.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary')
		].filter((control) => control.closest('[inert]') === null);
		expect(controls.length).toBeGreaterThan(0);
		expect(controls.filter((control) => control.getAttribute('tabindex') !== '-1')).toEqual([]);
	});

	it('draws the donation box inert', () => {
		const root = mount(
			<PageView {...props('donation_page', defaultDonationPage(), { donationBox: box })} preview />
		);
		expect(root.querySelector('[data-testid="box"]')?.closest('[inert]')).not.toBeNull();
	});

	it('draws the donation box live outside the preview', () => {
		const root = mount(
			<PageView {...props('donation_page', defaultDonationPage(), { donationBox: box })} />
		);
		expect(root.querySelector('[data-testid="box"]')?.closest('[inert]')).toBeNull();
	});

	it('lets a press reach nothing a section does', async () => {
		const writeText = vi.fn(async () => {});
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
		const root = mount(<PageView {...props('campaign', defaultCampaign())} preview />);
		const press = root.querySelector<HTMLButtonElement>('[data-area="share"] button');
		await act(async () => press?.click());
		expect(writeText).not.toHaveBeenCalled();
		expect(press?.getAttribute('aria-label')).toBe('Copy link');
	});
});
