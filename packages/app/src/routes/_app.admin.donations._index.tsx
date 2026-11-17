import { Button } from '@better-giving/operator/components/controls/Button';
import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageState } from '@better-giving/operator/components/shell/PageState';
import { href, Link } from 'react-router';
import { ScreenHeading } from '$lib/admin/crumbs';
import { GiftsTable } from '$lib/admin/donations/gifts-table';
import { screenTitle } from '$lib/admin/screen-title';
import { formatMinor } from '$lib/donations/money';
import { MATCH_FILTERS, type MatchFilter } from '$lib/matching/status';
import { loadFailed } from '$lib/server/db/load-failure';
import { DONATION_LIST_LIMIT, listDonations } from '$lib/server/donations/queries';
import { isInHand, RAIL_LABELS } from '$lib/server/donations/rails';
import { readTrackingIds } from '$lib/server/donations/tracking-ids';
import { readNoteStandings } from '$lib/server/pages/messages';
import { createPaymentProviders } from '$lib/server/payments/factory';
import { database, platform } from '../context';
import type { Route } from './+types/_app.admin.donations._index';

// the gifts a deployment has taken: a `loader` and nothing else. there is no write on this screen —
// a gift given online is recorded by the public endpoint under `/api/v1` and settled by the payment
// processor's webhook, and one that arrived in hand is added on ./_app.admin.donations.new.tsx,
// which this screen links to. /admin reads the result of all three. the way out of the list is
// ./_app.admin.donations.export.tsx, which this screen links to as well.
//
// this file is deliberately thin. what a gift's state is lives in
// `$lib/server/donations/queries.ts`, what each state is called lives in
// `$lib/donations/statuses.ts`, the table is `GiftsTable` ($lib/admin/donations/gifts-table.tsx),
// and the only job here is turning rows into what the page renders.

/** the screen's name, in its heading and in the document title. */
const SCREEN_TITLE = 'Gifts';

/** the ways off the list beside adding a gift: the accountant's export, and the notes donors show. */
const HEADING_LINKS = [
	{ label: 'Export', href: href('/admin/donations/export'), internal: true },
	{ label: 'Public messages', href: href('/admin/donations/messages'), internal: true }
] as const;

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

/**
 * the Match filter the address names, or `null` for Any. an empty, unknown or misspelt value is Any
 * and never a refusal: the parameter is a view of the list, and a stale link still lands on it.
 */
