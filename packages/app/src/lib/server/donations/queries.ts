import type { TributeKind } from '@better-giving/form/v1';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { readContactNames } from '../contacts/queries';
import type { Db } from '../db/client';
import { donation, payment, program, type Donation, type Payment } from '../db/schema';
import type { DonationStatus } from '../../donations/statuses';
import { projectTribute } from '../../donations/tributes';

// every read of `donation` but one, so the table object leaves this module in a single place —
// the same boundary ../forms/queries.ts and ../contacts/queries.ts draw, with the one crossing
// named rather than left for a reader to find.
//
// `program` is named here too, and only as a left join for the cause's name — the same crossing
// `findTarget` in ./settle.ts makes into `form`, and for the same saving: a name for a column on the
// page, at no second round trip. ../programs/queries.ts owns every write of that table and every
// read that has a rule in it.
//
// the exceptions are `listContacts` and `readDonorSummary` in ../contacts/queries.ts, which name
// `donation` and `payment` to answer two questions about donors rather than about gifts: what each
// donor has given, and which month each donor's money first moved. both are one statement whose
// driving table is `contact` — the file is sorted by that total across the whole of it, and
// whether a donor is counted at all turns on `contact.archived_at`; that file's own header argues
// both at length.
//
// **those reads say in SQL what `projectStatus` below says in TypeScript, and the three have to
// keep agreeing** — a succeeded inbound attempt collects, a succeeded refund takes back, every
// other attempt counts for nothing. the summary spends only the first of those, because a count of
// donors is not money and a refund takes nothing off one. a change to the rule here is a change to
// the `case when` there, and a screen calling a gift `pending` while the donor file counts it is
// the failure that costs.
//
// no writes. a gift is written by ./record.ts, which composes four tables in one `batch()` and is
// named for that; this file is the other half the name left room for. `contact` is not read here
// either, even though the list names the donor: `readContactNames` in ../contacts/queries.ts is
// what reads it, for the reason stated there.

/**
 * the part of a `payment` row the projection reads.
 *
 * derived from `Payment` rather than written out, so a column that is renamed or retyped is a
 * compile error here rather than a field that silently stops arriving.
 */
export type SettlementAttempt = Pick<
	Payment,
	'id' | 'direction' | 'status' | 'amountMinor' | 'occurredAt'
>;

/** minor units, added as the integers they are stored as. */
function sum(attempts: readonly SettlementAttempt[]): number {
	return attempts.reduce((total, a) => total + a.amountMinor, 0);
}

/**
 * the last of these attempts in business time, or `undefined` if there are none.
 *
 * `occurred_at` and never `created_at` or the order the rows came back in: the business time is
 * when the money moved, and it is the only one of the three that survives a webhook redelivered
 * out of order or a staff member entering last month's cheque today.
 *
 * ties are broken by `id`, and that is not decoration. `occurred_at` is Unix ms and workerd freezes
 * the clock between I/O, so two attempts opened in one request routinely share a timestamp — and
 * `id` is a uuidv7 minted app-side, so the greater id is the later row. without it the answer is
 * whatever order the rows arrived in, and a gift would read `failed` on one load and `cancelled` on
 * the next.
 */
function latestOf(attempts: readonly SettlementAttempt[]): SettlementAttempt | undefined {
	return attempts.reduce<SettlementAttempt | undefined>((latest, a) => {
		if (!latest) return a;
		const at = a.occurredAt.getTime();
		const best = latest.occurredAt.getTime();
		if (at > best) return a;
		if (at === best && a.id > latest.id) return a;
		return latest;
	}, undefined);
}

/**
 * what a gift is, from its settlement attempts alone — the projection the `donation` table exists
 * without a `status` column in order to have.
 *
 * it is written in TypeScript over rows already read rather than in SQL, and that is the shape of
 * the whole read below: the states are decided by "the latest inbound attempt" and "succeeded
 * refunds against what succeeded inbound collected", both of which are correlated subqueries per
 * donation. one extra read of `payment` for the page's donation ids answers all of them at once.
 *
 * a `succeeded` inbound attempt is what makes a gift collected, and once one exists no later
 * attempt takes it back — money that moved is undone by a refund, which is a row of its own, and
 * never by a retry the rail refused. only a gift with no succeeded attempt falls through to the
 * latest one, which is what separates a card being retried from a card that lost the gift.
 *
 * the total refunds are measured against is what the inbound attempts collected, not
 * `donation.total_minor`. the two are the same number on every gift this app writes, and where
 * they are not — a rail that settled short — the collected figure is the one a refund can reach,
 * so it is the one that decides whether a gift is whole again. it also keeps this function a
 * function of `payment` rows alone.
 *
 * a refund that is `pending`, `failed` or `cancelled` counts toward nothing. it is money the org
 * still holds, and reading it as gone reports a refund on the strength of an intention.
 */
