import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { ParsedContact } from '../contacts/contact-input';
import { readContactSummaries } from '../contacts/queries';
import type { Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import { pledge } from '../db/schema';
import { resolveDonor } from './donor';
import type { NoteOnPage, PledgedInput, Tribute } from './quote-input';
import { noteOnPageColumns, tributeColumns } from './record';

// stock and IRA (QCD) pledges: saved when a donor's pending screen is first shown
// (`savePledge`), told to the organisation when the donor presses the button saying they asked
// their broker or custodian (`markPledgeTold`), and listed on Gifts until staff mark one received.
//
// a pledge is never a gift row: it writes nothing to `donation`, `payment` or the books until Mark
// received (`pledge` in ../db/schema.ts), so `listDonations`, `projectStatus` and every total in
// ./queries.ts and ../ledger never meet one. what the Gifts screen shows of a pledge before then is
// `listWaitingPledges`, and it reads only `pledge`; the donor's name and address come from
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

/** one pledge to save, every value already checked (`parsePledgeRequest` in ./quote-input.ts). */
export type PledgeToSave = {
	/** minted by the donor's form, so a resend of the same press names the same row. */
	readonly id: string;
	readonly formId: string;
	readonly origin: string | null;
	readonly currency: string;
	readonly pledged: PledgedInput;
	readonly donor: ParsedContact;
	readonly consentedToContact: boolean | null;
	readonly note: string | undefined;
	readonly noteOnPage: NoteOnPage | undefined;
	readonly tribute: Tribute | null;
	readonly programId: string | null;
};

/** a pledge as saved, and the address its receipt goes to once it is received. */
export type SavedPledge = {
	readonly id: string;
	readonly reference: string;
	readonly pledged: Pledged;
	readonly receiptTo: string | null;
};

export type SavePledgeResult =
	| { readonly ok: true; readonly value: SavedPledge }
	/**
	 * `id_taken`: the id names a pledge on another form, which this save neither overwrites nor
	 * reads back. `failed`: the database refused the write for a reason nothing here can name.
	 */
	| { readonly ok: false; readonly reason: 'id_taken' | 'failed'; readonly detail: string };

/** how many references one save draws before it gives up: a fifth collision is not chance. */
const REFERENCE_DRAWS = 5;

/**
 * the pledge and its donor, written in one `batch()` — or, where a pledge already has this id on
 * this form, that pledge as it was saved.
 *
 * the second arm is the double press. the id is the form's, minted once per pending screen, so a
 * resend collides on the primary key and the batch, donor statements included, writes nothing: the
 * first save is the answer, whatever the resend carried. an id on another form's pledge is
 * `id_taken` rather than an answer, since that pledge is not this form's to show.
 *
 * the reference is drawn here, and a draw another pledge already holds (`pledge_reference_idx`) is
 * drawn again, the donor resolved afresh each time. it never throws.
 */
export async function savePledge(
	db: Db,
	input: PledgeToSave,
	drawReference: () => string
): Promise<SavePledgeResult> {
	for (let draw = 0; draw < REFERENCE_DRAWS; draw++) {
		const reference = drawReference();
		try {
			const donor = await resolveDonor(db, input.donor, input.consentedToContact);
			await db.batch([
				...donor.statements,
				db.insert(pledge).values({
					id: input.id,
					method: input.pledged.method,
					contactId: donor.contactId,
					currency: input.currency,
					reference,
					...pledgedColumns(input.pledged),
					formId: input.formId,
					origin: input.origin,
					programId: input.programId,
					note: input.note ?? null,
					...noteOnPageColumns(input.noteOnPage, input.donor),
					...tributeColumns(input.tribute)
				})
			]);
			return {
				ok: true,
				value: {
					id: input.id,
					reference,
					pledged: pledgedOf({
						...pledgedColumns(input.pledged),
						method: input.pledged.method,
						currency: input.currency
					}),
					receiptTo: input.donor.primaryEmail
				}
			};
		} catch (error) {
			const code = sqliteResultCode(error);
			if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return savedBefore(db, input);
			// the one unique index a pledge insert can meet, and the donor's statements meet none.
			if (code === 'SQLITE_CONSTRAINT_UNIQUE') continue;
			return failed(error);
		}
	}
	return {
		ok: false,
		reason: 'failed',
		detail: `${REFERENCE_DRAWS} references in a row were already taken.`
	};
}

/** the pledge a resend's id already names, where it is this form's. */
async function savedBefore(db: Db, input: PledgeToSave): Promise<SavePledgeResult> {
	try {
		const [row] = await db.select().from(pledge).where(eq(pledge.id, input.id)).limit(1);
		if (row === undefined || row.formId !== input.formId) {
			return { ok: false, reason: 'id_taken', detail: 'the id names a pledge on another form' };
		}
		const donors = await readContactSummaries(db, [row.contactId]);
		return {
			ok: true,
			value: {
				id: row.id,
				reference: row.reference,
				pledged: pledgedOf(row),
				receiptTo: donors.get(row.contactId)?.primaryEmail ?? null
			}
		};
	} catch (error) {
		return failed(error);
	}
}

function failed(error: unknown): SavePledgeResult {
	try {
		console.error('saving a pledge failed:', error);
	} catch {
		// nothing to report it to, and nothing this function may throw.
	}
	return {
		ok: false,
		reason: 'failed',
		detail: 'the pledge could not be saved; the app’s log has the cause: `docker compose logs app`.'
	};
}

/** the rail's own columns for what was pledged, the other rail's left null. */
function pledgedColumns(pledged: PledgedInput) {
	return pledged.method === 'stock'
		? {
				ticker: pledged.ticker,
				sharesMillionths: pledged.sharesMillionths,
				custodian: null,
				amountMinor: null
			}
		: {
				ticker: null,
				sharesMillionths: null,
				custodian: pledged.custodian,
				amountMinor: pledged.amountMinor
			};
}

/** what the told press claimed, for the one message it owes the organisation. */
export type ToldPledge = {
	readonly id: string;
	readonly reference: string;
	readonly pledged: Pledged;
	readonly donorName: string;
	readonly donorEmail: string | null;
};

export type MarkToldResult =
	/** `claimed`: this press set `told_at`, and the organisation is owed its message. */
	| { readonly found: true; readonly claimed: true; readonly pledge: ToldPledge }
	/** told already, by an earlier press: nobody is told twice. */
	| { readonly found: true; readonly claimed: false }
	/** no pledge on this form has the id. */
	| { readonly found: false };

/**
 * the donor's "I've contacted my broker" or "I've asked my custodian": `told_at` stamped where it
 * is still null, by one guarded update that hands back the row it claimed. a second press, or two
 * at once, claim nothing, so only one of them owes the organisation a message.
 *
 * the id is the capability and the form scopes it: an id on another form's pledge is not found.
 */
export async function markPledgeTold(
	db: Db,
	target: { readonly id: string; readonly formId: string },
	at: Date
): Promise<MarkToldResult> {
	const scope = and(eq(pledge.id, target.id), eq(pledge.formId, target.formId));
	const [claimed] = await db
		.update(pledge)
		.set({ toldAt: at })
		.where(and(scope, isNull(pledge.toldAt)))
		.returning();
	if (claimed === undefined) {
		const [held] = await db.select({ id: pledge.id }).from(pledge).where(scope).limit(1);
		return held === undefined ? { found: false } : { found: true, claimed: false };
	}
	const donor = (await readContactSummaries(db, [claimed.contactId])).get(claimed.contactId);
	return {
		found: true,
		claimed: true,
		pledge: {
			id: claimed.id,
			reference: claimed.reference,
			pledged: pledgedOf(claimed),
			donorName: donor?.displayName ?? 'Unknown donor',
			donorEmail: donor?.primaryEmail ?? null
		}
	};
}
