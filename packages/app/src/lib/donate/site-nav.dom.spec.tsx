import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { MAIN_ID, SiteNav, type SiteNavProps } from './site-nav';

// the site nav, mounted: the skip link first, the organisation as the home link, the one Donate
// link marked current on /donate alone, and the folded menu's disclosure. where the registry's sheet
// shows the bar's links and where the menu button is for a person looking at it at 375 and 1440.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const nav = (over: Partial<SiteNavProps> = {}) =>
	mount(
		<>
			<SiteNav name="Greenfield Food Bank" logo={null} current={false} {...over} />
			<main id={MAIN_ID} tabIndex={-1}>
				<a href="/elsewhere">a link in the page</a>
			</main>
		</>
	);

const TAB_STOPS = 'a[href], button:not([disabled])';

describe('the skip link', () => {
	it('is the first tab stop, and lands on the page’s main', () => {
		const root = nav();
		const first = root.querySelector<HTMLAnchorElement>(TAB_STOPS);
		expect(first?.className).toBe('ds-site-nav-skip');
		expect(first?.textContent).toBe('Skip to content');
		const target = root.querySelector(first?.getAttribute('href') ?? '');
		expect(target?.tagName).toBe('MAIN');
		expect(target?.getAttribute('tabindex')).toBe('-1');
	});
});

describe('the links', () => {
	const donateLinks = (root: HTMLElement) =>
		[...root.querySelectorAll<HTMLAnchorElement>('nav a')].filter(
			(a) => a.textContent === 'Donate'
		);

	it('marks Donate as the current page on /donate, in the bar and in the menu', () => {
		const links = donateLinks(nav({ current: true }));
		expect(links).toHaveLength(2);
		expect(links.map((a) => a.getAttribute('aria-current'))).toEqual(['page', 'page']);
	});

	it('marks nothing current anywhere else', () => {
		const root = nav({ current: false });
		expect(donateLinks(root)).toHaveLength(2);
		expect(root.querySelector('[aria-current]')).toBeNull();
	});

	it('names each list Main and offers Donate alone', () => {
		const lists = [...nav().querySelectorAll('nav')];
		expect(lists.map((list) => list.getAttribute('aria-label'))).toEqual(['Main', 'Main']);
		for (const list of lists) {
			expect([...list.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
				'/donate'
			]);
		}
	});

	it('draws the organisation as the home link, its logo beside the name saying nothing', () => {
		const root = nav({ logo: { imageId: 'logo-1', width: 400, height: 400 } });
		const brand = root.querySelector<HTMLAnchorElement>('.ds-site-nav-brand');
		expect(brand?.getAttribute('href')).toBe('/donate');
		expect(brand?.textContent).toBe('Greenfield Food Bank');
		expect(brand?.querySelector('img')?.getAttribute('alt')).toBe('');
	});

	it('draws the name in its own box, carrying it whole in its title, so ./page.css can cut a long one', () => {
		const long = 'Greater Philadelphia Community Food Bank';
		const root = nav({ name: long, logo: { imageId: 'logo-1', width: 400, height: 400 } });
		const name = root.querySelector('.ds-site-nav-brand > .page-site-name');
		expect(name?.textContent).toBe(long);
		expect(name?.getAttribute('title')).toBe(long);
	});

	it('lets a wordmark stand in for the name, carrying it as its alt', () => {
		const root = nav({ logo: { imageId: 'logo-1', width: 800, height: 200 } });
		const brand = root.querySelector('.ds-site-nav-brand');
		expect(brand?.textContent).toBe('');
		expect(brand?.querySelector('img')?.getAttribute('alt')).toBe('Greenfield Food Bank');
	});

	it('draws no home link where the organisation has no name', () => {
		expect(nav({ name: null }).querySelector('.ds-site-nav-brand')).toBeNull();
	});
});

describe('the folded menu', () => {
	const parts = (root: HTMLElement) => {
		const button = root.querySelector<HTMLButtonElement>('.ds-site-nav-toggle');
		const panel = root.ownerDocument.getElementById(button?.getAttribute('aria-controls') ?? '');
		return { button, panel };
	};

	it('opens and closes on the button, which says so', () => {
		const { button, panel } = parts(nav());
		expect(button?.getAttribute('aria-label')).toBe('Menu');
		expect(button?.getAttribute('aria-expanded')).toBe('false');
		expect(panel?.hidden).toBe(true);
		act(() => button?.click());
		expect(button?.getAttribute('aria-expanded')).toBe('true');
		expect(panel?.hidden).toBe(false);
		act(() => button?.click());
		expect(panel?.hidden).toBe(true);
	});

	it('closes on Escape in the panel and hands focus back to the button', () => {
		const { button, panel } = parts(nav());
		act(() => button?.click());
		const row = panel?.querySelector('a');
		act(() => row?.focus());
		act(() => {
			row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		});
		expect(panel?.hidden).toBe(true);
		expect(document.activeElement).toBe(button);
	});

	it('closes on a pointer down outside it and the button', () => {
		const root = nav();
		const { button, panel } = parts(root);
		act(() => button?.click());
		act(() => {
			root.querySelector('main')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		});
		expect(panel?.hidden).toBe(true);
	});

	it('closes when focus leaves it for the page', () => {
		const root = nav();
		const { button, panel } = parts(root);
		act(() => button?.click());
		act(() => panel?.querySelector('a')?.focus());
		act(() => root.querySelector<HTMLAnchorElement>('main a')?.focus());
		expect(panel?.hidden).toBe(true);
	});

	it('repeats the bar’s actions under its row, and closes on a press on one', () => {
		const root = nav({ actions: <button type="button">Sign out</button> });
		const { button, panel } = parts(root);
		expect(root.querySelector('.ds-site-nav-end > .ds-site-nav-actions')?.textContent).toBe(
			'Sign out'
		);
		act(() => button?.click());
		const action = panel?.querySelector<HTMLButtonElement>('.ds-site-nav-menu-actions button');
		act(() => action?.click());
		expect(panel?.hidden).toBe(true);
	});

	it('closes on a press on its row', () => {
		const { button, panel } = parts(nav());
		act(() => button?.click());
		const row = panel?.querySelector('a');
		row?.addEventListener('click', (event) => event.preventDefault());
		act(() => row?.click());
		expect(panel?.hidden).toBe(true);
	});
});
