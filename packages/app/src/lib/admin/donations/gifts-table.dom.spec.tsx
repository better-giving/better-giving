import { act, createElement, type ReactNode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLocation, useSearchParams } from 'react-router';
import { describe, expect, it, onTestFinished } from 'vitest';
import type { MatchFilter, MatchStatus } from '$lib/matching/status';
import { type GiftRow, GiftsTable, type GiftsTableProps } from './gifts-table';

// the gifts list's Match column and filter, drawn: the donor pinned first and linking to the gift,
// Match beside it, each status word on its rung with the employer under it, the dash where there is
// nothing to say, and the filter that reads and sets `match` on the address.
//
// not the browser spec AGENTS.md bans over a dashboard screen: nothing here reads a computed style.
// a class is named only for which rung a badge stands on.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(tree: ReactNode): HTMLElement {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

function gift(over: Partial<GiftRow> = {}): GiftRow {
	return {
		id: '019fb300-0000-7000-8000-000000000001',
		donorName: 'Maya Reyes',
		amount: '$150.00',
		receivedAt: '2026-11-12T16:12:00.000Z',
		source: null,
		note: null,
		noteStanding: 'private',
		status: 'completed',
		paidWith: 'Card',
		repeating: false,
		tribute: null,
		program: null,
		trackingId: null,
		match: { status: 'pack_sent', employer: 'Northwind Logistics' },
		...over
	} as GiftRow;
}

/** where the router stands, written into the page so a case can read the filter's navigation. */
function Address() {
	const { search } = useLocation();
	return createElement('output', { 'data-address': '' }, search);
}

function screen(props: Partial<GiftsTableProps> = {}): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/donations',
			Component: () =>
				createElement(
					'div',
					null,
					createElement(GiftsTable, {
						donations: [gift()],
						limit: 500,
						hasMore: false,
						match: null,
						...props
					}),
					createElement(Address)
				)
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin/donations'] }));
}

const heads = (root: HTMLElement) =>
	[...root.querySelectorAll('thead th')].map((th) => th.textContent);

function cell(root: HTMLElement, column: string, row = 0): HTMLElement {
	const at = heads(root).indexOf(column);
	const tr = root.querySelectorAll('tbody tr')[row];
	const found = tr?.children[at];
	if (!(found instanceof HTMLElement)) throw new Error(`no ${column} cell in row ${row}`);
	return found;
}

describe('the columns', () => {
	it('pins Donor first and puts Match beside it', () => {
		const root = screen();

		expect(heads(root).slice(0, 4)).toEqual(['Donor', 'Match', 'Received', 'Amount']);
		// the pinned column is the row's header.
		expect(cell(root, 'Donor').tagName).toBe('TH');
	});

	it('links the donor to the gift’s own screen', () => {
		const link = cell(screen(), 'Donor').querySelector('a');

		expect(link?.textContent).toBe('Maya Reyes');
		expect(link?.getAttribute('href')).toBe(
			'/admin/donations/019fb300-0000-7000-8000-000000000001'
		);
	});
});

describe('the Match cell', () => {
	it.each([
		['pack_sent', 'Details emailed', 'ds-badge ds-badge-neutral'],
		['reminded', 'Reminded', 'ds-badge ds-badge-neutral'],
		['filed', 'Filed', 'ds-badge ds-badge-warning'],
		['matched', 'Matched', 'ds-badge ds-badge-primary'],
		['voided', 'Voided', 'ds-badge ds-badge-outline'],
		['send_failed', 'Details email failed', 'ds-badge ds-badge-destructive']
	] as const satisfies readonly (readonly [MatchStatus, string, string])[])(
		'draws %s as its word on its rung, with the employer under it',
		(status, word, drawn) => {
			const root = screen({
				donations: [gift({ match: { status, employer: 'Northwind Logistics' } })]
			});
			const match = cell(root, 'Match');
			const badge = match.querySelector('.ds-badge');

			expect(badge?.textContent).toBe(word);
			expect(badge?.className).toBe(drawn);
			expect(match.querySelector('.adm-cell__under')?.textContent).toBe('Northwind Logistics');
		}
	);

	it('draws a word with nobody named as the word alone', () => {
		const match = cell(
			screen({ donations: [gift({ match: { status: 'filed', employer: null } })] }),
			'Match'
		);

		expect(match.textContent).toBe('Filed');
	});

	it.each([
		['nothing has happened and nobody is named', { status: null, employer: null }],
		['the gift predates matching', null]
	] as const)('dashes the cell in the muted ink where %s', (_, match) => {
		const cellOf = cell(screen({ donations: [gift({ match })] }), 'Match');

		expect(cellOf.textContent).toBe('—');
		expect(cellOf.classList.contains('adm-cell--empty')).toBe(true);
	});
});