export function projectStatus(attempts: readonly SettlementAttempt[]): DonationStatus {
	const inbound = attempts.filter((a) => a.direction === 'inbound');
	const collected = sum(inbound.filter((a) => a.status === 'succeeded'));
	if (collected > 0) {
		const refunded = sum(
			attempts.filter((a) => a.direction === 'refund' && a.status === 'succeeded')
		);
		if (refunded >= collected) return 'refunded';
		if (refunded > 0) return 'partially_refunded';
		return 'completed';
	}

	const latest = latestOf(inbound);
	if (latest?.status === 'failed') return 'failed';
	if (latest?.status === 'cancelled') return 'cancelled';
	return 'pending';
}

/**
 * how many gifts a list page returns.
 *
 * the number is bounded from two ends. it is a `LIMIT` because the list is every gift a deployment
 * has ever taken, and the newest are the ones worth keeping — that is the same argument
 * `CONTACT_LIST_LIMIT` makes in ../contacts/queries.ts.
 *
 * the other end is the one this constant has that that one does not: the page's ids are bound into
 * two follow-up reads, one parameter per id, and D1 caps a query at 100 bound parameters. so this
 * has to stay well under 100 whatever anyone later decides about page size — a limit raised past it
 * does not read slowly, it fails the query. the probe row never reaches those reads (see
 * `listDonations`), so the count bound is this number exactly.
 */
export const DONATION_LIST_LIMIT = 50;

/**
 * the columns of `donation` this page renders, and `contact_id`, which it does not — that one is
 * how the donor's name is looked up.
 *
 * derived from `Donation` rather than written out, for the reason `FormListRow` is in
 * ../forms/queries.ts: a column renamed or retyped is a compile error here rather than a field that
 * silently stops arriving. everything else on the row stays out — the receipt timestamps, the fee
 * and tax splits, the attribution columns — because a column reaches a browser by being selected,
 * and a projection is the only thing that stops the next one added from doing so by default.
 */
type DonationRow = Pick<
	Donation,
	| 'id'
	| 'contactId'
	| 'totalMinor'
	| 'currency'
	| 'receivedAt'
	| 'source'
	| 'note'
	| 'recurringId'
	| 'tributeKind'
	| 'tributeHonoree'
>;

/**
 * the row plus the one column that is not on it: what the cause this gift went to is called, or
 * `null` where it went to none.
 *
 * kept apart from `DonationRow` above because that type is derived from `Donation`, and a key no
 * column of that table carries would have to be written out and so could not be checked against
 * anything.
 *
 * the name and never `program_id`, which is the same call `DonationListRow.repeating` below makes
 * about `recurring_id`: a pointer in a browser payload that nothing renders is a column reaching a
 * browser by accident. the pointer is not selected at all — the join is what answers this.
 */
type DonationSelection = DonationRow & { readonly programName: string | null };

/**
 * the columns above, as drizzle needs them named.
 *
 * spelled out beside the type it must agree with, and `satisfies` is what ties them together: a
 * column added to one and not the other stops compiling.
 */
const DONATION_COLUMNS = {
	id: donation.id,
	contactId: donation.contactId,
	totalMinor: donation.totalMinor,
	currency: donation.currency,
	receivedAt: donation.receivedAt,
	source: donation.source,
	note: donation.note,
	recurringId: donation.recurringId,
	// the two columns a dedication is stated from, and not the two beside them: who the donor asked
	// us to tell is operational state the notification owns, and `tribute_notified_at` — the column
	// that would report it — is written by nothing yet. a third party's address selected for no
	// screen is exactly what this projection exists to stop.
	tributeKind: donation.tributeKind,
	tributeHonoree: donation.tributeHonoree,
	// off the join below rather than off `donation`, which is the whole reason `DonationSelection`
	// exists beside `DonationRow`: the row carries `program_id` and the page renders a name.
	programName: program.name
} satisfies Record<keyof DonationSelection, SQLiteColumn>;

