import { Button } from '@better-giving/operator/components/controls/Button';
import { DataTable } from '@better-giving/operator/components/data/DataTable';
import { Series } from '@better-giving/operator/components/data/Series';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { href, Link } from 'react-router';
import { screenTitle } from '$lib/admin/screen-title';
import { CONSENT_LABELS, consentState } from '$lib/contacts/consent';
import { KIND_LABELS } from '$lib/contacts/kinds';
import { formatMinor } from '$lib/donations/money';
import { FORM_CURRENCY } from '$lib/forms/amounts';
import {
	CONTACT_SORTS,
	CONTACT_VIEWS,
	type ContactSort,
	type ContactView,
	type SortDir
} from '$lib/contacts/sorts';
import {
	CONTACT_LIST_LIMIT,
	listContacts,
	readDonorSummary,
	readDonorViewCounts,
	type ContactOrder
} from '$lib/server/contacts/queries';
import { loadFailed } from '$lib/server/db/load-failure';
import { database } from '../context';
import type { Route } from './+types/_app.admin.donors._index';

// the donor list: a read, and only a read. this route has no action, and nothing anywhere adds a
// donor by hand — a donor row is written by the gift that names them
// (`$lib/server/contacts/queries.ts`, reached from the donation path).
//
// this file is deliberately thin. what reaches the database lives in `queries.ts`; the only job
// here is projecting rows onto what the page renders, and addressing.
//
// **the addressing is the loader's rather than the component's, and it is the one thing on this
// screen that is not a projection.** which order the file is in and which page of it is read are
// facts about the address, so the loader parses them out of the request and hands back the
// addresses a press leads to — the component renders links it is given and computes none. that is
// what lets `./_app.admin.donors._index.workers.spec.ts` assert every one of them: this screen has
// no `*.browser.spec.ts` and may not have one (CLAUDE.md → Two design systems), so an href built
// in the component is an href nothing reads back.

/** the element the table's caption is named by, and the only id this screen mints. */
const CAPTION_ID = 'donors-caption';

/**
 * the direction each column is worth reading first, on the press that sorts by it.
 *
 * a name reads up, from A: that is the order a person looks a donor up in. a figure reads down,
 * because the question a figure column answers is who is at the top of it — an operator pressing
 * "Given" is asking who gives the most, and handing them the donors who have given nothing is the
 * answer to a question nobody asked.
 *
 * it is only the *first* press. pressing the column the file is already in turns it over, which is
 * how the other end of either column is reached.
 */
const FIRST_PRESS = { name: 'asc', gifts: 'desc', given: 'desc' } as const satisfies Record<
	ContactSort,
	SortDir
>;

const OVER = { asc: 'desc', desc: 'asc' } as const;

/** the order the screen loads under when the address says nothing: the biggest donors first. */
const DEFAULT_ORDER: ContactOrder = { sort: 'given', dir: 'desc', page: 1, view: 'all' };

/**
 * the order and the page the address asks for, with anything it cannot answer for defaulted.
 *
 * nothing here refuses. it is an operator's own screen rather than the public API — where a 4xx
 * naming the offending value is the contract (CLAUDE.md → Boundaries) — and a value nobody could
 * have typed by accident still has a donor file behind it. a screen that answered a mistyped
 * `?sort=` with an error would be one an operator cannot get out of by pressing anything on it.
 *
 * `page` is read past a `Number` rather than a `parseInt`, so `1.5` and `abc` are the same answer:
 * a page is a whole number of pages from the start of the file, and a fraction of one is not a
 * smaller mistake than a word. the far end is not checked here — `listContacts` holds the page
 * inside the file that exists, because only the read knows how many pages there are.
 *
 * `view` falls back like the rest, and `all` is what an absent one reads as: the whole file is the
 * screen's own address and carries no `view=` at all.
 */
function readOrder(url: URL): ContactOrder {
	const sort = url.searchParams.get('sort');
	const dir = url.searchParams.get('dir');
	const page = Number(url.searchParams.get('page'));
	const view = url.searchParams.get('view');
	return {
		sort: CONTACT_SORTS.find((known) => known === sort) ?? DEFAULT_ORDER.sort,
		dir: dir === 'asc' || dir === 'desc' ? dir : DEFAULT_ORDER.dir,
		page: Number.isInteger(page) && page >= 1 ? page : DEFAULT_ORDER.page,
		view: CONTACT_VIEWS.find((known) => known === view) ?? DEFAULT_ORDER.view
	};
}

