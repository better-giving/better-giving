import { act, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { Mark, type MarkName } from '../status/Mark.jsx';
import { type Column, DataTable, type Row } from './DataTable.jsx';

// what a table is besides the values in it: a shape that does not move between one page of results
// and the next, a name a reader arriving inside it is given, and a reading per cell that comes from
// what is in the cell rather than from the column it sits under.
//
// none of that is visible to this pool and none of it needs to be — ../../../vitest.config.ts renders
// into happy-dom, which lays nothing out. what is asserted here is the markup that decides it: the
// group of columns the widths are stated on, the name on the `<table>` element, and the class each
// cell wears. the sheet that draws them is ../../styles/adm.css; nothing checks the two stay in
// step any more.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/** three columns of the gifts table, which is the one screen whose first column has a kind. */
const COLUMNS: readonly Column[] = [
	{ key: 'received', label: 'Received', kind: 'date', width: '12%' },
	{ key: 'donor', label: 'Donor', width: '56%' },
	{ key: 'amount', label: 'Amount', kind: 'money', width: '32%' }
];

/** two gifts, each carrying the id its screen would key it by. */
const GIFTS: readonly Row[] = [
	{
		id: 'gift-ada',
		cells: { received: '2026-07-04', donor: 'Ada Lovelace', amount: '£20.00' }
	},
	{
		id: 'gift-grace',
		cells: { received: '2026-07-03', donor: 'Grace Hopper', amount: '£5.00' }
	}
];

/** the rows the table drew, as elements a case can keep hold of across a re-render. */
function bodyRows(root: HTMLElement): Element[] {
	return [...root.querySelectorAll('tbody tr')];
}

/** one row's cells, its header cell first, in the order they are drawn. */
function cellsOf(row: Element | undefined): Element[] {
	// a row the table did not draw is the case's own claim being wrong, and reading three blanks
	// off it would pass against a table that is not there.
	if (row === undefined) throw new Error('the table drew no row there');
	return [...row.children];
}

/** the classes one row's cells wear, in column order, with `null` for a cell wearing none. */
function readings(root: HTMLElement, row: number): (string | null)[] {
	return cellsOf(bodyRows(root)[row]).map((cell) => cell.getAttribute('class'));
}

/** the gifts table with its rows in a state, so a case can put two of them in each other's place. */
function Reorderable({ rows }: { rows: readonly Row[] }) {
	const [order, setOrder] = useState(rows);
	return (
		<>
			<button type="button" onClick={() => setOrder((o) => [...o].toReversed())}>
				swap
			</button>
			<DataTable caption="2 gifts, newest first." columns={COLUMNS} rows={order} />
		</>
	);
}

describe('a table mounted into a document', () => {
	it('states each column’s share, on a column of its own ahead of every row', () => {
		// without this every column is sized from whatever the rows on this page happen to hold,
		// so a figure column lands somewhere else on the next page of results. the group stands
		// ahead of the row groups, which is what ../../styles/adm.css's first-row rule is written
		// against.
		const root = render(DataTable, {
			caption: '2 gifts, newest first.',
			columns: COLUMNS,
			rows: GIFTS
		});
		const table = root.querySelector('table');

		expect(table?.firstElementChild?.tagName).toBe('COLGROUP');
		expect(
			[...root.querySelectorAll('colgroup col')].map((col) =>
				(col as HTMLElement).style.getPropertyValue('inline-size')
			)
		).toEqual(['12%', '56%', '32%']);
	});

	it('names the table by the sentence that counts its rows, and not only the plane', () => {
		// the plane is a region a reader reaches by tabbing to the scroll box; the table is reached
		// by entering it, and a name on the region alone is nothing at all to a reader who arrived
		// the second way.
		const root = render(DataTable, {
			caption: '2 gifts, newest first.',
			captionId: 'gifts-caption',
			columns: COLUMNS,
			rows: GIFTS
		});

		expect(root.querySelector('table')?.getAttribute('aria-labelledby')).toBe('gifts-caption');
		expect(root.querySelector('#gifts-caption')?.textContent).toBe('2 gifts, newest first.');
	});

	it('names the table by the screen’s own noun where there is nothing to count', () => {
		// no caption is drawn with no rows, so there is no element to point at — the word the
		// screen calls its list is what the table is named, the same one the plane takes.
		const root = render(DataTable, {
			caption: 'Gifts',
			columns: COLUMNS,
			rows: [],
			empty: 'No gifts yet.'
		});

		expect(root.querySelector('table')?.getAttribute('aria-label')).toBe('Gifts');
		expect(root.querySelector('table')?.getAttribute('aria-labelledby')).toBeNull();
	});

	it('leaves the plane a named section, which is what makes it a region', () => {
		// the equivalence the plane rests on — a section with an accessible name is a region, so it
		// needs no `role` — is argued in the component, and the two halves of it come apart in
		// either direction: a `role` added back states the region twice, and a name dropped leaves a
		// section exposed as nothing at all. this pool computes no accessibility tree, so what is
		// pinned is the markup the equivalence is made of.
		const counted = render(DataTable, {
			caption: '2 gifts, newest first.',
			captionId: 'gifts-caption',
			columns: COLUMNS,
			rows: GIFTS
		});
		const plane = counted.querySelector('.adm-plane');

		expect(plane?.tagName).toBe('SECTION');
		expect(plane?.getAttribute('role')).toBeNull();
		expect(plane?.getAttribute('aria-labelledby')).toBe('gifts-caption');

		// the other half of the same name: with nothing to count no caption is drawn, so the plane
		// takes the screen's own noun the way the table does.
		const empty = render(DataTable, {
			caption: 'Gifts',
			columns: COLUMNS,
			rows: [],
			empty: 'No gifts yet.'
		});
		const emptyPlane = empty.querySelector('.adm-plane');

		expect(emptyPlane?.getAttribute('aria-label')).toBe('Gifts');
		expect(emptyPlane?.getAttribute('aria-labelledby')).toBeNull();
	});

	it('reads the first cell of a row as its column, the way the head is read', () => {
		// the first cell is the row's header and what the plane pins, and it is still a cell of its
		// column: a date column set as a date in the head and as prose down the body is one column
		// drawn two ways.
		const root = render(DataTable, {
			caption: '2 gifts, newest first.',
			columns: COLUMNS,
			rows: GIFTS
		});

		expect(root.querySelector('thead th')?.getAttribute('class')).toBe('adm-cell--date');
		expect(readings(root, 0)).toEqual(['adm-cell--date', null, 'adm-cell--money']);
	});

	it('draws a row whose identity is missing the way it draws any absent cell', () => {
		// the pinned column is what a reader identifies a row by, so a header cell left blank beside
		// a row of real figures reads as a rendering failure rather than as a record with no name.
		const root = render(DataTable, {
			caption: '1 gift, newest first.',
			columns: COLUMNS,
			rows: [{ id: 'gift-undated', cells: { donor: 'Ada Lovelace', amount: '£20.00' } }]
		});
		const header = cellsOf(bodyRows(root)[0])[0];

		expect(header?.textContent).toBe('—');
		expect(header?.getAttribute('class')).toBe('adm-cell--date adm-cell--empty');
	});

	it('leaves a missing identity blank where its column never dashes', () => {
		// `neverDash` is the column's word about what an absent value looks like, and the row's
		// header is a cell of that column like any other.
		const columns: readonly Column[] = [
			{ key: 'received', label: 'Received', kind: 'date', width: '12%', neverDash: true },
			...COLUMNS.slice(1)
		];
		const root = render(DataTable, {
			caption: '1 gift, newest first.',
			columns,
			rows: [{ id: 'gift-undated', cells: { donor: 'Ada Lovelace', amount: '£20.00' } }]
		});
		const header = cellsOf(bodyRows(root)[0])[0];

		expect(header?.textContent).toBe('');
		expect(header?.getAttribute('class')).toBe('adm-cell--date adm-cell--empty');
	});

	it('takes a cell’s own reading over its column’s', () => {
		// the two readings a cell in this repository states for itself, in the two columns that hold
		// them: a commitment still collecting has no date to give its date column, and a repeating
		// gift's amount is a figure with a word under it rather than a figure.
		//
		// prose is the reading that wears nothing, and `noted` wears the money reading as well as
		// its own — the figure is still read as money, which is what keeps it in the column.
		const root = render(DataTable, {
			caption: '1 gift, newest first.',
			columns: COLUMNS,
			rows: [
				{
					id: 'gift-ada',
					cells: {
						received: { reading: 'prose', value: 'Not scheduled yet' },
						donor: 'Ada Lovelace',
						amount: {
							reading: 'noted',
							value: (
								<>
									£20.00 <span>Repeating</span>
								</>
							)
						}
					}
				}
			]
		});

		expect(readings(root, 0)).toEqual([null, null, 'adm-cell--money adm-cell--noted']);
	});

	it('keeps every amount reading as money, note or no note', () => {
		// the defect the noted reading exists for. read as prose instead, a repeating gift's amount
		// is start-aligned and the amounts under it are end-aligned, so the figures stop lining up
		// down the column an operator is scanning.
		const root = render(DataTable, {
			caption: '2 gifts, newest first.',
			columns: COLUMNS,
			rows: [
				{
					id: 'gift-ada',
					cells: {
						received: '2026-07-04',
						donor: 'Ada Lovelace',
						amount: {
							reading: 'noted',
							value: (
								<>
									£20.00 <span>Repeating</span>
								</>
							)
						}
					}
				},
				...GIFTS.slice(1)
			]
		});

		expect(
			bodyRows(root).map((row) => cellsOf(row)[2]?.classList.contains('adm-cell--money'))
		).toEqual([true, true]);
	});

	it('moves a row rather than rewriting whatever row is in its place', () => {
		// keyed by position, react keeps the first `<tr>` where it is and writes the second row's
		// values into it — so a link, a focus or a selection in that row now belongs to a different
		// gift, and nothing about the markup says so.
		const root = render(Reorderable, { rows: GIFTS });
		const ada = bodyRows(root)[0];
		const read = ada?.textContent;
		const swap = root.querySelector('button');

		act(() => (swap as HTMLButtonElement).click());

		expect(bodyRows(root)[1]).toBe(ada);
		expect(ada?.textContent).toBe(read);
	});
});

/** the two counted planes a screen draws when it reports on two lists at once. */
function TwoPlanes() {
	return (
		<>
			<DataTable caption="2 gifts, newest first." columns={COLUMNS} rows={GIFTS} />
			<DataTable caption="1 commitment, newest first." columns={COLUMNS} rows={GIFTS.slice(0, 1)} />
		</>
	);
}

describe('two counted tables on one page', () => {
	it('names each one by its own caption', () => {
		// the caption paragraph is what a counted table is named by, so two tables sharing one id
		// emit it twice and the second table's name resolves to the first table's sentence — a
		// reader entering the commitments is told they are in the gifts.
		const root = render(TwoPlanes, {});
		const tables = [...root.querySelectorAll('table')];
		const named = tables.map((table) => {
			const id = table.getAttribute('aria-labelledby');
			return id === null ? null : root.querySelector(`#${id}`)?.textContent;
		});

		expect(new Set(tables.map((table) => table.getAttribute('aria-labelledby'))).size).toBe(2);
		expect(named).toEqual(['2 gifts, newest first.', '1 commitment, newest first.']);
	});
});

/** the donor screen's heads: three a press sorts by, one that does not sort at all. */
const SORTABLE: readonly Column[] = [
	{ key: 'name', label: 'Name', width: '40%', sort: { href: '?sort=name', dir: null } },
	{
		key: 'gifts',
		label: 'Gifts',
		kind: 'count',
		width: '16%',
		sort: { href: '?sort=gifts', dir: null }
	},
	{
		key: 'given',
		label: 'Given',
		kind: 'money',
		width: '24%',
		sort: { href: '?sort=given&dir=asc', dir: 'descending' }
	},
	{ key: 'added', label: 'Added', kind: 'date', width: '20%' }
];

/** two donors, so the count column has figures under its head as well as a head. */
const DONORS: readonly Row[] = [
	{
		id: 'dr_ada',
		cells: { name: 'Ada Lovelace', gifts: '11', given: '£240.00', added: '4 Feb 2026' }
	},
	{
		id: 'dr_grace',
		cells: { name: 'Grace Hopper', gifts: '2', given: '£35.00', added: '3 Feb 2026' }
	}
];

/** the heads the table drew, in column order. */
function heads(root: HTMLElement): Element[] {
	return [...root.querySelectorAll('thead th')];
}

/** the svg one mark draws, so a case names the direction it expects rather than lucide's markup. */
function glyph(name: MarkName): string | undefined {
	return render(Mark, { name }).querySelector('svg')?.innerHTML;
}

/** the same heads with the sorted one turned the other way, which is what the press leads to. */
function turned(): readonly Column[] {
	return SORTABLE.map((column) =>
		column.key === 'given'
			? { ...column, sort: { href: '?sort=given&dir=desc', dir: 'ascending' as const } }
			: column
	);
}

describe('a column head a press sorts by', () => {
	it('is a label and nothing to press where the column does not sort', () => {
		// sorting is the column's own word and not the table's: a screen that offers it on three of
		// its columns has to leave the other heads alone, or every head is a destination and the
		// three that lead somewhere stop standing out.
		const root = render(DataTable, {
			caption: '2 donors, newest first.',
			columns: SORTABLE,
			rows: DONORS
		});
		const head = heads(root)[3];

		expect(head?.querySelector('a')).toBeNull();
		expect(head?.textContent).toBe('Added');
	});

	it('is a link, because a sort is an address rather than a thing that happens here', () => {
		// the screen is drawn from its loader, so the press is a navigation and the head is the
		// same element the last row of a table already draws to add a record.
		const root = render(DataTable, {
			caption: '2 donors, newest first.',
			columns: SORTABLE,
			rows: DONORS
		});
		const head = heads(root)[0];
		const link = head?.querySelector('a');

		expect(link?.getAttribute('href')).toBe('?sort=name');
		expect(link?.getAttribute('class')).toBe('adm-sort');
		expect(link?.textContent).toBe('Name');
	});

	it('says nothing about a direction while the table is not sorted by it', () => {
		// a mark is reserved for the state a column is in, and "could be sorted" is not one: drawn
		// on every sortable head, the mark on the one that is sorted stops being the answer to
		// which column the rows are in the order of.
		const root = render(DataTable, {
			caption: '2 donors, newest first.',
			columns: SORTABLE,
			rows: DONORS
		});
		const head = heads(root)[1];

		expect(head?.getAttribute('aria-sort')).toBeNull();
		expect(head?.querySelector('a svg')).toBeNull();
	});

	it('states the direction on the head and draws it once inside the link', () => {
		// the head carries the direction and the mark carries no name of its own, so a reader
		// meeting the column is told which way it runs once rather than twice.
		const root = render(DataTable, {
			caption: '2 donors, newest first.',
			columns: SORTABLE,
			rows: DONORS
		});
		const head = heads(root)[2];

		expect(head?.getAttribute('aria-sort')).toBe('descending');
		expect(head?.querySelectorAll('a svg').length).toBe(1);
		expect(head?.querySelector('a svg')?.innerHTML).toBe(glyph('chevron-down'));
	});

	it('turns the mark over with the direction', () => {
		// the two directions are one column in two states, and a mark that does not turn is a
		// column reporting the order it was in before the press.
		const root = render(DataTable, {
			caption: '2 donors, newest first.',
			columns: turned(),
			rows: DONORS
		});
		const head = heads(root)[2];

		expect(head?.getAttribute('aria-sort')).toBe('ascending');
		expect(head?.querySelector('a svg')?.innerHTML).toBe(glyph('chevron-up'));
	});

	it('reads a column of counts as counts and never as money', () => {
		// the two are drawn alike and are two readings all the same: a column of gifts keyed
		// `money` lines up correctly and tells the next reader those figures are amounts.
		const root = render(DataTable, {
			caption: '2 donors, newest first.',
			columns: SORTABLE,
			rows: DONORS
		});

		expect(heads(root)[1]?.getAttribute('class')).toBe('adm-cell--count');
		expect(readings(root, 0)).toEqual([
			null,
			'adm-cell--count',
			'adm-cell--money',
			'adm-cell--date'
		]);
	});
});
