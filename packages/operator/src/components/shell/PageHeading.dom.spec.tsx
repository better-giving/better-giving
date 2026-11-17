import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { stripComments } from '../../styles/raw-values';
import { ruleOf, rulesIn } from '../../styles/sheet-rule.testing';
import { render } from '../render.testing';
import { PageHeading, type PageHeadingProps } from './PageHeading.jsx';

// a page's header in page-header-css's two shapes: a page with a sidebar entry has a hidden h1 and
// at most a row of actions; a nested page's h1 is the last item of its trail, with the status on
// its first line. More is drawn only where it has rows — under 40rem, for a page with secondary
// actions.

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
const giftCrumbs = [
	{ href: '/admin/donations', label: 'Gifts' },
	{ href: '/admin/donations/1', label: 'Maya Reyes' }
];

describe('a page with a sidebar entry', () => {
	it('is its hidden h1 alone without actions, whatever status or line it is handed', () => {
		windowNarrow(false);
		const root = render(PageHeading, {
			title: 'Dashboard',
			status: <span className="ds-badge ds-badge-success">Live</span>,
			description: 'Giving this month, and the year behind it.'
		});

		expect([...root.children].map((child) => child.outerHTML)).toEqual([
			'<h1 class="ds-sr-only" tabindex="-1">Dashboard</h1>'
		]);
	});

	it('draws one row holding only the actions under the hidden h1', () => {
		windowNarrow(false);
		const root = render(PageHeading, { title: 'Gifts', primary, secondary });

		const header = root.querySelector('header.ds-page-header');
		expect([...(header?.children ?? [])].map((child) => child.className)).toEqual([
			'ds-sr-only',
			'ds-page-header-row'
		]);
		expect(header?.firstElementChild?.tagName).toBe('H1');
		expect(header?.firstElementChild?.textContent).toBe('Gifts');
		const row = root.querySelector('.ds-page-header-row');
		expect([...(row?.children ?? [])].map((child) => child.className)).toEqual(['ds-page-actions']);
		expect(root.querySelector('nav, [aria-current], .ds-page-title, .ds-page-desc')).toBeNull();
	});

	it('is what a single crumb draws, which names no page above', () => {
		windowNarrow(false);
		const root = render(PageHeading, {
			title: 'Notifications',
			crumbs: [{ href: '/admin/settings/notifications', label: 'Notifications' }]
		});

		expect(root.querySelector('nav')).toBeNull();
		expect(root.querySelector('h1')?.className).toBe('ds-sr-only');
	});

	it('takes focus from script and is no Tab stop', () => {
		windowNarrow(false);
		const root = render(PageHeading, { title: 'Campaigns' });

		const title = root.querySelector('h1');
		expect(title?.getAttribute('tabindex')).toBe('-1');
		act(() => title?.focus());
		expect(document.activeElement).toBe(title);
	});
});

describe('a nested page', () => {
	it('is the trail’s last item: the h1 is the current crumb, with the status right after it', () => {
		windowNarrow(false);
		const root = render(PageHeading, {
			title: 'Maya Reyes, $250.00',
			status: <span className="ds-badge ds-badge-success">Completed</span>,
			description: '2026-11-14 · Card',
			crumbs: giftCrumbs
		});

		const text = root.querySelector('.ds-page-header-row > .ds-page-header-text');
		expect([...(text?.children ?? [])].map((child) => child.className)).toEqual([
			'ds-crumbs ds-crumbs-heading',
			'ds-page-desc'
		]);
		const trail = text?.querySelector('nav');
		expect(trail?.getAttribute('aria-label')).toBe('Breadcrumb');
		const items = [...(trail?.querySelectorAll('ol > li') ?? [])];
		expect(items.length).toBe(2);

		const titleRow = items[1]?.firstElementChild;
		expect(titleRow?.className).toBe('ds-page-title-row ds-lead-row');
		const title = titleRow?.firstElementChild;
		expect(title?.tagName).toBe('H1');
		expect(title?.className).toBe('ds-page-title');
		expect(title?.getAttribute('aria-current')).toBe('page');
		expect(title?.textContent).toBe('Maya Reyes, $250.00');
		expect(titleRow?.lastElementChild?.className).toBe('ds-lead-1lh');
		expect(titleRow?.lastElementChild?.textContent).toBe('Completed');
		expect(root.querySelector('.ds-page-desc')?.textContent).toBe('2026-11-14 · Card');
		expect(root.querySelectorAll('h1, [aria-current]').length).toBe(1);
	});

	it('links each page above, its chevron an svg directly in the li, and never lists this page', () => {
		windowNarrow(false);
		const root = render(PageHeading, {
			title: 'Maya Reyes, $250.00',
			crumbs: [
				{ href: '/admin', label: 'Dashboard' },
				{ href: '/admin/donations', label: 'Gifts' },
				{ href: '/admin/donations/1', label: 'Maya Reyes' }
			]
		});

		const parents = [...root.querySelectorAll('nav.ds-crumbs-heading li:not(:last-child)')];
		expect(
			parents.map((item) => [...item.children].map((child) => child.tagName.toLowerCase()))
		).toEqual([
			['a', 'svg'],
			['a', 'svg']
		]);
		expect(parents.map((item) => item.querySelector('a')?.getAttribute('href'))).toEqual([
			'/admin',
			'/admin/donations'
		]);
		expect(root.querySelector('a[href="/admin/donations/1"]')).toBeNull();
	});

	it('takes focus from script and is no Tab stop', () => {
		windowNarrow(false);
		const root = render(PageHeading, { title: 'Maya Reyes, $250.00', crumbs: giftCrumbs });

		const title = root.querySelector('h1');
		expect(title?.getAttribute('tabindex')).toBe('-1');
		act(() => title?.focus());
		expect(document.activeElement).toBe(title);
	});

	it('keeps its actions beside the trail block, and draws none without them', () => {
		windowNarrow(false);
		const withActions = render(PageHeading, {
			title: 'Maya Reyes, $250.00',
			crumbs: giftCrumbs,
			primary,
			secondary
		});
		const row = withActions.querySelector('.ds-page-header-row');
		expect([...(row?.children ?? [])].map((child) => child.className)).toEqual([
			'ds-page-header-text',
			'ds-page-actions'
		]);

		const bare = render(PageHeading, { title: 'Maya Reyes, $250.00', crumbs: giftCrumbs });
		expect(bare.querySelector('.ds-page-actions')).toBeNull();
		expect(bare.querySelector('.ds-page-desc')).toBeNull();
		expect(bare.querySelector('.ds-page-title-row')?.children.length).toBe(1);
	});
});

