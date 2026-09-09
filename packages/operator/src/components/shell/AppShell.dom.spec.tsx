import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { AppShell, PanelRoute } from './AppShell.jsx';
import type { DestinationLinkProps } from './DestinationCell.jsx';

// the two things about the shell no consumer can assert for it: what the rail claims about where
// the reader is, and whether there is a way out at all. a surface can only see what its own screens
// do with the part.
//
// the rail marks one cell and announces one cell, and the two are not the same statement.
// ./DestinationCell.jsx takes the kind; this is the hop that hands it one, and a shell that drops
// the kind on the way puts `page` on a section with every gate in the repository still green.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

const DESTINATIONS = [
	{ label: 'Donation forms', short: 'Forms', href: '/admin/forms' },
	{ label: 'Donors', short: 'Donors', href: '/admin/donors' }
];

/** the rail cell reading `label`, by the word it draws at the wide width. */
function cell(root: HTMLElement, label: string): Element {
	const found = [...root.querySelectorAll('.adm-rail__cells > a')].find(
		(a) => a.querySelector('.adm-dest__full')?.textContent === label
	);
	if (found === undefined) throw new Error(`the rail drew no cell reading ${label}`);
	return found;
}

describe('a rail mounted into a document', () => {
	it('announces the destination the reader is at as the page', () => {
		const root = render(AppShell, {
			destinations: DESTINATIONS,
			current: { label: 'Donation forms', kind: 'page' as const }
		});

		expect(cell(root, 'Donation forms').getAttribute('aria-current')).toBe('page');
	});

	it('announces a destination that only contains the address as the current one of these', () => {
		const root = render(AppShell, {
			destinations: DESTINATIONS,
			current: { label: 'Donation forms', kind: 'section' as const }
		});

		expect(cell(root, 'Donation forms').getAttribute('aria-current')).toBe('true');
	});

	it('reads a bare word as the page, the looser of the two forms `current` takes', () => {
		// ./AppShell.jsx states both on the prop: a Whereabouts, or a bare word that is the label
		// and the page itself. packages/app hands the first from its pathname, and
		// packages/app/src/lib/admin/rail-navigates.dom.spec.tsx hands the second, so the looser
		// form is reached by a caller rather than only by this file.
		const root = render(AppShell, { destinations: DESTINATIONS, current: 'Donors' });

		expect(cell(root, 'Donors').getAttribute('aria-current')).toBe('page');
	});

	it('marks the section exactly as it marks the page, so only what is read out differs', () => {
		// the sheet draws the band off a bare `[aria-current]` and off `.is-current`, neither of
		// which reads the kind (packages/operator/src/styles/adm.css). a reader who can see the
		// rail must lose nothing to the distinction.
		const page = render(AppShell, {
			destinations: DESTINATIONS,
			current: { label: 'Donation forms', kind: 'page' as const }
		});
		const section = render(AppShell, {
			destinations: DESTINATIONS,
			current: { label: 'Donation forms', kind: 'section' as const }
		});

		expect(cell(section, 'Donation forms').className).toBe(cell(page, 'Donation forms').className);
		expect(cell(section, 'Donation forms').className).toContain('is-current');
	});

	it('marks no cell at all where the reader is in no destination', () => {
		// what a surface hands for an address under none of the destinations. the rail marks one of
		// them or none, and a cell marked here would announce itself as the page the reader is on.
		const root = render(AppShell, { destinations: DESTINATIONS, current: undefined });

		expect(root.querySelectorAll('.adm-rail__cells > a[aria-current]')).toHaveLength(0);
		expect(root.querySelectorAll('.adm-rail__cells > a.is-current')).toHaveLength(0);
	});

	it('claims nothing on the destinations the reader is not in', () => {
		const root = render(AppShell, {
			destinations: DESTINATIONS,
			current: { label: 'Donation forms', kind: 'section' as const }
		});

		expect(cell(root, 'Donors').hasAttribute('aria-current')).toBe(false);
	});
});

describe('the way out a shell draws', () => {
	/** the sign-out controls the shell put on the page, at both of the widths it draws one for. */
	function waysOut(root: HTMLElement): Element[] {
		return [...root.querySelectorAll('.adm-identity > .adm-signout, .adm-rail__foot > *')];
	}

	it('draws the specimen its own button, at both widths', () => {
		// a bare shell — no `signOut` override — is not mounted anywhere in this repository; the
		// one caller (packages/app/src/routes/_app.tsx) always hands one in. this asserts the
		// prop's own declared default regardless, since a prop with a fallback should draw one
		// that works.
		const root = render(AppShell, { destinations: DESTINATIONS });

		expect(waysOut(root).map((node) => node.textContent)).toEqual(['Sign out', 'Sign out']);
	});

	it('draws what a surface hands it, and the same node at both widths', () => {
		const root = render(AppShell, {
			destinations: DESTINATIONS,
			signOut: (
				<button className="adm-signout" type="submit">
					Leave
				</button>
			)
		});

		expect(waysOut(root).map((node) => node.textContent)).toEqual(['Leave', 'Leave']);
	});

	it('draws none at all where the surface states there is none', () => {
		// the console has no session to end, and `undefined` cannot say so — it is the request for the
		// specimen's button. the foot goes with the control rather than standing empty: the box draws
		// its own rule and its own padding, so an empty one is a divider under nothing.
		const root = render(AppShell, { destinations: DESTINATIONS, signOut: null });

		expect(waysOut(root)).toHaveLength(0);
		expect(root.querySelectorAll('button')).toHaveLength(0);
		expect(root.querySelector('.adm-rail__foot')).toBeNull();
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
		const root = render(AppShell, { destinations: DESTINATIONS, link: Handed });

		expect(root.querySelectorAll('.adm-rail__cells > a[data-handed]')).toHaveLength(
			DESTINATIONS.length
		);
	});
});

/** a panel route's own children, by the class each wears, in the order they are written. */
function rows(root: HTMLElement): string[] {
	return [...(root.firstElementChild?.children ?? [])].map((node) => node.className);
}

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
