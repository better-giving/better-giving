import type { Column, Row } from '@better-giving/operator/components/data/DataTable';
import { DataTable } from '@better-giving/operator/components/data/DataTable';

/*
 * one plane at every length it can be, and every reading a cell can take.
 *
 * the readings are the closed set worth walking. a column states one for all of its cells and a
 * cell may state its own over the top — the `noted` figure with a word under it, and the sentence
 * that lands in a money column and must stop being an end-aligned tabular figure to stay readable.
 * `prose` is a reading and not the absence of one, so it is drawn as a cell that means it rather
 * than as a cell that said nothing.
 *
 * a missing cell has two drawings and both are here: a column left to dash prints one, and a
 * `neverDash` column prints nothing at all. the row's own header is not a third — it is a cell of
 * its column like any other, so a row whose identity is missing dashes and wears the muted ink
 * rather than standing blank under the pin.
 *
 * three plane lengths. many rows with the caption counting them, one row, and none. the empty
 * plane is where the states diverge: packages/operator/src/components/data/DataTable.jsx draws
 * the caption only where there are rows to count, so an empty plane loses its caption paragraph and
 * takes the same sentence as its accessible name instead — and the plane with no `empty` prop draws
 * a table with a head and nothing under it, which is the one specimen here that reads as broken
 * because that is what it is on a screen that forgot the prop.
 *
 * `capNote` is the whole affordance of a capped list — there is no next page — so it is drawn on
 * the long plane and nowhere else; it is not drawn at all on an empty one, which the same condition
 * decides.
 *
 * the wide plane scrolls sideways with its first column pinned, so the long donor name and the long
 * note are what make it scroll: string length is what this element is written against, and a plane
 * that only ever holds short cells never shows the pin.
 *
 * two of the planes are the header row a press sorts by, and they are two because a table is
 * sorted by one column at a time: the sorted column runs one way on the first and the other way on
 * the second. every other state a head can be in stands in both — two columns a press would sort
 * by and the table is not sorted by, which carry no mark, and one that does not sort at all beside
 * them, because what a sortable head has to be is only legible next to one that is not.
 *
 * no pointer or keyboard state is drawn for them: the link inside a head comes from the component
 * and takes no class from a caller, so those two are the sheet's to draw and nothing on this page
 * can pin them.
 */

const columns: readonly Column[] = [
	{ key: 'received', label: 'Received', width: '16%', kind: 'date' },
	{ key: 'donor', label: 'Donor', width: '26%' },
	{ key: 'amount', label: 'Amount', width: '16%', kind: 'money' },
	{ key: 'gifts', label: 'Gifts', width: '10%' },
	{ key: 'note', label: 'Note', width: '32%' }
];

const rows: readonly Row[] = [
	{
		id: 'dn_4Kq2Rt',
		cells: {
			received: '4 Feb 2026',
			donor: 'Marianne Whitfield',
			amount: '£45.00',
			gifts: '3',
			note: 'Gift Aid claimed'
		}
	},
	{
		id: 'dn_9Lm7Bd',
		cells: {
			received: '3 Feb 2026',
			donor: 'Anonymous',
			// the figure with a word under it: still money, so it lines up down the column, with the
			// cadence on the line beneath rather than in a column of its own. the note is an element
			// and the figure is not — that is what the sheet turns into a block under it.
			amount: {
				reading: 'noted',
				value: (
					<>
						£20.00<span className="adm-caption">monthly</span>
					</>
				)
			},
			gifts: '11',
			note: 'Recurring since March 2025'
		}
	},
	{
		id: 'dn_2Zx8Hp',
		cells: {
			received: '3 Feb 2026',
			donor: 'The Wharfedale Riverside Community Kitchen and Night Shelter Trust',
			// a sentence standing in the money column. end-aligned tabular figures that never wrap is
			// the wrong reading for one, so the cell says what it actually holds.
			amount: { reading: 'prose', value: 'Refunded in full' },
			gifts: '1',
			note: 'The donor asked for the gift back the same evening; the refund settled two days later and the receipt was withdrawn.'
		}
	},
	{
		id: 'dn_6Yt1Cw',
		cells: {
			received: '2 Feb 2026',
			// nothing at all for this row's donor, which is the dash.
			donor: null,
			amount: '£10.00',
			gifts: '1'
			// `note` is not written for this row either, which is the same absent value reached the
			// other way: the component reads a cell by its column's key and finds nothing.
		}
	},
	{
		id: 'dn_8Nr5Vk',
		cells: {
			received: '1 Feb 2026',
			donor: 'Priya Raghunathan',
			amount: '£1,250.00',
			gifts: '2',
			note: 'Paid by bank transfer and entered by hand'
		}
	},
	{
		// the absent value in the first column, which is the row's own header: it takes the dash and
		// `adm-cell--empty` like any other cell of its column, because the pinned column is what a
		// reader identifies a row by and a blank under the pin reads as a rendering failure.
		id: 'dn_1Wq3Fs',
		cells: {
			donor: 'Tomasz Kowalczyk',
			amount: '£30.00',
			gifts: '1',
			note: 'Entered before the date was known'
		}
	}
];

