import { useId } from 'react';
import { Mark } from '../status/Mark.jsx';

/**
 * @import { ReactNode } from 'react'
 */

/**
 * a column's `kind` is the reading its cells take, and the sheet draws each one:
 * packages/operator/src/styles/adm.css sets a date's face, a money figure's alignment, a count's
 * under its own name, and the floor under a column whose cells hold a whole sentence — which is
 * what `whole` is. a column with no kind is prose.
 *
 * `count` and `money` are drawn to the same declarations and are two readings all the same,
 * because the name of a reading is what a screen writes down: a column of gifts keyed `money`
 * lines its figures up correctly and tells the next reader they are amounts.
 *
 * @typedef {'count' | 'date' | 'money' | 'whole'} CellKind
 */

/**
 * what a cell may state for itself: every kind a column has, plus the two no column has. `prose` is
 * what a cell wears nothing for, and it is a reading rather than the absence of one, so a cell that
 * means it says so. `noted` is a figure with a word under it — the figure read as money and the
 * word on the line beneath, so the figures still line up down the column they are in.
 *
 * it is a type of its own and not more members of `CellKind`, because a `CellKind` is what a whole
 * column may be and neither of these is: only a cell has a note, and prose is the reading a column
 * with no kind already gives. the union is held to the `.adm-cell--` rules the sheet draws by
 * packages/operator/src/components/closed-sets.spec.ts, as one set against another rather than a
 * member for each rule, because the table below lets one reading wear two.
 *
 * @typedef {CellKind | 'prose' | 'noted'} Reading
 */

/**
 * the `.adm-cell--` suffixes each reading is drawn with. it is a table rather than the reading's own
 * name, because a reading is what is in the cell and a suffix is a rule in
 * packages/operator/src/styles/adm.css, and the two are not one to one: `noted` wears money's rule
 * for the figure and its own for the word beneath, and `prose` wears nothing at all.
 *
 * @type {Record<Reading, readonly string[]>}
 */
const WORN = {
	count: ['count'],
	date: ['date'],
	money: ['money'],
	whole: ['whole'],
	noted: ['money', 'noted'],
	prose: []
};

/**
 * what a press on a sortable head leads to, and which way the column runs once it is the one the
 * rows are ordered by. `dir` is `null` on a head a press would sort by and the table is not sorted
 * by yet, which is a column with a destination and no state — the word is `aria-sort`'s own, so the
 * head states it as it arrives rather than translating it.
 *
 * the href is the caller's whole say over the press: only the screen knows what its other search
 * parameters are and whether pressing the sorted column again turns it over or clears it.
 *
 * @typedef {object} ColumnSort
 * @property {string} href
 * @property {'ascending' | 'descending' | null} dir
 */

/**
 * @typedef {object} Column
 * @property {string} key
 * @property {ReactNode} label
 * @property {string} width the column's share of the table's own width, as a percentage. it is
 * stated by the caller and not taken from packages/operator/src/styles/tokens.css: a share is a
 * fact about the columns dividing one table and no design-system value could hold it, which is why
 * that file's header names a table column's percentage among the few things a screen still writes.
 * @property {CellKind | undefined} [kind]
 * @property {boolean | undefined} [neverDash] whether a missing value is left blank rather than dashed.
 * @property {ColumnSort | undefined} [sort] where a press on this head goes, and the direction the
 * column is in. a column without it is a label and nothing to press: sorting is the column's own
 * word rather than the table's, and a header row where every head led somewhere leaves the ones
 * that do standing out from nothing.
 */

/**
 * a cell that states the reading it takes, which wins over the column's. the reading belongs to
 * what is actually in the cell: a column of figures whose cell holds a sentence is still a
 * sentence, and end-aligned tabular figures that never wrap is the wrong reading for one.
 *
 * @typedef {object} Cell
 * @property {Reading} reading
 * @property {ReactNode} value
 */

