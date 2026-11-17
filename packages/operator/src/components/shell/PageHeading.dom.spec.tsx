import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../render.testing';
import { PageHeading, type PageHeadingProps } from './PageHeading.jsx';

// a page's header on page-header-css: the title with its status on the first line, the crumbs, and
// More, which is drawn only where it has rows — under 40rem, for a page with secondary actions.

/** a window `width < 40rem` answers for, or not. */
function windowNarrow(narrow: boolean) {
	vi.stubGlobal(
		'matchMedia',
		(query: string) =>
			({
				matches: query === '(width < 40rem)' ? narrow : false,
				media: query,
				addEventListener: () => {},
				removeEventListener: () => {}
			}) as unknown as MediaQueryList
	);
}

const secondary: PageHeadingProps['secondary'] = [
	{ label: 'Export', href: '/admin/donations/export', internal: true },
	{ label: 'Public messages', href: '/admin/donations/messages', internal: true }
];
const primary = (
	<a className="ds-btn ds-btn-primary" href="/admin/donations/new">
		Add donation
	</a>
);
const more = (root: HTMLElement) => root.querySelector('button[aria-label="More actions"]');

describe('the page header’s title', () => {
	it('is the h1, with the status in a first-line box right after it', () => {
		windowNarrow(false);
		const root = render(PageHeading, {
			title: 'Maya Reyes, $250.00',
			status: <span className="ds-badge ds-badge-success">Completed</span>,
			description: '2026-11-14 · Card'
		});

		const titleRow = root.querySelector('.ds-page-title-row.ds-lead-row');
		expect(titleRow?.firstElementChild?.tagName).toBe('H1');
		expect(titleRow?.firstElementChild?.className).toBe('ds-page-title');
		expect(titleRow?.firstElementChild?.textContent).toBe('Maya Reyes, $250.00');
		const box = titleRow?.lastElementChild;
		expect(box?.className).toBe('ds-lead-1lh');
		expect(box?.textContent).toBe('Completed');
		expect(root.querySelector('.ds-page-desc')?.textContent).toBe('2026-11-14 · Card');
	});

	it('stands alone in its row without a status, and draws no actions block without actions', () => {
		windowNarrow(false);
		const root = render(PageHeading, { title: 'Dashboard' });

		expect(root.querySelector('.ds-page-title-row')?.children.length).toBe(1);
		expect(root.querySelector('.ds-page-actions')).toBeNull();
		expect(root.querySelector('.ds-page-desc')).toBeNull();
	});
});

describe('the page header’s crumbs', () => {
	it('link the pages above and end on this one as words', () => {
		windowNarrow(false);
		const root = render(PageHeading, {
			title: 'Maya Reyes, $250.00',
			crumbs: [
				{ href: '/admin/donations', label: 'Gifts' },
				{ href: '/admin/donations/1', label: 'Maya Reyes' }
			]
		});

		const trail = root.querySelector('nav.ds-crumbs');
		expect(trail?.getAttribute('aria-label')).toBe('Breadcrumb');
		expect(trail?.querySelector('a')?.getAttribute('href')).toBe('/admin/donations');
		const here = trail?.querySelector('[aria-current="page"]');
		expect(here?.tagName).toBe('SPAN');
		expect(here?.textContent).toBe('Maya Reyes');
	});
});

describe('More', () => {
	it('is not drawn on a wide window, where the secondary actions are buttons', () => {
		windowNarrow(false);
		const root = render(PageHeading, { title: 'Gifts', primary, secondary });

		expect(more(root)).toBeNull();
		expect([...root.querySelectorAll('.ds-ph-secondary')].map((b) => b.textContent)).toEqual([
			'Export',
			'Public messages'
		]);
		expect(root.querySelector('.ds-ph-primary')?.textContent).toBe('Add donation');
	});

	it('is drawn under 40rem for a page with secondary actions, holding them', async () => {
		windowNarrow(true);
		const root = render(PageHeading, { title: 'Gifts', primary, secondary });

		const button = more(root);
		expect(button?.getAttribute('aria-haspopup')).toBe('menu');
		expect(button?.className).toBe('ds-btn ds-btn-secondary ds-btn-icon');
		await act(async () => {
			button?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		});
		const rows = [...root.querySelectorAll('[role="menuitem"]')];
		expect(rows.map((item) => [item.textContent, item.getAttribute('href')])).toEqual([
			['Export', '/admin/donations/export'],
			['Public messages', '/admin/donations/messages']
		]);
	});

	it('is not drawn under 40rem for a page with no secondary actions', () => {
		windowNarrow(true);
		const root = render(PageHeading, { title: 'Gifts', primary });

		expect(more(root)).toBeNull();
	});
});
