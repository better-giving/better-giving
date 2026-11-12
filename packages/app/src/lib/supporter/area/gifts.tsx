import { useEffect, useRef, useState } from 'react';
import { formatMinor } from '$lib/donations/money';
import { StateCard } from './cards';
import { giftCount, shortDay } from './copy';

// the gifts to a supporter's page, newest first, in the registry's table (table-css) inside its
// scroll frame, the donor's name pinned as the row header. a gift shows a name and a note only where
// its donor chose to show them on the page (`shown`, `noteShown` in $lib/server/pages/messages.ts);
// every other gift reads A donor with no note. a gift carries nothing else a donor typed, so there
// is no email, address or payment method here to leak.
//
// the server reads at most `OWN_GIFT_LIST_LIMIT` of them ($lib/server/supporters/pages.ts) and
// counts all of them; the table shows `GIFTS_AT_FIRST` and the registry's load-more row shows the
// rest of what was read, a step at a time. when the last step takes the row away, focus goes to the
// first gift it added rather than to the page.

/** one gift as its supporter sees it. */
export type OwnGift = {
	readonly amountMinor: number;
	/** ISO 8601. */
	readonly receivedAt: string;
	readonly shown: { readonly name: string; readonly note: string } | null;
};

/** how many gifts the table opens on, and how many more each press shows. */
export const GIFTS_AT_FIRST = 6;

export function Gifts({
	gifts,
	total,
	currency
}: {
	/** newest first, as read. */
	readonly gifts: readonly OwnGift[];
	/** every gift the page has had, read or not. */
	readonly total: number;
	readonly currency: string;
}) {
	const [showing, setShowing] = useState(Math.min(GIFTS_AT_FIRST, gifts.length));
	const firstAdded = useRef<HTMLTableCellElement>(null);
	const [landOn, setLandOn] = useState<number | null>(null);
	const more = showing < gifts.length;

	// keyed to the row the last press added, so it runs once per press that took the button away.
	useEffect(() => {
		if (landOn !== null) firstAdded.current?.focus();
	}, [landOn]);

	if (total === 0) {
		return (
			<StateCard title="No gifts yet" heading="h3">
				Share your link. Gifts show up here as soon as they land.
			</StateCard>
		);
	}
	return (
		<>
			{/* table-css: the scroll frame is a named region a keyboard reaches and scrolls. */}
			<section
				className="ds-table-scroll"
				aria-label="Gifts to your fundraiser"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: a frame that scrolls sideways takes the keyboard (table-css usage).
				tabIndex={0}
			>
				<table className="ds-table">
					<thead>
						<tr>
							<th scope="col">From</th>
							<th scope="col">Date</th>
							<th scope="col" className="ds-num">
								Amount
							</th>
							<th scope="col">Note</th>
						</tr>
					</thead>
					<tbody>
						{gifts.slice(0, showing).map((gift, row) => (
							// a gift has no id of its own here, and rows are only ever added at the end.
							<tr key={row}>
								<th
									scope="row"
									ref={row === landOn ? firstAdded : undefined}
									tabIndex={row === landOn ? -1 : undefined}
								>
									{gift.shown?.name ?? 'A donor'}
								</th>
								<td>{shortDay(gift.receivedAt)}</td>
								<td className="ds-num">{formatMinor(gift.amountMinor, currency)}</td>
								<td className="sa-note-cell">{gift.shown?.note || 'No note'}</td>
							</tr>
						))}
					</tbody>
					{more ? (
						<tfoot>
							<tr>
								<td colSpan={4} className="sa-load-more">
									<button
										type="button"
										onClick={() => {
											const next = Math.min(showing + GIFTS_AT_FIRST, gifts.length);
											if (next === gifts.length) setLandOn(showing);
											setShowing(next);
										}}
									>
										Show more gifts
									</button>
								</td>
							</tr>
						</tfoot>
					) : null}
				</table>
			</section>
			<p className="sa-quiet" role="status">
				Showing {showing} of {giftCount(total)}
			</p>
		</>
	);
}
