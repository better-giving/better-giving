import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { type BreadcrumbsAnchorProps, Breadcrumbs } from './Breadcrumbs.jsx';

// what a trail draws: every page above this one as a link, this one as words, and nothing at all
// where there is no page above. the press itself is a surface's to assert, on one with a router —
// what is held here is the markup and the seam: whatever link the screen hands in is what draws, and
// a screen that hands nothing still gets the plain anchor packages/gallery's specimens want.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/** a surface's own link, standing in for the router link a dashboard hands in. */
const Handed = ({ children, ...rest }: BreadcrumbsAnchorProps) => (
	<a {...rest} data-handed="yes">
		{children}
	</a>
);

const TRAIL = [
	{ href: '/admin/forms', label: 'Donation forms' },
	{ href: '/admin/forms/winter', label: 'Winter appeal' },
	{ href: '/admin/forms/winter/sites', label: 'Sites' }
];

/** the items of the list the trail drew, in order. */
function items(root: HTMLElement): HTMLElement[] {
	const list = root.querySelector('nav > ol');
	if (list === null) throw new Error('the trail drew no list');
	return [...list.querySelectorAll<HTMLElement>(':scope > li')];
}

describe('a breadcrumb trail', () => {
	it('is a navigation landmark named for what it is', () => {
		const root = render(Breadcrumbs, { items: TRAIL });

		expect(root.querySelector('nav')?.getAttribute('aria-label')).toBe('Breadcrumb');
		expect(items(root)).toHaveLength(3);
	});

	it('draws the last item as the current page, as words rather than a link', () => {
		const root = render(Breadcrumbs, { items: TRAIL, link: Handed });
		const last = items(root).at(-1);

		expect(last?.querySelector('a')).toBeNull();
		expect(last?.querySelector('[aria-current="page"]')?.textContent).toBe('Sites');
	});

	it('draws every earlier item through the link the screen handed in', () => {
		const root = render(Breadcrumbs, { items: TRAIL, link: Handed });
		const links = items(root)
			.slice(0, -1)
			.map((item) => item.querySelector('a'));

		expect(links.map((a) => a?.getAttribute('data-handed'))).toEqual(['yes', 'yes']);
		expect(links.map((a) => a?.getAttribute('href'))).toEqual([
			'/admin/forms',
			'/admin/forms/winter'
		]);
		expect(links.map((a) => a?.textContent)).toEqual(['Donation forms', 'Winter appeal']);
		expect(links.map((a) => a?.hasAttribute('aria-current'))).toEqual([false, false]);
	});

	it('draws a plain anchor where the screen hands none', () => {
		const root = render(Breadcrumbs, { items: TRAIL });

		expect(items(root)[0]?.querySelector('a')?.getAttribute('data-handed')).toBeNull();
	});

	it('keeps every separator out of the accessibility tree', () => {
		const root = render(Breadcrumbs, { items: TRAIL });
		const marks = [...root.querySelectorAll('svg')];

		expect(marks).toHaveLength(2);
		expect(marks.every((mark) => mark.getAttribute('aria-hidden') === 'true')).toBe(true);
	});

	it('pins a state on the link to the page directly above, and only there', () => {
		const root = render(Breadcrumbs, { items: TRAIL, state: 'hover' });
		const links = [...root.querySelectorAll('a')];

		expect(links.map((a) => a.classList.contains('is-hover'))).toEqual([false, true]);
	});

	it.each([
		['no items', []],
		['one item', [{ href: '/admin/forms', label: 'Donation forms' }]]
	])('draws nothing with %s', (_, trail) => {
		const root = render(Breadcrumbs, { items: trail });

		expect(root.innerHTML).toBe('');
	});
});
