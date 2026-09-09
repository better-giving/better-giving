import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { BareShell } from './BareShell.jsx';

// the one thing about this shell no consumer can assert for it: whether each strip it may stand is
// a row of the shell's own grid, written where it is read. ../../styles/adm.css tracks the shell by
// whether the foot is there and places nothing by name, so a strip written before the page takes
// the page's track and the page takes the strip's — an arrangement that renders as a footer under
// the head with the screen below it, and no gate reads a row order.
//
// the head a surface hands in whole is the same property at the other edge, and it is one row
// however many lines a surface puts on it: a band around them is what keeps the shell's tracks a
// count of what the shell draws rather than a count of what a caller handed it.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/** the shell's own children, by the class each wears, in the order they are written. */
function rows(root: HTMLElement): string[] {
	return [...(root.firstElementChild?.children ?? [])].map((node) => node.className);
}

describe('the strip a bare shell can stand at its foot', () => {
	it('draws none where the surface handed it none', () => {
		// an empty strip is a rule drawn under the screen with space beneath it, and the page stops
		// being the row that takes the leftover height.
		const root = render(BareShell, { children: <h1>Set up</h1> });

		expect(root.querySelector('.adm-footstrip')).toBeNull();
		expect(rows(root)).toEqual(['adm-topbar', 'adm-main']);
	});

	it('draws what a surface hands it, under the page and in the last row', () => {
		const root = render(BareShell, {
			foot: (
				<>
					<span>better-giving</span>
					<a href="https://example.org">Elsewhere</a>
				</>
			),
			children: <h1>Set up</h1>
		});

		expect(rows(root)).toEqual(['adm-topbar', 'adm-main', 'adm-footstrip']);
		expect(
			[...(root.querySelector('.adm-footstrip')?.children ?? [])].map((node) => node.textContent)
		).toEqual(['better-giving', 'Elsewhere']);
	});
});

describe('the head a bare shell stands over its page', () => {
	it('draws the run of stated facts where the surface handed no head of its own', () => {
		// absence is the bar of facts and not an empty band: a shell that read nothing stated as a
		// head would draw a rule over every screen ./TopBar.jsx is the head of.
		const root = render(BareShell, { children: <h1>Set up</h1> });

		expect(root.querySelector('.adm-head')).toBeNull();
		expect(root.querySelector('.adm-topbar')).not.toBeNull();
	});

	it('stands a head handed in whole as the one first row, whatever is on it', () => {
		// the band is one row and its lines are inside it, so a surface stating two of them does not
		// hand the shell two rows the track list has no room for — and the bar of facts is not drawn
		// beside it, because the two are alternatives rather than a head and a head.
		const root = render(BareShell, {
			head: (
				<>
					<div className="adm-headstrip">
						<span>A logo</span>
						<span>someone@example.org</span>
					</div>
					<p className="adm-headnote">Won&rsquo;t remember this account.</p>
				</>
			),
			foot: <span>better-giving</span>,
			children: <h1>Set up</h1>
		});

		expect(root.querySelector('.adm-topbar')).toBeNull();
		expect(rows(root)).toEqual(['adm-head', 'adm-main', 'adm-footstrip']);
		expect(
			[...(root.querySelector('.adm-head')?.children ?? [])].map((node) => node.className)
		).toEqual(['adm-headstrip', 'adm-headnote']);
	});
});