/**
 * a row is read by the columns' own keys, and a cell it has nothing for is the empty reading.
 *
 * the identity is the row's own and is what keys it. it is a field beside the cells rather than
 * one of them, so that a column may be keyed anything at all without colliding with it — and it
 * comes from the caller because only the caller knows what a row is: keyed by position instead,
 * two rows that swap places keep each other's cells.
 *
 * @typedef {object} Row
 * @property {string} id
 * @property {Record<string, ReactNode | Cell>} cells
 */

/**
 * @typedef {object} DataTableProps
 * @property {ReactNode} [caption]
 * @property {ReactNode} [capNote]
 * @property {readonly Column[] | undefined} [columns]
 * @property {readonly Row[] | undefined} [rows]
 * @property {ReactNode} [empty]
 * @property {ReactNode} [add]
 * @property {string | undefined} [addHref]
 * @property {string | undefined} [captionId] the id the caption paragraph is drawn with and the
 *   table is named by. it is stated only where a screen needs to name that paragraph from somewhere
 *   else; left alone it is the table's own, because two counted tables on one page taking one
 *   written-down id emit it twice and the second table's name resolves to the first one's sentence.
 */

/**
 * what a cell holds, and the suffixes its reading is drawn with: its own reading where it states
 * one, its column's kind where it does not, and nothing where the column has no kind either.
 *
 * @param {ReactNode | Cell} held
 * @param {CellKind | undefined} column
 * @returns {{ value: ReactNode, worn: readonly string[] }}
 */
function read(held, column) {
	if (held !== null && typeof held === 'object' && 'reading' in held) {
		return { value: held.value, worn: WORN[held.reading] };
	}
	return { value: /** @type {ReactNode} */ (held), worn: WORN[column ?? 'prose'] };
}

/* a wide data plane. one table at every width: it scrolls horizontally with its first column
   pinned as a row header, and the scroll box itself is focusable and carries the ring.
   the caption pluralises and, when the list is capped, gains a second sentence — that sentence
   is the entire affordance, because no next page exists. it stands outside the scroll box rather
   than inside the table as a `<caption>`: a caption is part of the table, so it travels sideways
   with everything else when the plane scrolls.

   it is drawn only where there are rows to count. with none there is no count worth stating, and
   the row inside the table says what the screen is waiting for.

   the plane is a region and the table inside it is named too, from the same sentence. they are two
   elements a reader arrives at separately — the plane by tabbing to the scroll box, the table by
   entering it — and a table with no name of its own is one a reader meets knowing only how many
   columns it has.

   it is a `<section>` and carries no `role`: a section with an accessible name is a region already,
   and the name is the same one the table takes. nothing draws the plane by tag, so the element is
   free to change — `.adm-plane` is a class rule in packages/operator/src/styles/adm.css, and the
   ring sits on `:focus-visible` in that directory's base.css; neither names an element. where the
   caption is not drawn there is no name to take, and an unnamed section is exposed as nothing at
   all — which is what an unnamed `region` was exposed as too. */
