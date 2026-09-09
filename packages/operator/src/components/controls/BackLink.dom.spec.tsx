import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { type BackLinkAnchorProps, BackLink } from './BackLink.jsx';

// what a back link is drawn as, and what it draws when a screen says nothing.
//
// the two look the same in the markup — the same class list, the same address, the same mark and
// word inside — and differ only in what happens on the press, which no assertion here can reach.
// so what is held here is the seam itself: whatever the screen hands in is what draws, and a
// screen that hands nothing still gets the plain anchor packages/gallery's specimens want.
// packages/app/src/lib/admin/back-navigates.dom.spec.tsx is where the press is asserted, on a
// surface that has a router.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/**
 * a surface's own link, standing in for the router link a dashboard hands in. it is a component
 * and not a tag name for the reason ./BackLink.jsx states: this package declares no router and a
 * spec here can only assert that whatever arrives is what the link is drawn as.
 */
const Handed = ({ children, ...rest }: BackLinkAnchorProps) => (
	<a {...rest} data-handed="yes">
		{children}
	</a>
);

/** the anchor the back link drew. */
function anchor(root: HTMLElement): Element {
	const found = root.querySelector('a');
	if (found === null) throw new Error('the back link drew no anchor');
	return found;
}

describe('the link a back link is drawn as', () => {
	it('is the one the screen handed in, carrying the address and the class list', () => {
		const root = render(BackLink, {
			children: 'Donation forms',
			href: '/admin/forms',
			link: Handed
		});
		const drawn = anchor(root);

		expect(drawn.getAttribute('data-handed')).toBe('yes');
		expect(drawn.getAttribute('href')).toBe('/admin/forms');
		expect(drawn.className).toBe('adm-back');
		expect(drawn.textContent).toBe('Donation forms');
	});

	it('carries a state a specimen pinned through to whatever is handed in', () => {
		const root = render(BackLink, { children: 'Donation forms', state: 'hover', link: Handed });

		expect(anchor(root).className).toBe('adm-back is-hover');
	});

	it('is a plain anchor where the screen hands none, which is what a specimen wants', () => {
		const root = render(BackLink, { children: 'Donation forms', href: '/admin/forms' });

		expect(anchor(root).getAttribute('data-handed')).toBeNull();
	});
});
