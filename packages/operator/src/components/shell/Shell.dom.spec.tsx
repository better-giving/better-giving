import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RAIL_COOKIE, parseRail, railCookie } from '../../rail-preference';
import { mount, render } from '../render.testing';
import { Shell, type ShellProps, initials } from './Shell.jsx';

// the operator shell on app-shell-css: which row says it is the page, the Settings parent opening
// from the route, the rail toggle and its stored choice, the phone's drawer, and the account menu
// from the keyboard. the classes and attributes asserted are the registry's contract, read as what
// a reader meets.

const groups: ShellProps['groups'] = [
	{ destinations: [{ href: '/admin', label: 'Dashboard', mark: 'layout-dashboard' }] },
	{
		destinations: [
			{ href: '/admin/campaigns', label: 'Campaigns', mark: 'megaphone' },
			{ href: '/admin/donations', label: 'Gifts', mark: 'hand-heart' }
		]
	},
	{
		destinations: [
			{ href: '/admin/members', label: 'Members', mark: 'shield-check' },
			{
				href: '/admin/settings',
				label: 'Settings',
				mark: 'settings',
				children: [
					{
						href: '/admin/settings/organisation',
						label: 'Organisation details',
						mark: 'building-2'
					},
					{ href: '/admin/settings/notifications', label: 'Notifications', mark: 'bell' },
					{ href: '/admin/settings/mail', label: 'Mail', mark: 'mail' }
				]
			}
		]
	},
	{
		heading: 'Integrations',
		destinations: [
			{ href: '/admin/integrations/zapier', label: 'Zapier', mark: { src: '/zapier.png' } },
			{ href: '/admin/integrations/api', label: 'API', mark: 'key-round' }
		]
	}
];

const props = (over: Partial<ShellProps> = {}): ShellProps => ({
	orgName: 'Greenfield Food Bank',
	orgLogo: '/logo.png',
	home: { href: '/admin', label: 'Dashboard' },
	groups,
	staff: { name: 'Amara Lindqvist', email: 'amara@greenfieldfoodbank.org' },
	donationPage: '/donate',
	editDonationPage: '/admin/donation-page',
	onSignOut: () => {},
	children: <h1>Gifts</h1>,
	...over
});

const sidebar = (root: HTMLElement) => {
	const found = root.querySelector<HTMLElement>('.ds-shell-sidebar');
	if (found === null) throw new Error('the shell drew no sidebar');
	return found;
};
const drawer = (root: HTMLElement) => {
	const found = root.querySelector<HTMLDialogElement>('dialog.ds-shell-drawer');
	if (found === null) throw new Error('the shell drew no drawer');
	return found;
};
const button = (root: HTMLElement, selector: string) => {
	const found = root.querySelector<HTMLButtonElement>(selector);
	if (found === null) throw new Error(`the shell drew no ${selector}`);
	return found;
};
/** the sidebar's link whose label reads `label`. */
const row = (scope: HTMLElement, label: string, selector = '.ds-nav-link') =>
	[...scope.querySelectorAll<HTMLAnchorElement>(selector)].find(
		(link) => link.textContent === label
	);

describe('the shell’s rows', () => {
	it('mark the page’s own row with aria-current="page" and no other', () => {
		const root = render(Shell, props({ current: { label: 'Gifts', kind: 'page' } }));

		const marked = [...sidebar(root).querySelectorAll('[aria-current]')];
		expect(marked.map((link) => [link.textContent, link.getAttribute('aria-current')])).toEqual([
			['Gifts', 'page']
		]);
	});

	it('mark a screen under a row with aria-current="true", never as the page', () => {
		const root = render(Shell, props({ current: { label: 'Gifts', kind: 'section' } }));

		expect(row(sidebar(root), 'Gifts')?.getAttribute('aria-current')).toBe('true');
	});

	it('mark nothing for an address under no row', () => {
		const root = render(Shell, props());

		expect(sidebar(root).querySelector('[aria-current]')).toBeNull();
	});

	it('draw a company’s image where a row has no glyph, out of the tree', () => {
		const root = render(Shell, props());

		const image = row(sidebar(root), 'Zapier')?.querySelector('img');
		expect(image?.getAttribute('src')).toBe('/zapier.png');
		expect(image?.getAttribute('alt')).toBe('');
	});

	it('name a headed group by its heading', () => {
		const root = render(Shell, props());

		const group = sidebar(root).querySelector('[role="group"]');
		const heading = group?.querySelector('h2.ds-nav-title');
		expect(heading?.textContent).toBe('Integrations');
		expect(group?.getAttribute('aria-labelledby')).toBe(heading?.id);
	});
});

