import { Series } from '@better-giving/operator/components/data/Series';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { href, Link } from 'react-router';
import { screenTitle } from '$lib/admin/screen-title';
import { formatMinor } from '$lib/donations/money';
import { FORM_CURRENCY } from '$lib/forms/amounts';
import { readDonorSummary } from '$lib/server/contacts/queries';
import { loadFailed } from '$lib/server/db/load-failure';
import { readGiftsByMonth } from '$lib/server/donations/queries';
import { readRaisedByMonth } from '$lib/server/ledger/queries';
import { overMonths } from '$lib/server/months';
import { readActiveRecurringCount } from '$lib/server/recurring/queries';
import { database } from '../context';
import type { Route } from './+types/_app.admin._index';

// the staff home: the state of giving in one look, and nothing an operator has to press to see.
//
// what it holds is the month — what was raised in it and how many gifts made that — beside the
// shape the month sits in: everything raised since the deployment opened, and the twelve months
// behind it. the donor summary under those is the same card the donor file states over its own
// list, with a way through to it.
//
// **the books are what every figure is derived from and never the face of the screen.** there is
// no table of accounts here and no figure carries an account's name: what the processor kept and
// what is left after it are off this screen entirely, and nothing stands in their place. every
// figure is a `SUM` or a `COUNT` taken on the request — no column, no cache, no stored total
// (CLAUDE.md → Bans).
//
// four reads and two failure modes, which is the one thing on this screen that is not a
// projection. three of them are the screen: the money, the gifts and the donors fail as one and
// land the reader on the error boundary, because a card of noughts over a deployment that has
// taken gifts is a figure an operator would act on. the commitments are a count over a table of
// their own and are guarded alone — that read failing costs one figure, and the screen says which
// rather than drawing a nought in its place.

/** the screen's name, rendered as the document title and as the heading. */
const SCREEN_TITLE = 'Dashboard';

/**
 * the month the headline names, spelled out — 'September'.
 *
 * formatted in the loader for the reason every other value here is: an `Intl` call in the page runs
 * once on the Worker and again in the browser, in two different locales and time zones, which is a
 * hydration mismatch as well as a lie about whose month it is. `UTC` because the buckets are UTC
 * calendar months ($lib/server/months.ts), and a name formatted in another zone would name a month
 * the figure beneath it is not of.
 *
 * `en-US` matches `DISPLAY_LOCALE` in $lib/donations/money.ts, which is private to that module —
 * one deployment states its figures in one language, and a second spelling of that decision is
 * where the two start to disagree rather than a reason to widen the first.
 */
const MONTH_NAME = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });

