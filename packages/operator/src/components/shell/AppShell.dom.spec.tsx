import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '../render.testing';
import { AppShell, PanelRoute } from './AppShell.jsx';
import type { DestinationLinkProps } from './DestinationCell.jsx';

// the things about the shell no consumer can assert for it: what the rail claims about where the
// reader is, how its groups are divided, whether there is a way out and where it lands, what the
// panel holds, and the collapse the shell keeps for itself. a surface can only see what its own
// screens do with the part.
//
// the rail marks one cell and announces one cell, and the two are not the same statement.
// ./DestinationCell.jsx takes the kind; this is the hop that hands it one, and a shell that drops
// the kind on the way puts `page` on a section with every gate in the repository still green.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

const GROUPS = [
	{
		destinations: [
			{ label: 'Donation forms', short: 'Forms', href: '/admin/forms' },
			{ label: 'Donors', short: 'Donors', href: '/admin/donors' }
		]
	}
];

/** the rail cell reading `label`, by the word it draws at the wide width. */
function cell(root: HTMLElement, label: string): Element {
	const found = [...root.querySelectorAll('.adm-rail__cells > a')].find(
		(a) => a.querySelector('.adm-dest__full')?.textContent === label
	);
	if (found === undefined) throw new Error(`the rail drew no cell reading ${label}`);
	return found;
}

/** the rail's children in order, each as its first class and, for a cell, its full word. */
function railRun(root: HTMLElement): string[] {
	return [...(root.querySelector('.adm-rail__cells')?.children ?? [])].map((node) => {
		if (node.matches('a')) {
			const end = node.classList.contains('adm-dest--groupend') ? ' (end)' : '';
			return `${node.querySelector('.adm-dest__full')?.textContent}${end}`;
		}
		if (node.matches('hr')) return node.className;
		return `${node.className}: ${node.textContent}`;
	});
}

beforeEach(() => {
	localStorage.clear();
});

describe('a rail mounted into a document', () => {
	it('announces the destination the reader is at as the page', () => {
		const root = render(AppShell, {
			groups: GROUPS,
			current: { label: 'Donation forms', kind: 'page' as const }
		});

		expect(cell(root, 'Donation forms').getAttribute('aria-current')).toBe('page');
	});

	it('announces a destination that only contains the address as the current one of these', () => {
		const root = render(AppShell, {
			groups: GROUPS,
			current: { label: 'Donation forms', kind: 'section' as const }
		});

		expect(cell(root, 'Donation forms').getAttribute('aria-current')).toBe('true');
	});

	it('reads a bare word as the page, the looser of the two forms `current` takes', () => {
		// ./AppShell.jsx states both on the prop: a Whereabouts, or a bare word that is the label
		// and the page itself. packages/app hands the first from its pathname, and
		// packages/app/src/lib/admin/rail-navigates.dom.spec.tsx hands the second, so the looser
		// form is reached by a caller rather than only by this file.
		const root = render(AppShell, { groups: GROUPS, current: 'Donors' });

		expect(cell(root, 'Donors').getAttribute('aria-current')).toBe('page');
	});

	it('marks the section exactly as it marks the page, so only what is read out differs', () => {
		// the sheet draws the tint off a bare `[aria-current]` and off `.is-current`, neither of
		// which reads the kind (packages/operator/src/styles/adm.css). a reader who can see the
		// rail must lose nothing to the distinction.
		const page = render(AppShell, {
			groups: GROUPS,
			current: { label: 'Donation forms', kind: 'page' as const }
		});
		const section = render(AppShell, {
			groups: GROUPS,
			current: { label: 'Donation forms', kind: 'section' as const }
		});

		expect(cell(section, 'Donation forms').className).toBe(cell(page, 'Donation forms').className);
		expect(cell(section, 'Donation forms').className).toContain('is-current');
	});

	it('marks no cell at all where the reader is in no destination', () => {
		// what a surface hands for an address under none of the destinations. the rail marks one of
		// them or none, and a cell marked here would announce itself as the page the reader is on.
		const root = render(AppShell, { groups: GROUPS, current: undefined });

		expect(root.querySelectorAll('.adm-rail__cells > a[aria-current]')).toHaveLength(0);
		expect(root.querySelectorAll('.adm-rail__cells > a.is-current')).toHaveLength(0);
	});

	it('claims nothing on the destinations the reader is not in', () => {
		const root = render(AppShell, {
			groups: GROUPS,
			current: { label: 'Donation forms', kind: 'section' as const }
		});

		expect(cell(root, 'Donors').hasAttribute('aria-current')).toBe(false);
	});
});

