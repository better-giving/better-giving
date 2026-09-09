import { FREQUENCY_LABELS } from '@better-giving/form/v1';
import { DataTable } from '@better-giving/operator/components/data/DataTable';
import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { href, Link } from 'react-router';
import { screenTitle } from '$lib/admin/screen-title';
import { formatMinor } from '$lib/donations/money';
import { RECURRING_STATUS_LABELS } from '$lib/recurring/statuses';
import { loadFailed } from '$lib/server/db/load-failure';
import { listRecurringPlans, RECURRING_LIST_LIMIT } from '$lib/server/recurring/queries';
import { database } from '../context';
import type { Route } from './+types/_app.admin.recurring._index';

// the standing commitments a deployment holds: a `loader` and nothing else. there is no write on
// this screen and no create either — a recurring gift is made by a donor on a donation form, and
// stopping one is the screen next door, where the gift being stopped is the thing on the page.
//
// this file is deliberately thin. what reaches the database lives in
// `$lib/server/recurring/queries.ts`, what each state is called lives in
// `$lib/recurring/statuses.ts`, and the only job here is turning rows into what the page renders.

/** the element the table's caption is named by, and the only id this screen mints. */
const CAPTION_ID = 'recurring-caption';

/**
 * what each column is worth, in the order an operator reads a row.
 *
 * the first is the row's own header and what the plane pins to the leading edge: a commitment
 * carries no name of its own, and the donor is who the other five cells are about — so a screen
 * reader announces the name with each of them. `DataTable` decides that from position — the first
 * column is the `th` — so the order here is the arrangement and not only the sequence.
 *
 * a `kind` is the reading a cell takes, drawn by packages/operator/src/styles/adm.css: money is
 * end-aligned tabular figures, and a date is one value that never wraps. the three with no kind
 * are prose.
 *
 * a `width` is the column's share of the table, and the six sum to the whole of it. it is stated
 * here rather than taken from a token because a share is a fact about these six columns and
 * nothing a design system could hold — packages/operator/src/styles/tokens.css's header names a
 * table column's percentage among the few things a screen still writes. the address takes the
 * largest share because it is the longest thing a donor has; the figure takes the smallest because
 * it is one value of a fixed width.
 */
const COLUMNS = [
	{ key: 'donor', label: 'Donor', width: '20%' },
	{ key: 'email', label: 'Email', width: '26%' },
	{ key: 'amount', label: 'Amount', kind: 'money', width: '12%' },
	{ key: 'often', label: 'How often', width: '14%' },
	{ key: 'status', label: 'Status', width: '14%' },
	{ key: 'next', label: 'Next charge', kind: 'date', width: '14%' }
] as const;

/** the screen's name, rendered as the document title and as the heading. */
const SCREEN_TITLE = 'Recurring gifts';

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context }: Route.LoaderArgs) {
	let plans: Awaited<ReturnType<typeof listRecurringPlans>>['plans'];
	let hasMore: boolean;
	try {
		({ plans, hasMore } = await listRecurringPlans(context.get(database)));
	} catch (e) {
		// the diagnostic lives on the loader for the reason /admin/donations's does: this is where
		// an unapplied migration actually surfaces, because the page cannot be drawn at all without
		// it, and a message anywhere else would be one nobody reads first.
		console.error('listing recurring gifts failed:', e);
		loadFailed('The recurring gifts list');
	}

	return {
		// an explicit projection rather than the row. the read already narrows `recurring_plan` to
		// the columns a list needs; this narrows again to what a browser is given, and turns the two
		// values that must not be formatted in a component into strings.
		plans: plans.map((p) => ({
			id: p.id,
			donorName: p.donorName,
			// `null` for a donor nobody holds an address for, and the page draws the absence rather
			// than this standing something in for it.
			donorEmail: p.donorEmail,
			// formatted here rather than in the page: the currency decides where the decimal point
			// goes and the stored value is an integer number of minor units, so a component
			// rendering `amountMinor` renders a gift a hundred times its size.
			amount: formatMinor(p.amountMinor, p.currency),
			// the value, not the word. `FREQUENCY_LABELS` in `packages/form/src/v1.ts` is what the page
			// renders it with — `RecurringInterval` is a subtype of `Frequency`, so the lookup
			// type-checks and a cadence with no label there is a type error.
			interval: p.interval,
			// the value, not the word. `RECURRING_STATUS_LABELS` in `$lib/recurring/statuses.ts` is
			// what the page renders it with, and a state with no label there is a type error.
			status: p.status,
			// the date only, ISO, formatted here for the reason /admin/donations formats
			// `receivedOn` here: an `Intl.DateTimeFormat` in the page would run once on the Worker
			// during ssr and again in the browser, in two different locales and time zones, which is
			// a hydration mismatch as well as a lie about whose "today" it is.
			//
			// `null` travels as `null`, because it means "none expected" and covers both an ended
			// commitment and one whose rail has not yet said — two different sentences on the
			// screen, and neither is reachable from a date chosen here.
			nextChargeOn: p.nextChargeAt === null ? null : p.nextChargeAt.toISOString().slice(0, 10)
		})),
		// so the page can say the list is capped rather than silently showing a prefix.
		limit: RECURRING_LIST_LIMIT,
		// exact, and not computed here: `listRecurringPlans` fetches one row past the cap and
		// reports whether it came back, then returns at most the cap. this route never sees that
		// row, which is why the count above and this flag cannot disagree.
		hasMore
	};
}