/** @param {DataTableProps} props */
export function DataTable({
	caption,
	capNote,
	columns = [],
	rows = [],
	empty,
	add,
	addHref = '#',
	captionId
}) {
	// the caption's own id, stated from `useId` where the screen did not write one down —
	// ./RecordCard.jsx does the same for the same reason. two counted tables on one page
	// taking one written-down id emit it twice, and the second table's name then resolves to the
	// first table's sentence.
	const own = useId();
	const captionedBy = captionId ?? own;
	const counted = caption != null && rows.length > 0;
	const named = !counted && typeof caption === 'string' ? caption : undefined;
	return (
		<>
			{counted ? (
				<p className="adm-tablecaption" id={captionedBy}>
					{caption}
					{capNote ? <> {capNote}</> : null}
				</p>
			) : null}
			<section
				className="adm-plane"
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll box has to take focus or the
				   columns past its right edge are reachable by pointer only. the rule is right about a
				   non-interactive element in general and wrong about this one: scrolling is the
				   interaction, and a browser gives arrow keys to a scroll box only once it is focused. */
				tabIndex={0}
				aria-labelledby={counted ? captionedBy : undefined}
				aria-label={named}
			>
				<table
					className="adm-table"
					aria-labelledby={counted ? captionedBy : undefined}
					aria-label={named}
				>
					{/* the shape the table keeps. without it every column is sized from whatever the
					    rows on this page happen to hold, so a figure column lands somewhere else on
					    the next page of results and a reader scanning down it has to find it again.
					    the group carries the widths rather than the header cells: a `<col>` states a
					    column, and a width on a `th` is one row's cell asking for it. */}
					<colgroup>
						{columns.map((c) => (
							<col key={c.key} style={{ inlineSize: c.width }} />
						))}
					</colgroup>
					<thead>
						<tr>
							{/* a head a press sorts by is a link and not a button: the screen is drawn from its
							    loader, so a sort is another address rather than something that happens here — the
							    same element the last row of this table already draws to add a record. the head
							    keeps its column's reading either way and the link sits inside it, so a money
							    column's head is still end-aligned once it can be pressed.

							    the direction is stated once, by `aria-sort` on the head, and the mark inside the
							    link carries no name of its own — it is that same fact drawn for a reader looking
							    at the column rather than being told about it.

							    a sortable head the table is not sorted by wears no mark at all. a mark is
							    reserved for the state a column is in, and "could be sorted" is not one: drawn on
							    every sortable head, the mark on the sorted one stops being the answer to which
							    column the rows are in the order of. */}
							{columns.map((c, i) => (
								<th
									key={c.key}
									scope="col"
									data-pin={i === 0 ? '' : undefined}
									aria-sort={c.sort?.dir ?? undefined}
									className={
										WORN[c.kind ?? 'prose'].map((w) => `adm-cell--${w}`).join(' ') || undefined
									}
								>
									{c.sort ? (
										<a className="adm-sort" href={c.sort.href}>
											{c.label}
											{c.sort.dir ? (
												<Mark name={c.sort.dir === 'ascending' ? 'chevron-up' : 'chevron-down'} />
											) : null}
										</a>
									) : (
										c.label
									)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((r) => (
							<tr key={r.id}>
								{columns.map((c, i) => {
									const held = r.cells[c.key];
									const { value, worn } = read(held, c.kind);
									// the first cell of a row is the row's header and what the plane
									// pins, and it takes its column's reading like any other cell: a
									// date column whose head is set as a date and whose body is set
									// as prose is one column drawn two ways. it takes the absent value
									// the same way: the pinned column is what a reader identifies a row
									// by, so a row with no name of its own wears its column's dash and
									// the muted ink rather than standing blank beside a row of real
									// figures, which reads as a rendering failure.
									//
									// each class is composed at the cell rather than in a function of
									// its own, so that `adm-cell--empty` stands inside a
									// `className={…}` — which is where
									// packages/app/src/lib/admin/styles/conformance.spec.ts reads
									// what markup carries, and a class it cannot see there reads as a
									// dead rule in the sheet.
									return i === 0 ? (
										<th
											key={c.key}
											scope="row"
											data-pin=""
											className={
												[
													...worn.map((w) => `adm-cell--${w}`),
													held == null ? 'adm-cell--empty' : ''
												]
													.filter(Boolean)
													.join(' ') || undefined
											}
										>
											{held == null ? (c.neverDash ? '' : '—') : value}
										</th>
									) : (
										<td
											key={c.key}
											className={
												[
													...worn.map((w) => `adm-cell--${w}`),
													held == null ? 'adm-cell--empty' : ''
												]
													.filter(Boolean)
													.join(' ') || undefined
											}
										>
											{held == null ? (c.neverDash ? '' : '—') : value}
										</td>
									);
								})}
							</tr>
						))}
						{!rows.length && empty ? (
							<tr>
								{/* a fresh deployment and not an error, which is why the mark is an info one. */}
								<td className="adm-table__empty" colSpan={columns.length}>
									<p className="adm-table__note">
										<Mark name="info" />
										{empty}
									</p>
								</td>
							</tr>
						) : null}
						{add ? (
							<tr>
								<td className="adm-table__add" colSpan={columns.length}>
									<a href={addHref}>
										<Mark name="plus" />
										{add}
									</a>
								</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</section>
		</>
	);
}