describe('the filter', () => {
	const select = (root: HTMLElement) =>
		root.querySelector<HTMLSelectElement>('select[name="match"]');

	it('is a select labelled Match, offering every filter after Any', () => {
		const root = screen();
		const box = select(root);
		const label = root.querySelector(`label[for="${box?.id}"]`);

		expect(label?.textContent).toBe('Match');
		expect([...(box?.options ?? [])].map((o) => o.textContent)).toEqual([
			'Any',
			'No employer named',
			'Details emailed',
			'Reminded',
			'Filed',
			'Matched',
			'Voided',
			'Details email failed'
		]);
	});

	it('holds the filter the list was read under', () => {
		expect(select(screen({ match: 'reminded' }))?.value).toBe('reminded');
		expect(select(screen())?.value).toBe('');
	});

	it('puts a choice on the address, and drops the parameter for Any', async () => {
		const root = screen({ match: 'filed' });
		const box = select(root);
		if (box === null) throw new Error('no filter');
		const address = () => root.querySelector('[data-address]')?.textContent;

		await act(async () => {
			box.value = 'voided';
			box.dispatchEvent(new Event('change', { bubbles: true }));
		});
		expect(address()).toBe('?match=voided');

		await act(async () => {
			box.value = '';
			box.dispatchEvent(new Event('change', { bubbles: true }));
		});
		expect(address()).toBe('');
	});

	it('keeps the focus on the box across the navigation a choice makes', async () => {
		// the list read under the address's own filter, as the route reads it.
		function Listed() {
			const [search] = useSearchParams();
			return createElement(GiftsTable, {
				donations: [gift()],
				limit: 500,
				hasMore: false,
				match: (search.get('match') as MatchFilter | null) ?? null
			});
		}
		const Stub = createRoutesStub([{ path: '/admin/donations', Component: Listed }]);
		const root = mount(createElement(Stub, { initialEntries: ['/admin/donations'] }));
		const box = select(root);
		if (box === null) throw new Error('no filter');
		box.focus();

		await act(async () => {
			box.value = 'filed';
			box.dispatchEvent(new Event('change', { bubbles: true }));
		});

		expect(select(root)).toBe(box);
		expect(document.activeElement).toBe(box);
		expect(box.value).toBe('filed');
	});

	describe('applies a pick and never a step', () => {
		// the list read under the address's own filter, with every navigation the filter made logged.
		function picked() {
			const navigations: string[] = [];
			function Listed() {
				const { key, search } = useLocation();
				useEffect(() => {
					if (key !== 'default') navigations.push(search);
				}, [key, search]);
				return createElement(GiftsTable, {
					donations: [gift()],
					limit: 500,
					hasMore: false,
					match: (new URLSearchParams(search).get('match') as MatchFilter | null) ?? null
				});
			}
			const Stub = createRoutesStub([{ path: '/admin/donations', Component: Listed }]);
			const root = mount(createElement(Stub, { initialEntries: ['/admin/donations'] }));
			const box = select(root);
			if (box === null) throw new Error('no filter');
			box.focus();
			return { box, navigations };
		}

		// a key on the closed box as Chromium runs it: the keydown, then the value and its `change`
		// in that same task.
		const step = (box: HTMLSelectElement, to: string) =>
			act(async () => {
				box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
				box.value = to;
				box.dispatchEvent(new Event('change', { bubbles: true }));
			});
		const enter = (box: HTMLSelectElement) =>
			act(async () => {
				box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
			});
		// an option clicked, tapped or entered in the open list: a `change` with no key on the box.
		const pick = (box: HTMLSelectElement, to: string) =>
			act(async () => {
				box.value = to;
				box.dispatchEvent(new Event('change', { bubbles: true }));
			});
		// the task after a key, where its step has ended.
		const nextTask = () => act(() => new Promise((done) => setTimeout(done)));

		it('moves what the box shows on an arrow step, and navigates nowhere', async () => {
			const { box, navigations } = picked();

			await step(box, 'no_employer');
			await step(box, 'pack_sent');
			await nextTask();

			expect(box.value).toBe('pack_sent');
			expect(navigations).toEqual([]);
		});

		it('applies what the box shows on Enter, once, and keeps the focus on it', async () => {
			const { box, navigations } = picked();

			await step(box, 'no_employer');
			await step(box, 'pack_sent');
			await nextTask();
			await enter(box);
			await enter(box);

			expect(navigations).toEqual(['?match=pack_sent']);
			expect(document.activeElement).toBe(box);
			expect(box.value).toBe('pack_sent');
		});

		it('applies a pointer pick at once, even just after an arrow step', async () => {
			const { box, navigations } = picked();

			await step(box, 'no_employer');
			await nextTask();
			await pick(box, 'filed');

			expect(navigations).toEqual(['?match=filed']);
			expect(document.activeElement).toBe(box);
		});

		it('applies what the box shows when the focus leaves it after a step, and nothing after a pick', async () => {
			const stepped = picked();
			await step(stepped.box, 'reminded');
			await nextTask();
			await act(async () => stepped.box.blur());
			expect(stepped.navigations).toEqual(['?match=reminded']);

			const chosen = picked();
			await pick(chosen.box, 'voided');
			await act(async () => chosen.box.blur());
			expect(chosen.navigations).toEqual(['?match=voided']);
		});
	});

	it('says a filter matched nothing, and counts what it matched', () => {
		const none = screen({ donations: [], match: 'matched' });
		expect(none.querySelector('.adm-table__note')?.textContent).toBe('No gifts match this filter.');

		const two = screen({
			donations: [gift(), gift({ id: '019fb300-0000-7000-8000-000000000002' })],
			match: 'pack_sent'
		});
		expect(two.querySelector('.adm-tablecaption')?.textContent).toBe('2 gifts, newest first.');
	});

	it('says there are no gifts yet where no filter is on', () => {
		expect(screen({ donations: [] }).querySelector('.adm-table__note')?.textContent).toBe(
			'No gifts yet.'
		);
	});
});