/** an attempt with the gift it settles, which is the only extra column the grouping needs. */
type AttemptRow = SettlementAttempt & Pick<Payment, 'donationId'>;

const ATTEMPT_COLUMNS = {
	id: payment.id,
	donationId: payment.donationId,
	direction: payment.direction,
	status: payment.status,
	amountMinor: payment.amountMinor,
	occurredAt: payment.occurredAt
} satisfies Record<keyof AttemptRow, SQLiteColumn>;

/** one gift as a screen shows it: the row, the donor it came from, and the state it is in. */
export type DonationListRow = Omit<
	DonationSelection,
	'contactId' | 'recurringId' | 'tributeKind' | 'tributeHonoree'
> & {
	/** always populated — `contact.display_name` is denormalized so no list branches on kind. */
	donorName: string;
	/** derived, never stored. see `projectStatus`. */
	status: DonationStatus;
	/**
	 * whether this charge was collected under a standing commitment.
	 *
	 * a boolean and never `recurring_id` itself. the id is selected because it is the only thing
	 * that answers the question, and it stops here: an id in a browser payload that nothing renders
	 * is a column reaching a browser by accident, which is the whole reason `DONATION_COLUMNS` above
	 * is a projection rather than a `select()`. the screen next door is where a commitment is read
	 * by id, and it is reached by donor rather than from a gift.
	 */
	repeating: boolean;
	/**
	 * who the gift is given in honor or in memory of, or `null` where it is given for nobody.
	 *
	 * one value rather than the two columns it comes from, so a kind naming nobody is a shape no
	 * screen downstream has to answer for — the pairing is settled once, by `projectTribute` in
	 * ../../donations/tributes.ts, the same way `Tribute` in ./quote-input.ts settles it on the way
	 * in.
	 */
	tribute: { kind: TributeKind; honoree: string } | null;
};

/**
 * one page of gifts: at most `DONATION_LIST_LIMIT` of them, and whether more exist.
 *
 * the probe row is sliced off inside `listDonations` rather than handed over with a warning, so
 * there is no shape in which a caller renders `DONATION_LIST_LIMIT + 1` gifts by forgetting to
 * slice. the cap belongs to this module; the page only reports it.
 */
export type DonationPage = {
	/** newest first, capped. never contains the probe row. */
	donations: DonationListRow[];
	/** true when the probe came back — there are gifts this page is not showing. */
	hasMore: boolean;
};

/**
 * the gifts a deployment has taken, newest first, each with its donor and its state.
 *
 * three reads and no join, in that shape deliberately. the state is a projection over the gift's
 * settlement attempts — the latest inbound one, and what succeeded refunds add up to — and every
 * one of those is a correlated subquery per row if it is asked in SQL. reading the page first and
 * then the `payment` rows for exactly those gifts answers all of them at once, in TypeScript, where
 * `projectStatus` above can be read and tested on its own. the third read is the donor names, which
 * is a separate read rather than a join for a reason about module boundaries rather than cost — see
 * `readContactNames` in ../contacts/queries.ts.
 *
 * ordered by `received_at` then `id`, and the tiebreak is not decoration: the column is Unix ms, so
 * two gifts entered in one request tie on it, and an unordered list is one that reshuffles between
 * loads. `donation_received_at_idx` backs the first key, so SQLite walks that index in reverse and
 * stops at the `LIMIT` rather than sorting the table — the tiebreak is resolved within a run of
 * equal timestamps and does not cost the plan. that is a weaker claim than `listContacts` makes
 * about the primary key, and it is the honest one for a secondary index: the rows themselves are
 * still fetched by rowid.
 *
 * `hasMore` comes from a probe row, the same shape `listContacts` uses and for the same reason: it
 * cannot be inferred from a full page, because `donations.length >= DONATION_LIST_LIMIT` is wrong at
 * exactly one number — the one a deployment sits on while "only the most recent 50 are shown" is a
 * lie about its own books.
 *
 * the probe is dropped before the two follow-up reads, so the ids bound into them number
 * `DONATION_LIST_LIMIT` at most.
 */