function matchFilterOf(value: string | null): MatchFilter | null {
	return (MATCH_FILTERS as readonly (string | null)[]).includes(value)
		? (value as MatchFilter)
		: null;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const db = context.get(database);
	const match = matchFilterOf(new URL(request.url).searchParams.get('match'));
	let donations: Awaited<ReturnType<typeof listDonations>>['donations'];
	let hasMore: boolean;
	let noteStanding: Awaited<ReturnType<typeof readNoteStandings>>;
	try {
		({ donations, hasMore } = await listDonations(db, match === null ? {} : { match }));
		noteStanding = await readNoteStandings(
			db,
			donations.filter((d) => d.note !== null).map((d) => d.id)
		);
	} catch (e) {
		// the diagnostic lives on the loader for the reason /admin/donors's does: this is where an
		// unapplied migration actually surfaces, because the page cannot be drawn at all without
		// it, and a message anywhere else would be one nobody reads first.
		console.error('listing donations failed:', e);
		loadFailed('The gifts list');
	}

	const trackingIds = await readTrackingIds(donations, () =>
		createPaymentProviders(context.get(platform).env)
	);

	return {
		// an explicit projection rather than the row. the read already narrows `donation` to the
		// columns a list needs; this narrows again to what a browser is given, and turns the amount,
		// which must not be formatted in a component, into a string.
		donations: donations.map((d) => ({
			id: d.id,
			donorName: d.donorName,
			// formatted here rather than in the page: the currency decides where the decimal point
			// goes and the stored value is an integer number of minor units, so a component
			// rendering `totalMinor` renders a gift a hundred times its size.
			amount: formatMinor(d.totalMinor, d.currency),
			// money arriving in hand is stored as the day typed, at that day's UTC midnight
			// (`recordGiftInHand` in `$lib/server/donations/record-in-hand.ts`), so its day is UTC's
			// and crosses as the ISO day. every other gift is an instant, crossed whole and written
			// in the viewer's zone by `LocalTime` ($lib/admin/viewer-time.react.tsx).
			...(isInHand(d.rail?.method)
				? { receivedOn: d.receivedAt.toISOString().slice(0, 10) }
				: { receivedAt: d.receivedAt.toISOString() }),
			source: d.source,
			// whole, never truncated. a donor wrote it to be read, and a message stored where
			// nobody can read it is the same loss as not having stored it.
			note: d.note,
			// where the note stands on the donate page, for the word under it: on the page, hidden
			// from it by a press on /admin/donations/messages, or on no page (`NoteStanding` in
			// `$lib/donate/messages.ts`). the list only reads it.
			noteStanding: noteStanding(d.id),
			// the value, not the word. `DONATION_STATUS_LABELS` in `$lib/donations/statuses.ts` is
			// what the page renders it with, and a state with no label there is a type error.
			status: d.status,
			// the rail the gift arrived on, as the word for it — see `RAIL_LABELS` in
			// `$lib/server/donations/rails.ts` for why this one is resolved here and the state
			// above is not. null on a gift with no
			// settlement attempt at all, which the table dashes itself.
			//
			// the rail and never the processor behind it, which is where the provider the read
			// hands over stops: nothing on this screen names a processor, and a gift given on
			// Venmo is settled by PayPal — so a screen naming the
			// provider would name a processor the donor never saw, on the rows it is least
			// entitled to. the projection keeps both because `payment` keeps them apart
			// (`projectRail` in `$lib/server/donations/queries.ts`); this is the boundary that
			// drops one.
			paidWith: d.rail === null ? null : RAIL_LABELS[d.rail.method],
			// only on a gift something arrived in, so every other row crosses exactly as it did. the
			// code uppercased and never the coin's name: the name is NOWPayments' list, and this
			// loader asks the processor nothing.
			...(d.coinReceived && {
				coinReceived: `${d.coinReceived.amount} ${d.coinReceived.coin.toUpperCase()}`
			}),
			// whether a standing commitment collected this charge, marked beside the figure rather
			// than in Source — Source is free text a staff member typed, and a derived value in it
			// would make one column mean two things. the read hands over a boolean and never
			// `recurring_id`, so there is no id here to pass on.
			repeating: d.repeating,
			// the kind and the person, never the sentence: `TRIBUTE_KIND_LABELS` is what the page
			// writes it out with, which is the split `status` above takes — a third kind is a type
			// error there rather than a blank on a screen.
			//
			// the pair crosses as one value and not as two fields, so nothing downstream can be
			// handed a kind naming nobody. `projectTribute` in `$lib/server/donations/queries.ts`
			// settles that, and the two columns naming who to tell are not read at all.
			tribute: d.tribute,
			// what the cause is called, which is what the read hands over — `program_id` is not
			// selected at all, so there is no pointer here to pass on. no lookup and no locale in it,
			// so the name crosses as the string it is stored as.
			program: d.programName,
			// what the organisation matches a grant's arriving payment by in Chariot's dashboard, and
			// what staff match a gift by when a grant's write-failure alert names it beside the grant id.
			// the stored value first, on every Chariot gift whatever its state; read live only for a
			// pending grant stored without one (`readTrackingIds`). null on every other gift and on
			// one Chariot did not answer for in time. the grant id it was asked by stays here.
			trackingId: trackingIds.get(d.id) ?? null,
			// the match's one word and the employer the donor named, for staff. the reason a match was
			// voided is staff's too, and stays on the gift's own page.
			match: d.match
		})),
		// so the page can say the list is capped rather than silently showing a prefix.
		limit: DONATION_LIST_LIMIT,
		// exact, and not computed here: `listDonations` fetches one row past the cap and reports
		// whether it came back, then returns at most the cap. this route never sees that row, which
		// is why the count above and this flag cannot disagree.
		hasMore,
		// the filter the rows were read under, so the select shows it and the empty row says which
		// emptiness this is.
		match
	};
}

// what this page owes is that every gift a deployment has taken can be read: who gave, how much,
// when, what state it is in, what they wrote, and where its employer match stands.
export default function Donations({ loaderData }: Route.ComponentProps) {
	// a deployment with no gifts at all, which is not a filter that matched nothing: that one keeps
	// the table, whose filter is the way back out of it.
	const none = loaderData.donations.length === 0 && loaderData.match === null;
	return (
		// one column, the wide measure, because a table plane is what it exists for. the table sits in
		// the column directly, and nothing wraps it. a grid item's automatic minimum size is its
		// min-content size, so a plain element between the column and the plane is one the column can
		// never make narrower than the whole table: the page then scrolls sideways instead of the
		// plane, and the pinned first column goes with it — `position: sticky` resolves against a box
		// that never scrolls. `.adm-plane` is a scroll box, which is the one kind of item whose
		// automatic minimum is zero, so as the column's own child it shrinks and scrolls at every
		// width.
		<Column wide>
			<ScreenHeading
				title={SCREEN_TITLE}
				description="Every gift as it arrived, newest first."
				primary={
					<Button as={Link} to={href('/admin/donations/new')} variant="primary" mark="plus">
						Add donation
					</Button>
				}
				secondary={HEADING_LINKS}
			/>
			{none ? (
				// the heading's Add donation is the way in, so the state offers no second one.
				<PageState
					variant="empty"
					title="No gifts yet"
					body="Gifts show up here as soon as a donor gives, or when you add one by hand."
				/>
			) : (
				<GiftsTable {...loaderData} />
			)}
		</Column>
	);
}
