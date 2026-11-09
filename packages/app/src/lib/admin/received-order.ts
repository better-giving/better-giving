import { formatInstant } from './viewer-time.ts';

// the gifts list, newest first by the day each row shows rather than by the stored instant alone.
// `listDonations` in `$lib/server/donations/queries.ts` orders by `received_at`, and a gift in
// hand is stored at its day's UTC midnight and shows that day, while an online gift shows its
// instant in the viewer's zone. west of UTC an online gift at 02:00Z on the 22nd shows the 21st
// yet sorts above an in-hand gift of the 22nd, so the page re-sorts by the day shown. the query's
// order still decides which rows make `DONATION_LIST_LIMIT`.

/** a gift in hand, dated by the day typed, or an online gift, dated by its instant. */
export type Received = { readonly receivedOn: string } | { readonly receivedAt: string };

/**
 * `rows` newest first by the ISO day each shows in `zone`, keeping the given order within a day.
 * with no zone, nothing shows a day yet and `rows` is handed back as given.
 */
export function byDayShown<Row extends Received>(
	rows: readonly Row[],
	zone: string | null
): readonly Row[] {
	if (zone === null) return rows;
	const dayShown = (row: Row) =>
		'receivedOn' in row ? row.receivedOn : formatInstant(row.receivedAt, zone, 'iso-day');
	// `toSorted` is stable, so rows showing the same day keep the given order.
	return rows
		.map((row) => ({ row, day: dayShown(row) }))
		.toSorted((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
		.map(({ row }) => row);
}