/**
 * how a view is spelled in an address, which for the whole file is not at all.
 *
 * `/admin/donors` is the file's own address and every press inside the all view keeps it bare —
 * `?view=all` would be a second address for one screen, which is two entries in a browser's history
 * for the same rows and two links a reader has to recognise as the same place.
 */
function viewParam(view: ContactView): string {
	return view === 'all' ? '' : `&view=${view}`;
}

/**
 * how a month is spelled under either end of the run — 'Oct 2025'.
 *
 * built here rather than in the component for the reason the money and the date columns are: an
 * `Intl` call in the page runs once on the Worker and again in the browser, in two different
 * locales and time zones, which is a hydration mismatch as well as a lie about whose month it is.
 * `UTC` because the buckets are UTC calendar months, and a label formatted in another zone would
 * name a month the count beneath it is not of.
 *
 * `en-US` matches `DISPLAY_LOCALE` in $lib/donations/money.ts, which is private to that module —
 * one deployment states its figures in one language, and a second spelling of that decision is
 * where the two start to disagree rather than a reason to widen the first.
 */
const MONTH_LABEL = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	year: 'numeric',
	timeZone: 'UTC'
});

/** the screen's name, rendered as the document title and as the heading. */
const SCREEN_TITLE = 'Donors';

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const order = readOrder(new URL(request.url));

	// three reads and one failure. neither figure over the list is a decoration on it — a card of
	// zeroes under a file of donors, or a nav counting nobody over a table of rows, is a figure an
	// operator would act on — so the screen is drawn from all three or from none.
	//
	// the two view counts are read on every load, including a sort or a page inside a view. they
	// are the file's own size rather than the page's, so they do not move as an operator reads;
	// re-reading them is what keeps that true against a gift that arrives mid-read, and there is
	// nothing here to cache (CLAUDE.md → Bans, on caching a number).
	let file: Awaited<ReturnType<typeof listContacts>>;
	let donors: Awaited<ReturnType<typeof readDonorSummary>>;
	let views: Awaited<ReturnType<typeof readDonorViewCounts>>;
	try {
		[file, donors, views] = await Promise.all([
			listContacts(context.get(database), order),
			// the clock is the loader's to state: the read takes `now` so a spec can pin which
			// month is the current one, and this is the one place that answers it for real.
			readDonorSummary(context.get(database), new Date()),
			readDonorViewCounts(context.get(database))
		]);
	} catch (e) {
		console.error('loading the donor screen failed:', e);
		loadFailed('The donor list');
	}

	const { contacts, total, page, pages } = file;
	const screen = href('/admin/donors');
	// every address a press on this screen leads to carries the view, because a sort or a page is a
	// move inside the view rather than out of it. `viewParam` is what decides how — the all view's
	// addresses stay bare.
	const ordered = (sort: ContactSort, dir: SortDir) =>
		`${screen}?sort=${sort}&dir=${dir}${viewParam(order.view)}`;

	return {
		// the three figures over the list. they count donors whose money has actually moved, and
		// the list beneath counts contact rows — a contact typed into the create form is on the
		// list and is nobody's donor until a gift settles, so the two are meant to disagree
		// ($lib/server/contacts/queries.ts argues which is which).
		//
		// the two ends of the run cross as words rather than as instants, on the same terms as
		// every other formatted value here: `MONTH_LABEL` above states why.
		summary: {
			total: donors.total,
			thisMonth: donors.thisMonth,
			points: donors.points,
			first: MONTH_LABEL.format(donors.firstMonth),
			last: MONTH_LABEL.format(donors.lastMonth)
		},
		// an explicit projection rather than the row: `attributes` is the extension column and
		// nothing renders it yet, and shipping columns to the browser because they happened to
		// be selected is how a later column leaks by default.
		//
		// when a second route projects a contact, this mapper moves into `contacts/` so "never
		// publish `attributes`" is stated once. one call site is not yet a module.
		contacts: contacts.map((c) => ({
			id: c.id,
			kind: c.kind,
			displayName: c.displayName,
			primaryEmail: c.primaryEmail,
			primaryPhone: c.primaryPhone,
			// the answer as stored, all three states of it. `null` is not "no" and must never be
			// projected as one: it is a donor nobody put the question to, which the donation
			// path accepts deliberately (`consentedToContact` in
			// `$lib/server/donations/quote-input.ts`). the word a screen shows is
			// `CONSENT_LABELS` in `$lib/contacts/consent.ts`, which a component may import.
			consentedToContact: c.consentedToContact,
			// how many gifts settled, as the integer it is counted as.
			gifts: c.gifts,
			// and what those gifts left the organisation, as the string a screen shows. the
			// division into major units is the last step before a page and its result is never
			// read back as a number (`$lib/donations/money.ts`), so it is taken here rather than
			// in the component: an `Intl` call in the page runs once on the Worker and again in
			// the browser, in two different locales, which is a hydration mismatch as well as a
			// lie about whose thousands separator it is.
			//
			// `FORM_CURRENCY` rather than a currency read off the rows. every form this
			// deployment writes carries that one code (`$lib/server/forms/queries.ts`), so a
			// donor's gifts are all in it — and the figure is a sum, which is a number only one
			// currency can be added into.
			given: formatMinor(c.given, FORM_CURRENCY),
			// the date only, ISO, formatted here rather than in the component. an
			// `Intl.DateTimeFormat` in the page would run once on the Worker during ssr and
			// again in the browser, in two different locales and time zones, which is a
			// hydration mismatch as well as a lie about whose "today" it is. a fixed format has
			// neither problem, and `<time dateTime>` carries the machine-readable value.
			createdOn: c.createdAt.toISOString().slice(0, 10)
		})),
		// every unarchived donor, which is what the caption counts against — the page it is on is
		// a slice of that rather than the whole of what the deployment holds.
		total,
		// the page actually read, which is not always the one asked for: an address past the end
		// of the file reads the last page, so this is what the paging pair is built from.
		page,
		pages,
		// where this page starts in the file, 1-based. one number rather than the pair, because
		// the far end is this plus the rows that came back — and stating both would be two facts
		// that can disagree about a short last page.
		from: (page - 1) * CONTACT_LIST_LIMIT + 1,
		sort: order.sort,
		dir: order.dir,
		// which view is being read, and how many donors each holds. the counts are the file's and
		// not the page's, so both stand on both views — an operator moving between them is reading
		// two figures that were true at the same instant.
		view: order.view,
		views,
		// the two views as the addresses they are. each is the bare address of that view: a press
		// here is a move to the other reading of the file, which starts at its first page in the
		// order that view is worth opening in.
		viewLinks: {
			all: screen,
			recurring: `${screen}?view=recurring`
		} satisfies Record<ContactView, string>,
		// where a press on each sortable head goes. the sorted column turns over and every other
		// one sorts the way that column is worth reading first, and none of them carries the page:
		// a new order is a new first page, and keeping the page would land an operator in the
		// middle of a file they have just reordered.
		sorts: Object.fromEntries(
			CONTACT_SORTS.map((key) => [
				key,
				ordered(key, key === order.sort ? OVER[order.dir] : FIRST_PRESS[key])
			])
		) as Record<ContactSort, string>,
		// the two paging presses, `null` where there is no page that way. they carry the order, so
		// a move to the next page does not re-sort the file under the operator mid-read.
		previous: page > 1 ? `${ordered(order.sort, order.dir)}&page=${page - 1}` : null,
		next: page < pages ? `${ordered(order.sort, order.dir)}&page=${page + 1}` : null
	};
}