describe('the groups a rail is divided into', () => {
	it('rules between plain groups, and draws nothing before the first', () => {
		const root = render(AppShell, {
			groups: [
				{ destinations: [{ label: 'Dashboard' }] },
				{ destinations: [{ label: 'Donation forms' }, { label: 'Donors' }] },
				{ destinations: [{ label: 'Members' }] }
			]
		});

		expect(railRun(root)).toEqual([
			'Dashboard',
			'adm-rail__rule',
			'Donation forms',
			'Donors',
			'adm-rail__rule',
			'Members'
		]);
	});

	it('stands a headed group under its heading, ends it, and rules nothing after it', () => {
		// the console's rail: the headed group's last entry carries the step, so the group after
		// it needs no rule of its own.
		const root = render(AppShell, {
			groups: [
				{ destinations: [{ label: 'Dashboard password' }, { label: 'Organisation' }] },
				{
					heading: 'Donation processor',
					destinations: [{ label: 'Stripe' }, { label: 'PayPal' }]
				},
				{ destinations: [{ label: 'Sites' }, { label: 'SMTP' }] }
			]
		});

		expect(railRun(root)).toEqual([
			'Dashboard password',
			'Organisation',
			'adm-rail__rule adm-rail__rule--group',
			'adm-rail__heading: Donation processor',
			'Stripe',
			'PayPal (end)',
			'Sites',
			'SMTP'
		]);
	});

	it('draws the heading as words, never as a link', () => {
		const root = render(AppShell, {
			groups: [
				{ destinations: [{ label: 'Organisation' }] },
				{ heading: 'Donation processor', destinations: [{ label: 'Stripe' }] }
			]
		});
		const heading = root.querySelector('.adm-rail__heading');

		expect(heading?.closest('a')).toBeNull();
		expect(heading?.querySelector('a')).toBeNull();
		expect(root.querySelectorAll('.adm-rail__cells > a')).toHaveLength(2);
	});

	it('draws a glyph mark as the glyph and a picture mark as an unnamed image', () => {
		const root = render(AppShell, {
			groups: [
				{
					destinations: [
						{ label: 'Organisation', mark: 'building-2' as const },
						{ label: 'Stripe', mark: { src: '/stripe.png' } }
					]
				}
			]
		});

		expect(cell(root, 'Organisation').querySelector('svg.adm-mark')).not.toBeNull();
		const image = cell(root, 'Stripe').querySelector('img.adm-mark');
		expect(image?.getAttribute('src')).toBe('/stripe.png');
		expect(image?.getAttribute('alt')).toBe('');
	});

	it('reads the status word out as part of the link', () => {
		const root = render(AppShell, {
			groups: [
				{
					destinations: [
						{
							label: 'Sites',
							status: { tone: 'note' as const, mark: 'circle-dashed' as const, label: 'Not set up' }
						}
					]
				}
			]
		});
		const link = cell(root, 'Sites');

		expect(link.querySelector('.adm-dest__status--note svg')?.getAttribute('aria-hidden')).toBe(
			'true'
		);
		expect(link.querySelector('.adm-vh')?.textContent).toBe(', Not set up');
	});
});