describe('the Settings parent', () => {
	const parent = (root: HTMLElement) => {
		const found = sidebar(root).querySelector<HTMLAnchorElement>('.ds-nav-parent');
		if (found === null) throw new Error('the shell drew no parent row');
		return found;
	};

	it('is collapsed on a route outside Settings, and links to its first section', () => {
		const root = render(Shell, props({ current: { label: 'Gifts', kind: 'page' } }));

		expect(parent(root).getAttribute('aria-expanded')).toBe('false');
		expect(parent(root).getAttribute('href')).toBe('/admin/settings/organisation');
		expect(parent(root).hasAttribute('aria-current')).toBe(false);
	});

	it('is expanded on a Settings route, controls its named list, and marks the section', () => {
		const root = render(
			Shell,
			props({
				current: { label: 'Settings', kind: 'section', child: '/admin/settings/notifications' }
			})
		);

		expect(parent(root).getAttribute('aria-expanded')).toBe('true');
		const list = root.querySelector(
			`#${CSS.escape(parent(root).getAttribute('aria-controls') ?? '')}`
		);
		expect(list?.className).toBe('ds-nav-sub');
		expect(list?.getAttribute('aria-label')).toBe('Settings sections');
		const marked = [...(list?.querySelectorAll('[aria-current]') ?? [])];
		expect(marked.map((link) => [link.textContent, link.getAttribute('aria-current')])).toEqual([
			['Notifications', 'page']
		]);
		expect(parent(root).hasAttribute('aria-current')).toBe(false);
	});

	it('follows the route as it changes, with no press of its own', () => {
		const shell = mount(Shell, props({ current: { label: 'Gifts', kind: 'page' } }));
		expect(parent(shell.root).getAttribute('aria-expanded')).toBe('false');

		shell.again(
			props({
				current: { label: 'Settings', kind: 'section', child: '/admin/settings/organisation' }
			})
		);

		expect(parent(shell.root).getAttribute('aria-expanded')).toBe('true');
	});

	it('draws the rail’s link and its flyout in the sidebar, the link current while a section is', () => {
		const root = render(
			Shell,
			props({ current: { label: 'Settings', kind: 'section', child: '/admin/settings/mail' } })
		);

		const railLink = sidebar(root).querySelector('.ds-shell-rail-parent');
		expect(railLink?.getAttribute('aria-current')).toBe('true');
		expect(railLink?.getAttribute('aria-expanded')).toBe('false');
		expect(railLink?.hasAttribute('aria-haspopup')).toBe(false);
		const flyout = root.querySelector(
			`#${CSS.escape(railLink?.getAttribute('aria-controls') ?? '')}`
		);
		expect(flyout?.tagName).toBe('NAV');
		expect(flyout?.getAttribute('aria-label')).toBe('Settings sections');
		expect(row(flyout as HTMLElement, 'Mail')?.getAttribute('aria-current')).toBe('page');
	});

	it('leaves the rail’s parts out of the drawer, which never becomes a rail', () => {
		const root = render(Shell, props());

		expect(drawer(root).querySelector('.ds-shell-rail-parent, .ds-shell-flyout')).toBeNull();
	});
});