// what this page owes is that every donor a deployment holds can be read.
export default function Donors({ loaderData }: Route.ComponentProps) {
	const { contacts, summary, total, pages, from, sort, dir, sorts, previous, next } = loaderData;
	const { view, views, viewLinks } = loaderData;
	const to = from + contacts.length - 1;

	/**
	 * where a press on this head goes, and — on the one column the rows are actually in the order
	 * of — which way it runs.
	 *
	 * `null` on the other two, which is what `DataTable` draws as a head with a destination and no
	 * state: a mark on every sortable head would stop the mark on the sorted one being the answer
	 * to which column the file is ordered by.
	 */
	function pressed(key: ContactSort) {
		return {
			href: sorts[key],
			dir: key !== sort ? null : dir === 'asc' ? ('ascending' as const) : ('descending' as const)
		};
	}

	/**
	 * what each column is worth, in the order an operator reads a row.
	 *
	 * the first is the row's own header and what the plane pins to the leading edge: the name is
	 * what the other seven fields are about, so a screen reader announces it with each of them.
	 * `DataTable` decides that from position — the first column is the `th` — so the order here is
	 * the arrangement and not only the sequence.
	 *
	 * the two figures stand next to the name and ahead of how to reach the donor, because they are
	 * what the file is read for: who gives, and how much. the ways of reaching them follow.
	 *
	 * "May contact" has three answers, never two. "Not asked" is a donor who may still be asked;
	 * "No" is a decision to honour.
	 *
	 * a `width` is the column's share of the table, and the eight sum to the whole of it. it is
	 * stated here rather than taken from a token because a share is a fact about these eight
	 * columns and nothing a design system could hold —
	 * packages/operator/src/styles/tokens.css's header names a table column's percentage among the
	 * few things a screen still writes. the address takes the largest share because it is the
	 * longest thing a donor has; the two figures and the date take the smallest because each is one
	 * value of a fixed width.
	 *
	 * three of them carry a `sort`, and the rest are labels. sorting is offered where a whole file
	 * has an order worth putting it in — a name and the two figures — and not on a column whose
	 * order tells a reader nothing they came here for.
	 */
	const columns = [
		{ key: 'name', label: 'Name', width: '18%', sort: pressed('name') },
		{ key: 'gifts', label: 'Gifts', kind: 'count', width: '8%', sort: pressed('gifts') },
		{ key: 'given', label: 'Given', kind: 'money', width: '11%', sort: pressed('given') },
		{ key: 'kind', label: 'Kind', width: '10%' },
		{ key: 'email', label: 'Email', width: '22%' },
		{ key: 'phone', label: 'Phone', width: '13%' },
		{ key: 'consent', label: 'May contact', width: '10%' },
		{ key: 'added', label: 'Added', kind: 'date', width: '8%' }
	] as const;

	return (
		// one column and the column is what spaces it: every block below carries no margin of its
		// own, so one that is not rendered leaves no space behind it. the wide measure, because a
		// table plane is what it exists for.
		<Column wide>
			<PageHeader title={SCREEN_TITLE} />

			{/* the summary, composed here rather than mounted: `.adm-summary` is a modifier on the
			    record card and the card's own part draws a head, which three blocks standing side
			    by side have none of — packages/operator/src/styles/adm.css argues it at the rule.

			    it stands whatever the figures are. a fresh deployment reads three zeroes and a
			    flat run, which is the same card saying the same thing about a year nothing landed
			    in — an absent card would leave an operator to work out whether the screen had
			    failed to draw one. */}
			<div className="adm-record adm-summary">
				<StatedValue label="Total donors" value={summary.total} />
				<StatedValue label="New this month" value={summary.thisMonth} />
				<Series
					label="New donors, last 12 months"
					points={summary.points}
					first={summary.first}
					last={summary.last}
				/>
			</div>

			{/* the two views of one file, each carrying its own count.

			    they are addresses rather than a toggle, so each is a link and the one being read
			    carries `aria-current` — and the difference a reader sees is the bordered default
			    rank against the quiet one's absence of a border, which is the whole of it. no new
			    class: the rank is what says which view is open.

			    `aria-current="true"` and never `"page"`. the rail's Donors cell already claims the
			    page on this screen (packages/operator/src/components/shell/AppShell.jsx), and a
			    second element claiming it is two answers to "where am I" in one document. this is
			    the other kind of current — the current one of these.

			    both counts stand on both views, so the press states what it leads to rather than
			    only where it goes. */}
			<nav className="adm-actions" aria-label="Which donors">
				<Button
					as={Link}
					to={viewLinks.all}
					variant={view === 'all' ? 'default' : 'quiet'}
					aria-current={view === 'all' ? 'true' : undefined}
				>
					All donors ({views.all})
				</Button>
				<Button
					as={Link}
					to={viewLinks.recurring}
					variant={view === 'recurring' ? 'default' : 'quiet'}
					aria-current={view === 'recurring' ? 'true' : undefined}
				>
					Recurring donors ({views.recurring})
				</Button>
			</nav>

			{/* the table sits in the column directly, and nothing wraps it — the reason is on the
			    same call in ./_app.admin.donations.tsx: a plain element between the column and the
			    plane is one the column can never make narrower than the whole table, so the page
			    scrolls sideways instead of the plane and the pinned first column goes with it. */}
			<DataTable
				captionId={CAPTION_ID}
				// with rows, the sentence that says what the table holds and is what names it. with
				// none there is no count worth stating and none is drawn — the word is the screen's
				// own noun, which `DataTable` gives the plane as its name so a region with nothing
				// in it is still announced as one. the row inside the table is what says what the
				// screen is waiting for.
				//
				// on a file of more than one page the count moves out of the caption and into the
				// note beside it, because a bare count over a page showing a hundred of them reads
				// as the count of what is on the screen.
				caption={
					view === 'recurring'
						? total === 0
							? 'Recurring donors'
							: pages > 1
								? 'Recurring donors.'
								: `${total} recurring ${total === 1 ? 'donor' : 'donors'}.`
						: total === 0
							? 'Donors'
							: pages > 1
								? 'Donors.'
								: `${total} ${total === 1 ? 'donor' : 'donors'}.`
				}
				capNote={pages > 1 ? `Showing ${from}-${to} of ${total}.` : undefined}
				columns={columns}
				rows={contacts.map((c) => ({
					// the donor's own id, which is what keys the row. it is never rendered — no
					// column is keyed `id` — and it is here because keying by position instead
					// hands two rows that swap places each other's cells.
					id: c.id,
					cells: {
						name: c.displayName,
						// never dashed, and neither is the figure beside it: a donor who has given
						// nothing is a fact the file states, and a dash there reads as a figure
						// nobody could work out.
						gifts: c.gifts,
						given: c.given,
						kind: KIND_LABELS[c.kind],
						// a cell with nothing in it is dashed and set in the muted ink by the table
						// itself, which is why neither column reaches for a fallback here.
						email: c.primaryEmail,
						phone: c.primaryPhone,
						// never dashed, deliberately: an absent answer is a state with a word of its own,
						// and an em dash beside two donors who answered reads as missing data.
						consent: (
							<StatusWord secondary>
								{CONSENT_LABELS[consentState(c.consentedToContact)]}
							</StatusWord>
						),
						added: <time dateTime={c.createdOn}>{c.createdOn}</time>
					}
				}))}
				// a fresh deployment and not an error, which is why `DataTable` marks it with an
				// info one. the recurring view drops the "yet": a deployment can hold a full file
				// of donors and none giving on a schedule, so a word promising that some are coming
				// would be one the nav above it has already contradicted.
				empty={view === 'recurring' ? 'No recurring donors.' : 'No donors yet.'}
			/>

			{/* the pair, drawn only where there is a second page to move to. both stand whichever
			    page is open, and the one that goes nowhere is a disabled control rather than an
			    absent one: a row whose single press changes place between pages is one an operator
			    has to look at before pressing.

			    the press that goes nowhere is a `<button>` and not a link, because there is no
			    address for it to carry — an anchor with nothing to point at is not something a
			    keyboard can reach or a reader is told about. */}
			{pages > 1 ? (
				<div className="adm-actions">
					{previous ? (
						<Button as={Link} mark="arrow-left" to={previous}>
							Previous
						</Button>
					) : (
						<Button disabled mark="arrow-left" type="button">
							Previous
						</Button>
					)}
					{next ? (
						<Button as={Link} markAfter="chevron-right" to={next}>
							Next
						</Button>
					) : (
						<Button disabled markAfter="chevron-right" type="button">
							Next
						</Button>
					)}
				</div>
			) : null}
		</Column>
	);
}