describe('the way out a shell draws', () => {
	/** the controls standing in the band and the foot, at both widths. */
	function waysOut(root: HTMLElement): Element[] {
		return [...root.querySelectorAll('.adm-identity > .adm-signout, .adm-rail__foot > *')];
	}

	it('draws the specimen its own button, at both widths', () => {
		// a bare shell — no `wayOut` override — is not mounted anywhere in this repository; the
		// one caller (packages/app/src/routes/_app.tsx) always hands one in. this asserts the
		// prop's own declared default regardless, since a prop with a fallback should draw one
		// that works.
		const root = render(AppShell, { groups: GROUPS });

		expect(waysOut(root).map((node) => node.textContent)).toEqual(['Sign out', 'Sign out']);
	});

	it('draws what a surface hands it, and the same node at both widths', () => {
		const root = render(AppShell, {
			groups: GROUPS,
			wayOut: (
				<button className="adm-signout" type="submit">
					Leave
				</button>
			)
		});

		expect(waysOut(root).map((node) => node.textContent)).toEqual(['Leave', 'Leave']);
	});

	it('stands a handed foot in the rail and keeps the way out in the band', () => {
		const root = render(AppShell, {
			groups: GROUPS,
			wayOut: (
				<a className="adm-signout" href="/close">
					Close console
				</a>
			),
			foot: <div className="adm-footaccount">Riverbank Trust's Account</div>
		});

		expect(root.querySelector('.adm-identity > .adm-signout')?.textContent).toBe('Close console');
		expect(root.querySelector('.adm-rail__foot')?.textContent).toBe("Riverbank Trust's Account");
	});

	it('draws no foot where neither a foot nor a way out is handed', () => {
		const root = render(AppShell, { groups: GROUPS, wayOut: null, foot: null });

		expect(waysOut(root)).toHaveLength(0);
		expect(root.querySelector('.adm-rail__foot')).toBeNull();
	});

	it('draws no foot where the way out is none and no foot is handed', () => {
		// the foot goes with the control rather than standing empty: the box draws its own rule and
		// its own padding, so an empty one is a divider under nothing.
		const root = render(AppShell, { groups: GROUPS, wayOut: null });

		expect(root.querySelector('.adm-rail__foot')).toBeNull();
	});
});

describe('the identity a shell draws', () => {
	/** the band's row and the rail head's, in that order. */
	function heads(root: HTMLElement): Element[] {
		return [...root.querySelectorAll('.adm-identity, .adm-rail__identity')];
	}

	it('leads the name with a link to the site in the band and the rail head, and prints no address', () => {
		const site = 'https://better-giving.riverside.workers.dev/admin';
		const root = render(AppShell, { groups: GROUPS, org: 'Riverbank Trust', site });

		for (const head of heads(root)) {
			const link = head.firstElementChild?.querySelector('a');
			expect(link?.getAttribute('href')).toBe(site);
			expect(link?.getAttribute('aria-label')).toBe('Open dashboard');
			expect(link?.getAttribute('title')).toBe(site);
			expect(link?.getAttribute('target')).toBe('_blank');
			expect(link?.getAttribute('rel')).toBe('noreferrer');
			expect(head.querySelector('.adm-identity__name')?.textContent).toBe('Riverbank Trust');
			expect(head.textContent).not.toContain(site);
		}
		expect(heads(root)).toHaveLength(2);
	});

	it('draws the name alone where no site is handed', () => {
		const root = render(AppShell, { groups: GROUPS, org: 'Riverbank Trust' });

		for (const head of heads(root)) {
			expect(head.querySelector('a')).toBeNull();
			expect(head.querySelector('.adm-identity__name')?.textContent).toBe('Riverbank Trust');
		}
		expect(root.querySelector('.adm-identity__sub')).toBeNull();
	});
});

describe('the panel a shell draws the page in', () => {
	it('draws the strip over the page where a head is handed, and the page under it', () => {
		const root = render(AppShell, {
			groups: GROUPS,
			head: <h1 className="adm-headstrip__title">Donors</h1>,
			children: <p>the list</p>
		});
		const main = root.querySelector('.adm-main');

		expect([...(main?.children ?? [])].map((node) => node.className)).toEqual([
			'adm-head',
			'adm-panelbody'
		]);
		expect(main?.querySelector('.adm-head > .adm-headstrip')?.textContent).toBe('Donors');
		expect(main?.querySelector('.adm-panelbody > p')?.textContent).toBe('the list');
	});

	it('draws no strip where no head is handed', () => {
		const root = render(AppShell, { groups: GROUPS, children: <h1>Donors</h1> });

		expect(root.querySelector('.adm-head')).toBeNull();
		expect(root.querySelector('.adm-main > .adm-panelbody > h1')).not.toBeNull();
	});
});