export async function listDonations(db: Db): Promise<DonationPage> {
	const rows = await db
		.select(DONATION_COLUMNS)
		.from(donation)
		// left, because a gift credited to no cause is the ordinary one and an inner join would
		// answer with a page holding only the gifts that name one. nothing deletes from `program`
		// (../programs/queries.ts), so a gift naming a cause always finds its name.
		.leftJoin(program, eq(donation.programId, program.id))
		.orderBy(desc(donation.receivedAt), desc(donation.id))
		.limit(DONATION_LIST_LIMIT + 1);

	// newest first, so the row the cap drops is the oldest of the ones fetched.
	const page = rows.slice(0, DONATION_LIST_LIMIT);
	const hasMore = rows.length > DONATION_LIST_LIMIT;

	if (page.length === 0) return { donations: [], hasMore };

	const ids = page.map((row) => row.id);
	const [attempts, names] = await Promise.all([
		db.select(ATTEMPT_COLUMNS).from(payment).where(inArray(payment.donationId, ids)),
		readContactNames(
			db,
			page.map((row) => row.contactId)
		)
	]);

	const byDonation = new Map<string, AttemptRow[]>();
	for (const attempt of attempts) {
		const held = byDonation.get(attempt.donationId);
		if (held) held.push(attempt);
		else byDonation.set(attempt.donationId, [attempt]);
	}

	return {
		donations: page.map(({ contactId, recurringId, tributeKind, tributeHonoree, ...row }) => ({
			...row,
			// a gift whose donor row is missing is unreachable — `donation.contact_id` is NOT NULL
			// and its foreign key is `NO ACTION`, so the parent cannot be deleted out from under it.
			// the fallback is here because the lookup is a `Map`, and a blank cell would be a worse
			// answer to a state that cannot happen than a word saying so.
			donorName: names.get(contactId) ?? 'Unknown donor',
			status: projectStatus(byDonation.get(row.id) ?? []),
			repeating: recurringId !== null,
			tribute: projectTribute(tributeKind, tributeHonoree)
		})),
		hasMore
	};
}

/** one month's gift count, as the grouped read hands it back. */
export type GiftMonth = {
	/** the UTC calendar month, `2026-09` — `../months.ts` is the spelling on the other side. */
	month: string;
	gifts: number;
};

/**
 * how many gifts this deployment collected, by month — one row per month there has ever been one
 * in, and no row for a month there has not.
 *
 * **a gift counts in the month its money first moved.** that is the first `succeeded` inbound
 * attempt's `occurred_at`, which is the rule `projectStatus` above states and the one
 * `readDonorSummary` in ../contacts/queries.ts applies to a donor — a gift with no succeeded
 * attempt has collected nothing and is counted nowhere, and one that failed in August and settled
 * in September is September's. `received_at` is deliberately not the column: it is when the gift was
 * made rather than when it settled, and the two are different months exactly when a rail took its
 * time.
 *
 * counted once, whatever a gift's attempts came to. the grouping is two deep for that reason: the
 * inner select asks each gift when its money first moved, and the outer one counts gifts by the
 * month that instant falls in. a refund takes nothing off it — the gift was collected, and this is
 * a count rather than money, the same reading the donor count takes.
 *
 * every month rather than twelve, for the reason `readRaisedByMonth` in ../ledger/queries.ts hands
 * back every month: `overMonths` in ../months.ts is what cuts the run out of it.
 */
export async function readGiftsByMonth(db: Db): Promise<GiftMonth[]> {
	const collected = db
		.select({
			donationId: payment.donationId,
			firstAt: sql<number>`min(${payment.occurredAt})`.as('first_at')
		})
		.from(payment)
		.where(and(eq(payment.direction, 'inbound'), eq(payment.status, 'succeeded')))
		.groupBy(payment.donationId)
		.as('collected');

	const month = sql<string>`strftime('%Y-%m', ${collected.firstAt} / 1000, 'unixepoch')`;
	return db
		.select({ month: month.as('month'), gifts: count() })
		.from(collected)
		.groupBy(month);
}