describe('the rail toggle', () => {
	const toggle = (root: HTMLElement) => button(root, '.ds-shell-toggle');

	it('controls the sidebar and says it would collapse it while it is open', () => {
		localStorage.clear();
		const root = render(Shell, props());

		expect(toggle(root).getAttribute('aria-label')).toBe('Collapse sidebar');
		expect(toggle(root).getAttribute('aria-expanded')).toBe('true');
		expect(toggle(root).getAttribute('aria-controls')).toBe(sidebar(root).id);
		expect(root.querySelector('.ds-shell')?.hasAttribute('data-collapsed')).toBe(false);
	});

	describe('and its cookie', () => {
		beforeEach(() => localStorage.clear());
		const setCookie = (value: string) => {
			// biome-ignore lint/suspicious/noDocumentCookie: the shell writes it this way, so the spec does.
			document.cookie = value;
		};
		afterEach(() => {
			setCookie(`${RAIL_COOKIE}=; Path=/; Max-Age=0`);
			localStorage.clear();
		});
		const kept = () => parseRail(document.cookie);
		const cookieSet = () => document.cookie.includes(`${RAIL_COOKIE}=`);

		it('makes the rail, flips its words and keeps the choice in the cookie and under bg-operator-rail', () => {
			const root = render(Shell, props());

			act(() => toggle(root).click());

			expect(root.querySelector('.ds-shell')?.hasAttribute('data-collapsed')).toBe(true);
			expect(toggle(root).getAttribute('aria-label')).toBe('Expand sidebar');
			expect(toggle(root).getAttribute('aria-expanded')).toBe('false');
			expect(kept()).toBe(true);
			expect(localStorage.getItem('bg-operator-rail')).toBe('collapsed');

			act(() => toggle(root).click());

			expect(root.querySelector('.ds-shell')?.hasAttribute('data-collapsed')).toBe(false);
			expect(cookieSet()).toBe(true);
			expect(kept()).toBe(false);
			expect(localStorage.getItem('bg-operator-rail')).toBe('expanded');
		});

		it('mounts the way it was told and is not flipped by a choice kept only in storage', () => {
			localStorage.setItem('bg-operator-rail', 'collapsed');
			const root = render(Shell, props());

			expect(root.querySelector('.ds-shell')?.hasAttribute('data-collapsed')).toBe(false);
			expect(toggle(root).getAttribute('aria-label')).toBe('Collapse sidebar');
			// the stored choice becomes the cookie, so the next page's server draws it
			expect(kept()).toBe(true);
		});

		it('leaves a cookie already there alone on mount', () => {
			setCookie(railCookie(false));
			localStorage.setItem('bg-operator-rail', 'collapsed');
			const root = render(Shell, props());

			expect(root.querySelector('.ds-shell')?.hasAttribute('data-collapsed')).toBe(false);
			expect(cookieSet()).toBe(true);
			expect(kept()).toBe(false);
		});
	});

	it('is the rail on the server’s first paint when the cookie said so', () => {
		const drawn = document.createElement('div');
		drawn.innerHTML = renderToString(<Shell {...props({ initialCollapsed: true })} />);

		expect(drawn.querySelector('.ds-shell')?.hasAttribute('data-collapsed')).toBe(true);
		expect(toggle(drawn).getAttribute('aria-label')).toBe('Expand sidebar');
		expect(toggle(drawn).getAttribute('aria-expanded')).toBe('false');
	});
});

