import { TRIBUTE_KIND_LABELS } from '@better-giving/form/v1';
import { DataTable } from '@better-giving/operator/components/data/DataTable';
import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { screenTitle } from '$lib/admin/screen-title';
import { formatMinor } from '$lib/donations/money';
import { DONATION_STATUS_LABELS } from '$lib/donations/statuses';
import { loadFailed } from '$lib/server/db/load-failure';
import { DONATION_LIST_LIMIT, listDonations } from '$lib/server/donations/queries';
import { database } from '../context';
import type { Route } from './+types/_app.admin.donations';

// the gifts a deployment has taken: a `loader` and nothing else. there is no write on this screen —
// a gift is recorded by the public endpoint under `/api/v1` and settled by the payment
// processor's webhook, and /admin reads the result.
//
// this file is deliberately thin. what a gift's state is lives in
// `$lib/server/donations/queries.ts`, what each state is called lives in
// `$lib/donations/statuses.ts`, and the only job here is turning rows into what the page renders.

/** the element the table's caption is named by, and the only id this screen mints. */
const CAPTION_ID = 'gifts-caption';

/**
 * what each column is worth, in the order an operator reads a row.
 *
 * the first is the row's own header and what the plane pins to the leading edge: a gift carries no
 * name and no visible id, so the day it arrived is what identifies it in a list ordered by that
 * same day. `DataTable` decides that from position — the first column is the `th` — so the order
 * here is the arrangement and not only the sequence.
 *
 * a `kind` is the reading a cell takes, drawn by packages/operator/src/styles/adm.css: a date is
 * one value and never wraps, money is end-aligned tabular figures, and a whole message wraps and
 * keeps a floor under its column. the two with no kind are prose.
 *
 * a `width` is the column's share of the table, and the eight sum to the whole of it. it is stated
 * here rather than taken from a token because a share is a fact about these eight columns and
 * nothing a design system could hold — packages/operator/src/styles/tokens.css's header names a
 * table column's percentage among the few things a screen still writes. the date and the figure take
 * the smallest because what they hold is one value of a fixed width.
 *
 * the message is where a new column's share comes from, and it is the only column it could come
 * from. every other one holds a single value of a roughly fixed width, so narrowing it wraps a name
 * or a phrase; the message already wraps by design and `whole` keeps a floor under its column, so a
 * smaller share widens the plane and scrolls it rather than losing anything.
 *
 * the dedication is a column of its own and not a line inside another. it is not the message: a
 * message is free text a donor wrote and is never parsed, and a dedication is a structured fact the
 * organisation reports on, so folding one into the other re-fuses the two things the columns behind
 * them keep apart. and it is not `Repeating`'s precedent either — that word sits inside the money
 * cell because it is a fact about the money, which a gift given in someone's memory is not.
 *
 * the cause sits after Source and before the dedication, which is the order an operator reads a
 * gift in: where it came from, what it was given to, and who it was given for. `Program` is the
 * fundraiser's own word and the schema's word at once — the table is `program`, and it is what the
 * screen an operator makes one on is called.
 *
 * `Dedication` and not the schema's `tribute`: it is the fundraiser's own word, and the word the
 * donor is asked in — packages/form/src/views.ts writes `Dedicate this gift` on the tick that opens
 * it. the column carries no `kind`, so it is prose: what is in it is one short line, and `whole`'s
 * floor is for a column holding a paragraph.
 */
const COLUMNS = [
	{ key: 'received', label: 'Received', kind: 'date', width: '11%' },
	{ key: 'donor', label: 'Donor', width: '15%' },
	{ key: 'amount', label: 'Amount', kind: 'money', width: '11%' },
	{ key: 'status', label: 'Status', width: '11%' },
	{ key: 'source', label: 'Source', width: '12%' },
	{ key: 'program', label: 'Program', width: '11%' },
	{ key: 'dedication', label: 'Dedication', width: '16%' },
	{ key: 'message', label: 'Message', kind: 'whole', width: '13%' }
] as const;