describe('the collapse a shell keeps for itself', () => {
	/** the shell's own element and its toggle. */
	function parts(root: HTMLElement) {
		const shell = root.querySelector('.adm-shell');
		const toggle = root.querySelector<HTMLButtonElement>('.adm-rail__toggle');
		if (shell === null || toggle === null) throw new Error('the shell drew no toggle');
		return { shell, toggle };
	}

	it('starts expanded, and the toggle collapses the rail and says so', () => {
		const root = render(AppShell, { groups: GROUPS });
		const { shell, toggle } = parts(root);

		expect(shell.classList.contains('adm-shell--collapsed')).toBe(false);
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(toggle.getAttribute('aria-label')).toBe('Collapse sidebar');

		act(() => toggle.click());

		expect(shell.classList.contains('adm-shell--collapsed')).toBe(true);
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(toggle.getAttribute('aria-label')).toBe('Expand sidebar');
		expect(localStorage.getItem('bg-operator-rail')).toBe('collapsed');

		act(() => toggle.click());

		expect(shell.classList.contains('adm-shell--collapsed')).toBe(false);
		expect(localStorage.getItem('bg-operator-rail')).toBe('expanded');
	});

	it('comes back collapsed where the choice was stored', () => {
		localStorage.setItem('bg-operator-rail', 'collapsed');
		const root = render(AppShell, { groups: GROUPS });

		expect(parts(root).shell.classList.contains('adm-shell--collapsed')).toBe(true);
	});

	it('draws and toggles where storage refuses every access', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('refused');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('refused');
		});
		const root = render(AppShell, { groups: GROUPS });
		const { shell, toggle } = parts(root);

		expect(shell.classList.contains('adm-shell--collapsed')).toBe(false);

		act(() => toggle.click());

		expect(shell.classList.contains('adm-shell--collapsed')).toBe(true);
	});
});

describe('the link a rail draws its cells as', () => {
	/** a surface's own link, standing in for the router link the two surfaces hand in. */
	const Handed = ({ children, ...rest }: DestinationLinkProps) => (
		<a {...rest} data-handed="yes">
			{children}
		</a>
	);

	it('is handed to every cell, so no destination is left a document load', () => {
		// the hop the rail makes: ./DestinationCell.jsx takes the link and this is the only place
		// that hands it one, so a shell that drops it on the way leaves a rail of full page loads
		// that renders identically.
		const root = render(AppShell, { groups: GROUPS, link: Handed });

		expect(root.querySelectorAll('.adm-rail__cells > a[data-handed]')).toHaveLength(2);
	});
});

/** a panel route's own children, by the class each wears, in the order they are written. */
function rows(root: HTMLElement): string[] {
	return [...(root.firstElementChild?.children ?? [])].map((node) => node.className);
}

describe('the landmark a panel route stands its page in', () => {
	it('is the main region, panelled or bare, so a reader can jump past the strips to it', () => {
		for (const bare of [false, true]) {
			const root = render(PanelRoute, {
				bare,
				bar: <span>better-giving</span>,
				children: <h1>Sign in</h1>
			});
			const main = root.querySelectorAll('main');

			expect([bare, main.length, main[0]?.textContent]).toEqual([bare, 1, 'Sign in']);
		}
	});
});