describe('the phone’s drawer', () => {
	const menu = (root: HTMLElement) => button(root, '.ds-shell-menu');

	function opened() {
		const root = render(Shell, props({ current: { label: 'Gifts', kind: 'page' } }));
		act(() => menu(root).click());
		return root;
	}

	it('is a closed dialog named Menu, controlled by the menu button', () => {
		const root = render(Shell, props());

		expect(drawer(root).getAttribute('aria-label')).toBe('Menu');
		expect(drawer(root).open).toBe(false);
		expect(menu(root).getAttribute('aria-controls')).toBe(drawer(root).id);
		expect(menu(root).getAttribute('aria-expanded')).toBe('false');
	});

	it('opens modal from the menu button, focus on its close button', () => {
		const shown = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
		const root = opened();

		expect(shown).toHaveBeenCalledOnce();
		expect(drawer(root).open).toBe(true);
		expect(menu(root).getAttribute('aria-expanded')).toBe('true');
		expect(document.activeElement?.getAttribute('aria-label')).toBe('Close menu');
	});

	it('closes on Escape, as the browser closes it, focus back on the menu button', () => {
		const root = opened();

		// Escape on a modal dialog is the browser's: a `cancel`, then the dialog closes.
		act(() => {
			drawer(root).dispatchEvent(new Event('cancel'));
			drawer(root).close();
		});

		expect(drawer(root).open).toBe(false);
		expect(menu(root).getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(menu(root));
	});

	it('closes when a link in it is chosen, focus back on the menu button', () => {
		const root = opened();

		act(() => row(drawer(root), 'Campaigns')?.click());

		expect(drawer(root).open).toBe(false);
		expect(document.activeElement).toBe(menu(root));
	});

	describe('with its account menu open', () => {
		async function press(key: string): Promise<void> {
			await act(async () => {
				document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
			});
		}
		async function accountOpened() {
			const root = opened();
			act(() => button(drawer(root), '.ds-shell-account-btn').focus());
			await press('ArrowDown');
			return root;
		}

		it('closes when a link row is chosen from the keyboard', async () => {
			const root = await accountOpened();
			expect(drawer(root).querySelector('[data-highlighted]')?.textContent).toBe(
				'Edit donation page'
			);

			await press('Enter');

			expect(drawer(root).open).toBe(false);
		});

		it('closes when a link row is pressed', async () => {
			const root = await accountOpened();
			const open = [...drawer(root).querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
				(item) => item.textContent === 'Open donation page'
			);

			await act(async () => open?.click());

			expect(drawer(root).open).toBe(false);
		});
	});

	it('stays open for a link opened in a new tab', () => {
		const root = opened();

		act(() => {
			row(drawer(root), 'Campaigns')?.dispatchEvent(
				new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
			);
		});

		expect(drawer(root).open).toBe(true);
	});

	it('closes from its close button and from a press on the scrim', () => {
		const root = opened();
		act(() => button(drawer(root), '[aria-label="Close menu"]').click());
		expect(drawer(root).open).toBe(false);

		act(() => menu(root).click());
		act(() => drawer(root).click());
		expect(drawer(root).open).toBe(false);
	});

	it('holds the same rows and the account as the sidebar', () => {
		const root = render(Shell, props());

		const labels = (scope: HTMLElement) =>
			[...scope.querySelectorAll('.ds-nav-link:not(.ds-shell-rail-parent)')]
				.filter((link) => link.closest('.ds-shell-flyout') === null)
				.map((link) => link.textContent);
		expect(labels(drawer(root))).toEqual(labels(sidebar(root)));
		expect(drawer(root).querySelector('.ds-shell-account-btn')?.textContent).toContain(
			'Amara Lindqvist'
		);
	});
});

describe('the account menu', () => {
	/** a key pressed wherever focus stands. async, because the machine settles on a microtask. */
	async function press(key: string): Promise<void> {
		await act(async () => {
			document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
		});
	}
	const account = (root: HTMLElement) => button(sidebar(root), '.ds-shell-account-btn');
	const panel = (root: HTMLElement) => sidebar(root).querySelector<HTMLElement>('[role="menu"]');

	it('is a menu button carrying the staff name, the organisation and their initials', () => {
		const root = render(Shell, props());

		expect(account(root).getAttribute('aria-haspopup')).toBe('menu');
		expect(account(root).getAttribute('aria-expanded')).toBe('false');
		expect(account(root).querySelector('.ds-shell-account-name')?.textContent).toBe(
			'Amara Lindqvist'
		);
		expect(account(root).querySelector('.ds-shell-account-org')?.textContent).toBe(
			'Greenfield Food Bank'
		);
		expect(account(root).querySelector('.ds-avatar')?.textContent).toBe('AL');
		expect(panel(root)?.hidden).toBe(true);
	});

	it('opens on ArrowDown under a header, with the rows in order', async () => {
		const root = render(Shell, props());
		act(() => account(root).focus());

		await press('ArrowDown');

		expect(account(root).getAttribute('aria-expanded')).toBe('true');
		expect(panel(root)?.querySelector('.ds-menu-header-title')?.textContent).toBe(
			'Amara Lindqvist'
		);
		expect(panel(root)?.querySelector('.ds-menu-header-meta')?.textContent).toBe(
			'amara@greenfieldfoodbank.org'
		);
		const rows = [...(panel(root)?.querySelectorAll('[role="menuitem"]') ?? [])];
		expect(rows.map((item) => [item.textContent, item.getAttribute('href')])).toEqual([
			['Edit donation page', '/admin/donation-page'],
			['Open donation page', '/donate'],
			['Sign out', null]
		]);
		expect(panel(root)?.querySelector('[data-highlighted]')?.textContent).toBe(
			'Edit donation page'
		);
	});

	it('signs out from the keyboard and hands focus back to the button', async () => {
		const onSignOut = vi.fn();
		const root = render(Shell, props({ onSignOut }));
		act(() => account(root).focus());

		await press('ArrowDown');
		await press('End');
		await press('Enter');
		await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

		expect(onSignOut).toHaveBeenCalledOnce();
		expect(account(root).getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(account(root));
	});

	it('closes on Escape with nothing run, focus back on the button', async () => {
		const onSignOut = vi.fn();
		const root = render(Shell, props({ onSignOut }));
		act(() => account(root).focus());
		await press('ArrowDown');

		await press('Escape');

		expect(account(root).getAttribute('aria-expanded')).toBe('false');
		expect(onSignOut).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(account(root));
	});
});

describe('the shell around the page', () => {
	it('starts with a skip link to main, which takes focus', () => {
		const root = render(Shell, props());

		const skip = root.querySelector<HTMLAnchorElement>('.ds-shell > a.ds-site-nav-skip');
		const main = root.querySelector<HTMLElement>('main.ds-shell-main');
		expect(root.querySelector('.ds-shell')?.firstElementChild).toBe(skip);
		expect(skip?.textContent).toBe('Skip to content');
		expect(skip?.getAttribute('href')).toBe(`#${main?.id}`);
		expect(main?.getAttribute('tabindex')).toBe('-1');

		act(() => skip?.click());
		expect(document.activeElement).toBe(main);
	});

	it('names the organisation in the top bar and opens the donation page from it', () => {
		const root = render(Shell, props());

		expect(root.querySelector('.ds-topbar-title')?.textContent).toBe('Greenfield Food Bank');
		const open = root.querySelector('.ds-topbar-secondary a');
		expect(open?.textContent).toBe('Open donation page');
		expect(open?.getAttribute('href')).toBe('/donate');
	});

	it('draws no trail of its own in the top bar, which the page header owns', () => {
		// page-header-css's usage note: when the page header shows the trail, the top bar shows only
		// its title, or a nested page has two Breadcrumb navs and two back controls on a phone.
		const root = render(Shell, props());

		expect(root.querySelector('.ds-topbar .ds-crumbs, .ds-topbar .ds-topbar-narrow')).toBeNull();
	});

	it('draws the route-progress line only while it is told about a navigation', () => {
		const shell = mount(Shell, props());
		expect(shell.root.querySelector('.ds-route-progress')).toBeNull();

		shell.again(props({ navigating: true }));

		const line = shell.root.querySelector('.ds-topbar > .ds-route-progress');
		expect(line?.getAttribute('role')).toBe('progressbar');
		expect(line?.getAttribute('aria-valuenow')).toBe('5');
	});

	it('names the mark by where it goes, or the organisation in words where there is no logo', () => {
		const withLogo = render(Shell, props());
		expect(sidebar(withLogo).querySelector('.ds-shell-mark a')?.getAttribute('aria-label')).toBe(
			'Dashboard'
		);

		const without = render(Shell, props({ orgLogo: undefined }));
		expect(sidebar(without).querySelector('.ds-shell-mark a')?.textContent).toBe(
			'Greenfield Food Bank'
		);
		expect(sidebar(without).querySelector('.ds-shell-mark-rail')).toBeNull();
	});

	// base.css's `img { height: auto }` would draw the logo at its file's own height; the hook is
	// what ../../styles/adm.css sizes it by (../../styles/org-logo.spec.ts).
	it.each([
		[
			'the sidebar head',
			(root: HTMLElement) => sidebar(root).querySelector('.ds-shell-mark img'),
			'adm-logo'
		],
		[
			'the rail',
			(root: HTMLElement) => sidebar(root).querySelector('.ds-shell-mark-rail img'),
			'adm-logo adm-logo--rail'
		],
		[
			'the drawer head',
			(root: HTMLElement) => drawer(root).querySelector('.ds-shell-mark img'),
			'adm-logo'
		]
	])('draws the logo in %s on its size hook', (_, logo, hook) => {
		expect(logo(render(Shell, props()))?.getAttribute('class')).toBe(hook);
	});
});

describe('initials', () => {
	it('are the first letters of the first two words', () => {
		expect(initials('Amara Lindqvist')).toBe('AL');
		expect(initials('  Priya  Nair Rao ')).toBe('PN');
		expect(initials('Madonna')).toBe('M');
	});
});