/** how a month is spelled under either end of the run — 'Oct 2025'. the donor screen's own. */
const MONTH_LABEL = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	year: 'numeric',
	timeZone: 'UTC'
});

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context }: Route.LoaderArgs) {
	const db = context.get(database);
	// **the clock is read once, here.** every figure on this screen is derived against it, so two
	// of them cannot straddle a month change mid-render — a headline naming September beside a run
	// whose last bucket is October is a screen disagreeing with itself, and it happens on exactly
	// one request a month.
	const now = new Date();

	const screen = Promise.all([
		readRaisedByMonth(db),
		readGiftsByMonth(db),
		readDonorSummary(db, now)
	]);
	// guarded on its own, and the handler is attached in the same turn the read is started so the
	// rejection is never an unhandled one when the three above throw first.
	const commitments = readActiveRecurringCount(db).then(
		(active) => active,
		(e) => {
			console.error('reading the active recurring gifts failed:', e);
			return null;
		}
	);

	let raised: Awaited<ReturnType<typeof readRaisedByMonth>>;
	let gifts: Awaited<ReturnType<typeof readGiftsByMonth>>;
	let donors: Awaited<ReturnType<typeof readDonorSummary>>;
	try {
		[raised, gifts, donors] = await screen;
	} catch (e) {
		console.error('loading the dashboard failed:', e);
		loadFailed('The dashboard');
	}

	const money = overMonths(
		raised.map((row) => ({ month: row.month, total: row.raisedMinor })),
		now
	);
	const collected = overMonths(
		gifts.map((row) => ({ month: row.month, total: row.gifts })),
		now
	);

	return {
		// the month by name rather than the words "this month". a period nobody named is the one
		// thing a screen of figures cannot show, and naming it costs no sentence.
		month: MONTH_NAME.format(now),
		// `FORM_CURRENCY` rather than a currency read off the rows: every form this deployment
		// writes carries that one code ($lib/server/forms/queries.ts), and the figure is a sum,
		// which is a number only one currency can be added into.
		raisedMonth: formatMinor(money.thisMonth, FORM_CURRENCY),
		raisedAll: formatMinor(money.total, FORM_CURRENCY),
		// a count and not a formatted string: counts are stated unseparated.
		giftsMonth: collected.thisMonth,
		// `null` is the one read that could not be answered, and the screen draws a word in its
		// slot rather than a nought — nought is a figure and would read as "none holds one".
		recurringActive: await commitments,
		// the run and its two ends, crossing as words rather than as instants on the same terms as
		// every other formatted value here.
		series: {
			points: money.points,
			first: MONTH_LABEL.format(money.firstMonth),
			last: MONTH_LABEL.format(money.lastMonth)
		},
		// the donor file's own two figures, to the number: the dashboard and the donors page never
		// state a different count of the same thing.
		donors: { total: donors.total, thisMonth: donors.thisMonth }
	};
}

// what this page owes is that an operator opening the deployment can see how giving stands without
// pressing anything.
export default function Dashboard({ loaderData }: Route.ComponentProps) {
	const { month, raisedMonth, raisedAll, giftsMonth, recurringActive, series, donors } = loaderData;

	return (
		// one column and the column is what spaces it: every block below carries no margin of its
		// own. the narrow measure, because nothing here is a table plane.
		<Column>
			<PageHeader title={SCREEN_TITLE} />

			{/* attention and not blocker: one figure is missing and nothing on this deployment is
			    stopped by it. the word, and nothing under it — what is said is which figure could
			    not be read, and the errand for fixing it is not on this screen. */}
			{recurringActive === null ? (
				<Banner tone="attention" word="Recurring gifts could not be read" />
			) : null}

			{/* the headline card. the cards are composed here rather than mounted: `.adm-headline`
			    is a modifier on the record card and that card's own part draws a head, which three
			    figures standing side by side have none of — packages/operator/src/styles/adm.css
			    argues it at the rule. */}
			<div className="adm-record adm-headline">
				<StatedValue display num label={`Raised in ${month}`} value={raisedMonth} />
				<StatedValue num label={`Gifts in ${month}`} value={giftsMonth} />
				{/* the word takes no tabular figures: they set the digits wider than the letters
				    around them, and there are no digits here to line up with anything. */}
				<StatedValue
					num={recurringActive === null ? undefined : true}
					label="Active recurring gifts"
					value={recurringActive ?? <StatusWord>Unavailable</StatusWord>}
				/>
			</div>

			<div className="adm-record adm-year">
				<StatedValue num label="Raised all time" value={raisedAll} />
				<Series
					label="Raised, last 12 months"
					points={series.points}
					first={series.first}
					last={series.last}
				/>
			</div>

			{/* the pair the donor card stands in, holding one card: the row is what a second card
			    arrives into. */}
			<div className="adm-cardpair">
				<div className="adm-record adm-donors">
					<StatedValue num label="Total donors" value={donors.total} />
					<StatedValue num label="New this month" value={donors.thisMonth} />
					{/* a link and not a button: it goes to an address and changes nothing. */}
					<Link className="adm-donors__through" to={href('/admin/donors')}>
						All donors
					</Link>
				</div>
			</div>
		</Column>
	);
}