/** the screen's name, rendered as the document title and as the heading. */
const SCREEN_TITLE = 'Gifts';

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context }: Route.LoaderArgs) {
	let donations: Awaited<ReturnType<typeof listDonations>>['donations'];
	let hasMore: boolean;
	try {
		({ donations, hasMore } = await listDonations(context.get(database)));
	} catch (e) {
		// the diagnostic lives on the loader for the reason /admin/donors's does: this is where an
		// unapplied migration actually surfaces, because the page cannot be drawn at all without
		// it, and a message anywhere else would be one nobody reads first.
		console.error('listing donations failed:', e);
		loadFailed('The gifts list');
	}

	return {
		// an explicit projection rather than the row. the read already narrows `donation` to the
		// columns a list needs; this narrows again to what a browser is given, and turns the two
		// values that must not be formatted in a component into strings.
		donations: donations.map((d) => ({
			id: d.id,
			donorName: d.donorName,
			// formatted here rather than in the page: the currency decides where the decimal point
			// goes and the stored value is an integer number of minor units, so a component
			// rendering `totalMinor` renders a gift a hundred times its size.
			amount: formatMinor(d.totalMinor, d.currency),
			// the date only, ISO, formatted here for the reason /admin/donors formats `createdOn`
			// here: an `Intl.DateTimeFormat` in the page would run once on the Worker during ssr and
			// again in the browser, in two different locales and time zones, which is a hydration
			// mismatch as well as a lie about whose "today" it is.
			receivedOn: d.receivedAt.toISOString().slice(0, 10),
			source: d.source,
			// whole, never truncated. a donor wrote it to be read, and a message stored where
			// nobody can read it is the same loss as not having stored it.
			note: d.note,
			// the value, not the word. `DONATION_STATUS_LABELS` in `$lib/donations/statuses.ts` is
			// what the page renders it with, and a state with no label there is a type error.
			status: d.status,
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
			program: d.programName
		})),
		// so the page can say the list is capped rather than silently showing a prefix.
		limit: DONATION_LIST_LIMIT,
		// exact, and not computed here: `listDonations` fetches one row past the cap and reports
		// whether it came back, then returns at most the cap. this route never sees that row, which
		// is why the count above and this flag cannot disagree.
		hasMore
	};
}

// what this page owes is that every gift a deployment has taken can be read: who gave, how much,
// when, what state it is in, and what they wrote.
export default function Donations({ loaderData }: Route.ComponentProps) {
	const { donations, limit, hasMore } = loaderData;
	const count = donations.length;

	return (
		// one column and the column is what spaces it: every block below carries no margin of its
		// own, so one that is not rendered leaves no space behind it. the wide measure, because a
		// table plane is what it exists for.
		<Column wide>
			<PageHeader title={SCREEN_TITLE} />

			{/* the table sits in the column directly, and nothing wraps it. a grid item's automatic
			    minimum size is its min-content size, so a plain element between the column and the
			    plane is one the column can never make narrower than the whole table: the page then
			    scrolls sideways instead of the plane, and the pinned first column goes with it —
			    `position: sticky` resolves against a box that never scrolls. `.adm-plane` is a
			    scroll box, which is the one kind of item whose automatic minimum is zero, so as the
			    column's own child it shrinks and scrolls at every width. the cost is the step
			    between the caption and the table it names, which is now the column's gap and the
			    caption's own margin-block-end together. */}
			<DataTable
				captionId={CAPTION_ID}
				// with rows, the sentence that says what the table holds and is what names it.
				// with none there is no count worth stating and none is drawn — the word is the
				// screen's own noun, which `DataTable` gives the plane as its name so a region
				// with nothing in it is still announced as one. the row inside the table is
				// what says what the screen is waiting for.
				caption={count > 0 ? `${count} ${count === 1 ? 'gift' : 'gifts'}, newest first.` : 'Gifts'}
				capNote={hasMore ? `Only the most recent ${limit} are shown.` : undefined}
				columns={COLUMNS}
				rows={donations.map((d) => ({
					// the gift's own id, which is what keys the row. it is never rendered — no
					// column is keyed `id` — and it is here because keying by position instead
					// hands two rows that swap places each other's cells.
					id: d.id,
					cells: {
						received: <time dateTime={d.receivedOn}>{d.receivedOn}</time>,
						donor: d.donorName,
						// the word sits after the figure and inside the money cell, because it is a
						// fact about the money and belongs beside the number a scanner is already
						// reading. `secondary` is the quiet tone — there is a value here and it is
						// quiet — because the figure is what the column is for and this qualifies it.
						//
						// the cell states `noted` and that beats the column's money, because what is in it
						// is a figure with a word under it rather than a figure. the number is still read as
						// money — end-aligned tabular figures on one line, so every amount in the column
						// lands on the same edge whether or not the gift repeats — and the word takes the
						// line beneath rather than the room past the end of the figure, which is room the
						// column does not have.
						amount: d.repeating
							? {
									reading: 'noted' as const,
									value: (
										<>
											{d.amount} <StatusWord secondary>Repeating</StatusWord>
										</>
									)
								}
							: d.amount,
						status: <StatusWord>{DONATION_STATUS_LABELS[d.status]}</StatusWord>,
						// a cell with nothing in it is dashed and set in the muted ink by the table
						// itself, which is why neither column reaches for a fallback here.
						source: d.source,
						// the name as it is stored. a gift credited to no cause hands over nothing and
						// the table dashes the cell itself, the same as the dedication below.
						program: d.program,
						// the sentence a fundraiser says, written out here rather than in the loader:
						// the phrase is a word a component may look up, which is what `status` above
						// does, and there is no locale in it to get wrong twice the way the date and
						// the figure would be. a gift given for nobody hands over nothing and the
						// table dashes the cell itself.
						dedication: d.tribute
							? `${TRIBUTE_KIND_LABELS[d.tribute.kind]} ${d.tribute.honoree}`
							: null,
						message: d.note
					}
				}))}
				empty="No gifts yet."
			/>
		</Column>
	);
}