/** a copied registry sheet with its comments blanked. */
const registrySheet = (name: string) =>
	stripComments(
		readFileSync(
			join(dirname(fileURLToPath(import.meta.url)), `../../registry/styles/${name}`),
			'utf8'
		)
	);

// the pool lays nothing out (../../../vitest.config.ts), so where the badge lands is the markup
// above and the rules lead-css, top-bar-css and page-header-css write for it.
describe('a nested page’s title long enough to wrap, with a status', () => {
	const lead = registrySheet('lead-css.css');
	const header = registrySheet('page-header-css.css');
	const topBar = registrySheet('top-bar-css.css');
	const longTitle =
		'Margaret Okonkwo-Fitzgerald, $1,250.00 monthly toward the Riverside Shelter winter appeal';

	it('keeps the whole title in the h1 and the badge in a one-line box beside it, not inside it', () => {
		windowNarrow(true);
		const root = render(PageHeading, {
			title: longTitle,
			status: <span className="ds-badge ds-badge-warning">Pending</span>,
			crumbs: [
				{ href: '/admin/donations', label: 'Gifts' },
				{ href: '/admin/donations/2', label: 'Margaret Okonkwo-Fitzgerald' }
			]
		});

		const row = root.querySelector('nav.ds-crumbs-heading li:last-child > .ds-page-title-row');
		expect(row?.classList.contains('ds-lead-row')).toBe(true);
		expect([...(row?.children ?? [])].map((child) => child.className)).toEqual([
			'ds-page-title',
			'ds-lead-1lh'
		]);
		expect(row?.querySelector('h1')?.textContent).toBe(longTitle);
		expect(row?.querySelector('h1 .ds-badge')).toBeNull();
		expect(row?.querySelector('.ds-lead-1lh > .ds-badge')?.textContent).toBe('Pending');
	});

	it('wraps the title inside its own box rather than wrapping the row, so the badge stays on line one', () => {
		// the row never wraps: a wrapped row would drop the badge under the title's last line.
		const rowRules = [...rulesIn(lead), ...rulesIn(header)].filter(({ selector }) =>
			/\.ds-(lead|page-title)-row$/.test(selector)
		);
		expect(rowRules.length).toBeGreaterThan(0);
		expect(rowRules.filter(({ stated }) => stated.has('flex-wrap'))).toEqual([]);

		const row = ruleOf(lead, '.ds-lead-row');
		expect(row.get('display')).toBe('flex');
		expect(row.get('align-items')).toBe('start');

		// the title gives way and breaks inside itself, at any glyph if it must.
		expect(ruleOf(header, '.ds-page-title-row > .ds-page-title').get('flex')).toBe('0 1 auto');
		const title = ruleOf(header, '.ds-page-title');
		expect(title.get('min-inline-size')).toBe('0');
		expect(title.get('overflow-wrap')).toBe('anywhere');

		// the trail item holding the row is a block that wraps anywhere, so nothing in it is cut.
		const item = ruleOf(topBar, '.ds-crumbs-heading li:last-child');
		expect(item.get('display')).toBe('block');
		expect(item.get('overflow-wrap')).toBe('anywhere');

		// the badge's box never shrinks and is one of the title's lines tall, at the row's start.
		const box = ruleOf(lead, '.ds-lead-1lh');
		expect(box.get('flex')).toBe('none');
		expect(box.get('block-size')).toBe('1lh');
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
