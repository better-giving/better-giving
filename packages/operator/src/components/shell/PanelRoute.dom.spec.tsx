import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { PanelRoute } from './PanelRoute.jsx';

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
		// a route handed no strip is a panel in the middle of the window and nothing over it. an
		// empty strip is a row above the panel with nothing in it, and the panel is centred in what
		// is left under a bar that is not there.
		const root = render(PanelRoute, { children: <h1>Sign in</h1> });

		expect(root.querySelector('.adm-head')).toBeNull();
		expect(root.querySelector('.adm-footstrip')).toBeNull();
		expect(rows(root)).toEqual(['adm-panel']);
	});

	it('draws what a surface hands it, on the strip inside the head and above the panel', () => {
		// the head is the first row because it is written first — ../../styles/adm.css places
		// nothing by name. a strip written after the panel is the panel centred against the wrong
		// half of the window.
		//
		// the two ends land on the strip and not on the band around it: the band is what a surface
		// stands a line under, so ends handed straight into it would be two more of those lines
		// rather than the two ends of a row.
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