// what this page owes is that a staff member holding an email from a donor can find that donor:
// who committed, how to reach them, how much and how often, where it stands, and when it charges
// next. every row is a link to the one screen that can stop it.
//
// there is no action here and no create either. a recurring gift is made by a donor on a donation
// form, and stopping one happens on the screen that shows the gift being stopped.
export default function RecurringGifts({ loaderData }: Route.ComponentProps) {
	const { plans, limit, hasMore } = loaderData;
	const count = plans.length;

	return (
		// one column and the column is what spaces it: every block below carries no margin of its
		// own, so one that is not rendered leaves no space behind it. the wide measure, because a
		// table plane is what it exists for.
		<Column wide>
			{/* no action slot — nothing on this page creates anything. */}
			<PageHeader title={SCREEN_TITLE} />

			{/* the table sits in the column directly, and nothing wraps it: `.adm-plane` is a scroll
			    box, which is the one kind of grid item whose automatic minimum size is zero, so as
			    the column's own child it shrinks and scrolls at every width. a plain element between
			    the two is one the column can never make narrower than the whole table, and the page
			    would then scroll sideways instead of the plane — taking the pinned first column with
			    it, because `position: sticky` resolves against a box that never scrolls. */}
			<DataTable
				captionId={CAPTION_ID}
				// with rows, the sentence that says what the table holds and is what names it.
				// "still collecting first" and not "newest first": this list is ordered by status
				// ahead of date, so that the rows the cap keeps are the rows with a control on
				// them, and the caption has to say what the order actually is.
				//
				// with none there is no count worth stating and no order to state either — the word
				// is the screen's own noun, which `DataTable` gives the plane as its name so a
				// region with nothing in it is still announced as one. the row inside the table is
				// what says what the screen is waiting for.
				caption={
					count > 0
						? `${count} recurring ${count === 1 ? 'gift' : 'gifts'}, still collecting first.`
						: 'Recurring gifts'
				}
				capNote={hasMore ? `Only the first ${limit} are shown.` : undefined}
				columns={COLUMNS}
				rows={plans.map((plan) => ({
					// the commitment's own id, which is what keys the row. it is never rendered —
					// no column is keyed `id` — and it is here because keying by position instead
					// hands two rows that swap places each other's cells.
					id: plan.id,
					cells: {
						// the way in, and the link needs no class: `[data-pin]` sets its own ground, so
						// the link stays legible over content scrolling beneath it, and base.css gives
						// every link in /admin its ink and its focus ring.
						donor: <Link to={href('/admin/recurring/:id', { id: plan.id })}>{plan.donorName}</Link>,
						// a cell with nothing in it is dashed and set in the muted ink by the table
						// itself, which is why this reaches for no fallback.
						email: plan.donorEmail,
						amount: plan.amount,
						often: FREQUENCY_LABELS[plan.interval],
						status: <StatusWord>{RECURRING_STATUS_LABELS[plan.status]}</StatusWord>,
						// three renderings of one column, because null means "none expected" and that
						// covers two different situations. a date is a date. no date on a gift that is
						// still collecting is worth noticing, so it takes a word rather than a dash —
						// the rule /admin/donors states about an unanswered consent. no date on a gift
						// that has stopped or failed is the status word said twice, so it takes the
						// dash the table draws for a cell with nothing in it.
						//
						// the middle one states prose and that beats the column's date, because what
						// is in it is a sentence rather than a date: the muted tabular face that
						// never wraps is the reading for a date, and applied to a sentence it sets
						// it in figures and holds the column open to its full length.
						next: plan.nextChargeOn ? (
							<time dateTime={plan.nextChargeOn}>{plan.nextChargeOn}</time>
						) : plan.status === 'active' ? (
							{ reading: 'prose' as const, value: <StatusWord>Not scheduled yet</StatusWord> }
						) : null
					}
				}))}
				empty="No recurring gifts yet."
			/>
		</Column>
	);
}