/** the donor screen's heads, with the column the rows are ordered by turned whichever way. */
function sortable(dir: 'ascending' | 'descending'): readonly Column[] {
	return [
		{ key: 'name', label: 'Name', width: '30%', sort: { href: '#name', dir: null } },
		{
			key: 'gifts',
			label: 'Gifts',
			width: '14%',
			kind: 'count',
			sort: { href: '#gifts', dir: null }
		},
		{ key: 'given', label: 'Given', width: '20%', kind: 'money', sort: { href: '#given', dir } },
		{ key: 'kind', label: 'Kind', width: '16%' },
		{ key: 'added', label: 'Added', width: '20%', kind: 'date' }
	];
}

const donors: readonly Row[] = [
	{
		id: 'dr_4Kq2Rt',
		cells: {
			name: 'Marianne Whitfield',
			gifts: '11',
			given: '£1,240.00',
			kind: 'Repeating',
			added: '3 Mar 2025'
		}
	},
	{
		id: 'dr_9Lm7Bd',
		cells: {
			name: 'The Wharfedale Riverside Community Kitchen and Night Shelter Trust',
			gifts: '2',
			given: '£85.00',
			kind: 'One-off',
			added: '18 Nov 2025'
		}
	}
];

export default function DataDataTablePreview() {
	return (
		<div className="adm-stack">
			<DataTable
				caption="6 donations."
				capNote="The 6 most recent are shown."
				columns={columns}
				rows={rows}
			/>

			<DataTable caption="1 donation." columns={columns} rows={rows.slice(0, 1)} />

			{/* the plane that is waiting, with the sentence that says what for. */}
			<DataTable
				caption="Donations"
				columns={columns}
				empty="No donations yet. The first one appears here the moment a card clears."
			/>

			{/* the same plane with the sentence left out. a head with nothing under it. */}
			<DataTable caption="Donations" columns={columns} />

			{/* the plane a screen adds a record from. `addHref` is left at its default here, so the
			    row is the link's own drawing and not a destination. */}
			<DataTable
				caption="2 donation forms."
				columns={[
					{ key: 'name', label: 'Form', width: '40%' },
					{ key: 'raised', label: 'Raised', width: '20%', kind: 'money' },
					{ key: 'gifts', label: 'Gifts', width: '15%' },
					// the column that prints nothing rather than a dash where a form has never been
					// given to.
					{ key: 'last', label: 'Last gift', width: '25%', kind: 'date', neverDash: true }
				]}
				rows={[
					{
						id: 'winter-appeal',
						cells: {
							name: 'Winter appeal',
							raised: '£12,480.00',
							gifts: '214',
							last: '4 Feb 2026'
						}
					},
					{
						id: 'kitchen-fund',
						cells: { name: 'Kitchen fund', raised: '£0.00', gifts: '0' }
					}
				]}
				add="Add a donation form"
			/>

			{/* the header row a press sorts by. `Given` is the column the rows are in the order of and
			    the only head carrying a mark; `Name` and `Gifts` lead somewhere and say nothing about
			    a direction, and `Added` does not sort at all. `Gifts` is the count reading, which is
			    money's drawing under the name of what is actually in the column. */}
			<DataTable
				caption="2 donors, most given first."
				columns={sortable('descending')}
				rows={donors}
			/>

			{/* the same column turned over, which is where the press on it leads. */}
			<DataTable
				caption="2 donors, least given first."
				columns={sortable('ascending')}
				rows={donors}
			/>

			{/* no caption at all: nothing counts the rows and neither the plane nor the table inside it
			    has a name, so a reader tabbing into the scroll box is told only how many columns it
			    has. */}
			<DataTable
				columns={[
					{ key: 'origin', label: 'Allowed origin', width: '60%' },
					{ key: 'added', label: 'Added', width: '40%', kind: 'date' }
				]}
				rows={[
					{
						id: 'riverside-shelter.org',
						cells: { origin: 'https://riverside-shelter.org', added: '12 Nov 2025' }
					},
					{
						id: 'give.riverside-shelter.org',
						cells: { origin: 'https://give.riverside-shelter.org', added: '12 Nov 2025' }
					}
				]}
			/>
		</div>
	);
}
