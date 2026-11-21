import { count, desc, isNull } from 'drizzle-orm';
import { readContactSummaries } from '../contacts/queries';
import type { Db } from '../db/client';
import { pledge } from '../db/schema';

// stock and IRA (QCD) pledges a donor has made and staff have not yet marked received.
//
// a pledge is never a gift row: it writes nothing to `donation`, `payment` or the books until Mark
// received (`pledge` in ../db/schema.ts), so `listDonations`, `projectStatus` and every total in
// ./queries.ts and ../ledger never meet one. what the Gifts screen shows of a pledge before then is
// this read, and it reads only `pledge`; the donor's name and address come from
// `readContactSummaries` in ../contacts/queries.ts, for the reason that file gives.

/**
 * how many waiting pledges one read returns, newest first. each donor id is a bound parameter of the
 * follow-up read, and a pledge nobody sends stays waiting, since nothing closes one.
 */
export const WAITING_PLEDGE_LIMIT = 100;

/** what the donor pledged: shares of a ticker, or an amount from their IRA's custodian. */
export type Pledged =
	| { readonly method: 'stock'; readonly ticker: string; readonly sharesMillionths: number }
	| {
			readonly method: 'ira_qcd';
			readonly amountMinor: number;
			readonly currency: string;
			readonly custodian: string;
	  };

export type WaitingPledge = {
	readonly id: string;
	readonly reference: string;
	readonly donorName: string;
	readonly donorEmail: string | null;
	readonly pledged: Pledged;
	/**
	 * when the donor pressed the button saying they had asked their broker or custodian, or `null`
	 * while they have only been shown the instructions.
	 */
	readonly toldAt: Date | null;
	readonly createdAt: Date;
};

export type WaitingPledges = {
	/** every pledge waiting, which the page may hold fewer of than this. */
	readonly total: number;
	/** newest first, at most `WAITING_PLEDGE_LIMIT`. */
	readonly pledges: readonly WaitingPledge[];
};

type PledgeRow = Pick<
	typeof pledge.$inferSelect,
	'method' | 'ticker' | 'sharesMillionths' | 'custodian' | 'amountMinor' | 'currency'
>;

/** the rail's own columns as one value. the `pledge_*_check`s make the fallthrough unreachable. */
function pledgedOf(row: PledgeRow): Pledged {
	if (row.method === 'stock' && row.ticker !== null && row.sharesMillionths !== null) {
		return { method: 'stock', ticker: row.ticker, sharesMillionths: row.sharesMillionths };
	}
	if (row.method === 'ira_qcd' && row.custodian !== null && row.amountMinor !== null) {
		return {
			method: 'ira_qcd',
			amountMinor: row.amountMinor,
			currency: row.currency,
			custodian: row.custodian
		};
	}
	throw new Error(`a ${row.method} pledge is missing what its rail pledges`);
}

/** the "Waiting to arrive" card: every pledge with no gift yet, newest first. */
export async function listWaitingPledges(db: Db): Promise<WaitingPledges> {
	const waiting = isNull(pledge.donationId);
	const [rows, [counted]] = await Promise.all([
		db
			.select({
				id: pledge.id,
				contactId: pledge.contactId,
				method: pledge.method,
				reference: pledge.reference,
				ticker: pledge.ticker,
				sharesMillionths: pledge.sharesMillionths,
				custodian: pledge.custodian,
				amountMinor: pledge.amountMinor,
				currency: pledge.currency,
				toldAt: pledge.toldAt,
				createdAt: pledge.createdAt
			})
			.from(pledge)
			.where(waiting)
			.orderBy(desc(pledge.createdAt), desc(pledge.id))
			.limit(WAITING_PLEDGE_LIMIT),
		db.select({ n: count() }).from(pledge).where(waiting)
	]);

	const donors = await readContactSummaries(
		db,
		rows.map((r) => r.contactId)
	);

	return {
		total: counted?.n ?? 0,
		pledges: rows.map((row) => {
			const donor = donors.get(row.contactId);
			return {
				id: row.id,
				reference: row.reference,
				// `pledge.contact_id` is NOT NULL and `NO ACTION`, so the donor cannot be missing; the
				// words are `listDonations`' for the same unreachable case.
				donorName: donor?.displayName ?? 'Unknown donor',
				donorEmail: donor?.primaryEmail ?? null,
				pledged: pledgedOf(row),
				toldAt: row.toldAt,
				createdAt: row.createdAt
			};
		})
	};
}