describe('the strips a panel route can carry', () => {
	it('draws none at all where the surface handed it none', () => {
		// the route is what it has always been: a panel in the middle of the window and nothing over
		// it. an empty strip is a row standing above the panel with nothing in it, and the panel is
		// centred in what is left under a bar that is not there.
		const root = render(PanelRoute, { children: <h1>Sign in</h1> });

		expect(root.querySelector('.adm-head')).toBeNull();
		expect(root.querySelector('.adm-footstrip')).toBeNull();
		expect(rows(root)).toEqual(['adm-panel']);
	});

	it('draws what a surface hands it, on the strip inside the head and above the panel', () => {
		// the head is the first row because it is written first — ../../styles/adm.css places
		// nothing by name, the same way the head is the bare shell's first row. a strip written
		// after the panel is the panel centred against the wrong half of the window.
		//
		// the two ends land on the strip and not on the band around it: the band is what a surface
		// stands a line under (./BareShell.jsx's `head` takes both), so ends handed straight into it
		// would be two more of those lines rather than the two ends of a row.
		const root = render(PanelRoute, {
			bar: (
				<>
					<span>better-giving</span>
					<span>v0.4.1</span>
				</>
			),
			children: <h1>Sign in</h1>
		});

		expect(rows(root)).toEqual(['adm-head', 'adm-panel']);
		expect(
			[...(root.querySelector('.adm-head > .adm-headstrip')?.children ?? [])].map(
				(node) => node.textContent
			)
		).toEqual(['better-giving', 'v0.4.1']);
	});

	it('draws a foot under the panel and nothing over it', () => {
		// the order is the whole of the assertion. a foot written before the panel would stand where
		// the head does, and ../../styles/adm.css tracks the rows by which strips are there rather
		// than by name — so a route carrying a foot alone hands the panel the row that grows and the
		// foot the one that does not.
		const root = render(PanelRoute, {
			foot: <a href="https://example.org">Elsewhere</a>,
			children: <h1>Sign in</h1>
		});

		expect(rows(root)).toEqual(['adm-panel', 'adm-footstrip']);
		expect(root.querySelector('.adm-footstrip')?.textContent).toBe('Elsewhere');
	});

	it('draws both, one at each edge of the panel', () => {
		const root = render(PanelRoute, {
			bar: <span>better-giving</span>,
			foot: (
				<>
					<a href="https://example.org/one">One</a>
					<a href="https://example.org/two">Two</a>
				</>
			),
			children: <h1>Sign in</h1>
		});

		expect(rows(root)).toEqual(['adm-head', 'adm-panel', 'adm-footstrip']);
		expect(
			[...(root.querySelector('.adm-footstrip')?.children ?? [])].map((node) => node.textContent)
		).toEqual(['One', 'Two']);
	});
});

describe('the panel a route draws, and the state that draws none', () => {
	it('stands the children on the page with no panel where the route is bare', () => {
		// the state a route with one control and nothing else takes: a box drawing a boundary around
		// a single press says nothing. what is asserted is the absence of the panel rather than the
		// presence of the class — a bare route that kept `.adm-panel` would draw the card this state
		// exists to drop, and the two classes sit on the same element.
		const root = render(PanelRoute, { bare: true, children: <button type="button">Press</button> });

		expect(root.querySelector('.adm-panel')).toBeNull();
		expect(rows(root)).toEqual(['adm-panelroute__bare']);
		expect(root.querySelector('.adm-panelroute__bare')?.textContent).toBe('Press');
	});

	it('keeps the row a bare route stands in, so both strips land where they do with a panel', () => {
		// ../../styles/adm.css tracks the rows by which strips are there and hands the middle one
		// the height that is left. a bare route that put its children straight into the grid would
		// be a child per row against a track list of three, and the strips would stop being at the
		// edges.
		const root = render(PanelRoute, {
			bare: true,
			bar: <span>better-giving</span>,
			foot: <a href="https://example.org">Elsewhere</a>,
			children: <button type="button">Press</button>
		});

		expect(rows(root)).toEqual(['adm-head', 'adm-panelroute__bare', 'adm-footstrip']);
	});

	it('draws the panel where the surface states nothing, which is every other route', () => {
		// absence is the panel and not the bare state: a route that stated neither is one carrying a
		// heading, prose and a run of controls, and those are what the box is for.
		const root = render(PanelRoute, { children: <h1>Sign in</h1> });

		expect(root.querySelector('.adm-panelroute__bare')).toBeNull();
		expect(rows(root)).toEqual(['adm-panel']);
	});
});
