import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { type DestinationLinkProps, DestinationCell } from './DestinationCell.jsx';

// what a rail cell claims about where the reader is.
//
// the two claims look the same on the screen — the same ground, the same weight, the same accent
// edge — and differ only in what is read out, which is why nothing but a case can hold them apart.
// a cell hardcoding `page` tells a reader that the section a screen sits under is the screen, and
// then two cells in one rail both claim to be the address in the location bar.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/**
 * a surface's own link, standing in for the router link the two surfaces hand in. it is a
 * component and not a tag name for the reason ./DestinationCell.jsx states: this package declares
 * no router and a spec here can only assert that whatever arrives is what the cell draws.
 */
const Handed = ({ children, ...rest }: DestinationLinkProps) => (
	<a {...rest} data-handed="yes">
		{children}
	</a>
);

/** the anchor the cell drew. */
function cell(root: HTMLElement): Element {
	const found = root.querySelector('a');
	if (found === null) throw new Error('the cell drew no anchor');
	return found;
}

describe('a destination cell mounted into a document', () => {
	it('announces the address itself as the page', () => {
		const root = render(DestinationCell, { children: 'Forms', current: 'page' });

		expect(cell(root).getAttribute('aria-current')).toBe('page');
	});

	it('reads a bare true as the address itself, which is what a rail already passes', () => {
		// ./AppShell.jsx hands `label === current`, so the boolean has to keep meaning the page it
		// meant before the kind existed.
		const root = render(DestinationCell, { children: 'Forms', current: true });

		expect(cell(root).getAttribute('aria-current')).toBe('page');
	});

	it('announces a section that only contains the address as the current one of these', () => {
		const root = render(DestinationCell, { children: 'Forms', current: 'section' });

		expect(cell(root).getAttribute('aria-current')).toBe('true');
	});

	it('gives both kinds the same ground, so only what is announced differs', () => {
		const address = render(DestinationCell, { children: 'Forms', current: 'page' });
		const section = render(DestinationCell, { children: 'Forms', current: 'section' });

		expect(cell(section).className).toBe(cell(address).className);
		expect(cell(section).className).toContain('is-current');
	});

	it('claims nothing where the reader is somewhere else', () => {
		const root = render(DestinationCell, { children: 'Forms' });

		expect(cell(root).hasAttribute('aria-current')).toBe(false);
	});
});

describe('the link a destination cell is drawn as', () => {
	it('is the one the surface handed in, carrying the address and the claim', () => {
		const root = render(DestinationCell, {
			children: 'Forms',
			href: '/admin/forms',
			current: 'section',
			link: Handed
		});
		const drawn = cell(root);

		expect(drawn.getAttribute('data-handed')).toBe('yes');
		expect(drawn.getAttribute('href')).toBe('/admin/forms');
		expect(drawn.getAttribute('aria-current')).toBe('true');
		expect(drawn.className).toContain('is-current');
	});

	it('is a plain anchor where the surface hands none, which is what a specimen wants', () => {
		const root = render(DestinationCell, { children: 'Forms', href: '/admin/forms' });

		expect(cell(root).getAttribute('data-handed')).toBeNull();
	});
});
