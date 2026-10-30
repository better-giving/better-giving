import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Page } from '../page/catalog';
import { defaultCampaign, defaultDonationPage } from '../page/defaults';
import type { PageType } from '../page/keys';
import type { RichTextDocument } from '../rich-text/document';
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
		expect(root.querySelector('.page-org')).not.toBeNull();
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
});

describe('the masthead with no logo', () => {
	const masthead = (name: string, brandColour: string | null) => {
		const base = props('donation_page', defaultDonationPage());
		const root = mount(
			<PageView {...base} org={{ ...base.org, name }} logo={null} look={{ brandColour }} />
		);
		const badge = root.querySelector<HTMLElement>('.page-mast-badge');
		return { root, badge };
	};

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
	])('%s: the badge reads %s', (name, letters) => {
		expect(initials(name)).toBe(letters);
		expect(masthead(name, '#1d6b4f').badge?.textContent).toBe(letters);
	});

	it('upper-cases the same in a Turkish-locale browser as on the server', () => {
		const turkish = vi.spyOn(String.prototype, 'toLocaleUpperCase').mockImplementation(function (
			this: string
		) {
			return this.replaceAll('i', '\u0130').toUpperCase();
		});
		onTestFinished(() => turkish.mockRestore());
		expect(masthead('iCare Fund', '#1d6b4f').badge?.textContent).toBe('IF');
	});

	it('draws no badge for a name holding no letter, and still draws the name', () => {
		const { root, badge } = masthead('1234', '#1d6b4f');
		expect(initials('1234')).toBe('');
		expect(badge).toBeNull();
		expect(root.querySelector('.page-mast-name')?.textContent).toBe('1234');
	});

	it('says nothing of its own beside the name, which names the organisation', () => {
		const { root, badge } = masthead('Hope Foundation', '#1d6b4f');
		expect(badge?.getAttribute('aria-hidden')).toBe('true');
		expect(badge?.hasAttribute('role')).toBe(false);
		expect(badge?.hasAttribute('aria-label')).toBe(false);
		expect(root.querySelector('.page-mast img')).toBeNull();
		expect(root.querySelector('.page-mast-name')?.textContent).toBe('Hope Foundation');
	});

	// the fill is the stylesheet's to paint, and happy-dom resolves no custom property: the badge is
	// held to standing under the root that seeds the brand colour, and the sheet to filling it so.
	it('stands on the brand colour the page root seeds', () => {
		const { badge } = masthead('Hope Foundation', '#1d6b4f');
		const seeded = badge?.closest<HTMLElement>('[data-donate-root]');
		expect(seeded?.style.getPropertyValue('--donate-primary')).toBe('#1d6b4f');
		const sheet = readFileSync(join(import.meta.dirname, 'page.css'), 'utf8');
		const rule = /\.page-mast-badge\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? '';
		expect(rule).toMatch(/background:\s*var\(--_p\);/);
		expect(rule).toMatch(/color:\s*var\(--_on-p\);/);
	});

	it('seeds no brand colour where the organisation has none', () => {
		const { badge } = masthead('Hope Foundation', null);
		const root = badge?.closest<HTMLElement>('[data-donate-root]');
		expect(root?.style.getPropertyValue('--donate-primary')).toBe('');
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

/** a task later, when the share row's status region is written. */
const nextTask = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe('share', () => {
	it('copies the page’s address and says so at the press and out loud', async () => {
		const writeText = vi.fn(async () => {});
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
		onTestFinished(() => {
			vi.unstubAllGlobals();
		});
		const root = mount(<PageView {...props('campaign', defaultCampaign())} />);
		const status = root.querySelector('[data-area="share"] [role="status"]');
		expect(status?.textContent).toBe('');
		const press = root.querySelector<HTMLButtonElement>('[data-area="share"] button');
		await act(async () => press?.click());
		await nextTask();
		expect(writeText).toHaveBeenCalledWith('https://give.example.org/coats');
		expect(status?.textContent).toBe('Link copied');
		expect(press?.querySelector('[data-shown]')?.textContent).toBe('Link copied');
	});

	it('says a second Copy link again, clearing what it said before writing it', async () => {
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => {} } });
		onTestFinished(() => {
			vi.unstubAllGlobals();
		});
		const root = mount(<PageView {...props('campaign', defaultCampaign())} />);
		const status = root.querySelector('[data-area="share"] [role="status"]');
		const press = root.querySelector<HTMLButtonElement>('[data-area="share"] button');
		if (status === null) throw new Error('no status region');
		await act(async () => press?.click());
		await nextTask();
		const heard: (string | null)[] = [];
		const listen = new MutationObserver(() => heard.push(status.textContent));
		listen.observe(status, { childList: true, characterData: true, subtree: true });
		onTestFinished(() => listen.disconnect());

		await act(async () => press?.click());
		await nextTask();

		expect(heard).toEqual(['', 'Link copied']);
	});

	it('draws the same buttons on every page, each opening its own share', () => {
		const root = mount(<PageView {...props('campaign', defaultCampaign())} />);
		const hrefs = [...root.querySelectorAll<HTMLAnchorElement>('[data-area="share"] a')].map(
			(a) => new URL(a.href).host || a.href.split(':')[0]
		);
		expect(hrefs).toEqual(['mailto', 'www.facebook.com', 'wa.me']);
		expect(root.querySelector('[data-area="share"] button')?.textContent).toContain('Copy link');
	});

	it('ends the top bar on a Share link to the share section, on every layout', () => {
		for (const page of [CARD, LETTER, FEATURE]) {
			const root = mount(<PageView {...props('campaign', page)} />);
			const link = root.querySelector<HTMLAnchorElement>('.page-mast a');
			expect(link?.textContent).toBe('Share');
			const target = link?.getAttribute('href') ?? '';
			expect(target).toMatch(/^#/);
			expect(root.querySelector(target)?.getAttribute('data-area')).toBe('share');
		}
		const donation = mount(<PageView {...props('donation_page', defaultDonationPage())} />);
		expect(donation.querySelector('.page-mast a')?.textContent).toBe('Share');
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
		const status = root.querySelector('[data-area="share"] [role="status"]');
		await act(async () =>
			root.querySelector<HTMLButtonElement>('[data-area="share"] button')?.click()
		);
		expect(writeText).not.toHaveBeenCalled();
		expect(status?.textContent).toBe('');
	});
});
