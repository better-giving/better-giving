import { and, desc, eq, isNull } from 'drizzle-orm';
import type { ParsedContact } from '../contacts/contact-input';
import { readContactSummaries } from '../contacts/queries';
import type { Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import { donation, pledge } from '../db/schema';
import { supporterPageOf } from '../supporters/gifts';
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
	/** how many pledges are waiting: `pledges.length`. */
	readonly total: number;
	/**
	 * every pledge waiting, newest first. none is left out: a pledge nobody sends stays waiting, since
	 * nothing but Mark received closes one, and one missing here could never be received.
	 */
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
	const rows = await db
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
		.where(isNull(pledge.donationId))
		.orderBy(desc(pledge.createdAt), desc(pledge.id));

	const donors = await readContactSummaries(db, [...new Set(rows.map((r) => r.contactId))]);

	return {
		total: rows.length,
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
	 * `id_taken`: the id names a gift, or a pledge that is not this one sent again, which this save
	 * neither overwrites nor reads back. `failed`: the database refused the write for a reason
	 * nothing here can name.
	 */
	| { readonly ok: false; readonly reason: 'id_taken' | 'failed'; readonly detail: string };

/** how many references one save draws before it gives up: a fifth collision is not chance. */
export const REFERENCE_DRAWS = 5;

/**
 * the pledge and its donor, written in one `batch()` — or, where this pledge was saved already
 * under its id, that pledge as it was saved.
 *
 * the second arm is the double press. the id is the form's, minted once per pending screen, so a
 * resend names the pledge saved before, and the first save is the answer. it answers only the same
 * pledge again (`samePledge`): an id naming a gift, or a pledge with another form, rail, figure or
 * donor, is `id_taken`, since that row is not this request's to show and Mark received writes the
 * gift under the pledge's id (./receive-pledge.ts). a caller can post any id, a gift's included,
 * and the `pledge` insert would not meet a `donation` key, so the read before the write is what
 * finds one. two presses at once both pass that read, and the second's batch, donor statements
 * included, meets the first's primary key and writes nothing.
 *
 * the reference is drawn here, and a draw another pledge already holds (`pledge_reference_idx`) is
 * drawn again, the donor resolved afresh each time. it never throws.
 */
export async function savePledge(
	db: Db,
	input: PledgeToSave,
	drawReference: () => string
): Promise<SavePledgeResult> {
	const held = await savedBefore(db, input);
	if (held !== null) return held;
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
					// as the opening gift names its page (../supporters/gifts.ts): `readPublishedConfig`
					// in ../forms/published-config.ts has already refused a fundraiser not taking gifts.
					supporterPageId: supporterPageOf(input.formId),
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
			if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
				return (await savedBefore(db, input)) ?? failed(error);
			}
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

/**
 * what the id already names: the pledge saved before where it is this one again, `id_taken` where
 * it is a gift or another pledge, and null where it names nothing yet.
 */
async function savedBefore(db: Db, input: PledgeToSave): Promise<SavePledgeResult | null> {
	try {
		const [[gift], [row]] = await Promise.all([
			db.select({ id: donation.id }).from(donation).where(eq(donation.id, input.id)).limit(1),
			db.select().from(pledge).where(eq(pledge.id, input.id)).limit(1)
		]);
		// a gift collides only where no pledge holds the id: a received pledge's gift carries its own.
		if (row === undefined) {
			return gift === undefined
				? null
				: { ok: false, reason: 'id_taken', detail: 'the id names a gift' };
		}
		const donors = await readContactSummaries(db, [row.contactId]);
		if (!samePledge(row, donors.get(row.contactId)?.primaryEmail ?? null, input)) {
			return { ok: false, reason: 'id_taken', detail: 'the id names another pledge' };
		}
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

/** whether a held pledge is the one `input` asks to save: its form, rail, figures and donor. */
function samePledge(
	row: typeof pledge.$inferSelect,
	donorEmail: string | null,
	input: PledgeToSave
): boolean {
	const asked = input.pledged;
	const sameFigures =
		asked.method === 'stock'
			? row.ticker === asked.ticker && row.sharesMillionths === asked.sharesMillionths
			: row.amountMinor === asked.amountMinor && row.custodian === asked.custodian;
	return (
		row.formId === input.formId &&
		row.method === asked.method &&
		sameFigures &&
		donorEmail?.toLowerCase() === input.donor.primaryEmail?.toLowerCase()
	);
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
	/**
	 * told already, by an earlier press, or received already at Mark received: nobody is told twice,
	 * and nobody is told a received gift is on its way.
	 */
	| { readonly found: true; readonly claimed: false }
	/** no pledge on this form has the id. */
	| { readonly found: false };

/**
 * the donor's "I've contacted my broker" or "I've asked my custodian": `told_at` stamped where it
 * is still null and the pledge not yet received, by one guarded update that hands back the row it
 * claimed. a second press, or two at once, claim nothing, so only one of them owes the
 * organisation a message; a press after Mark received claims nothing either. a claim whose notice
 * cannot be written, the donor read having thrown, is handed back before that throw is raised.
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
		.where(and(scope, isNull(pledge.toldAt), isNull(pledge.donationId)))
		.returning();
	if (claimed === undefined) {
		const [held] = await db.select({ id: pledge.id }).from(pledge).where(scope).limit(1);
		return held === undefined ? { found: false } : { found: true, claimed: false };
	}
	try {
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
	} catch (error) {
		// no notice could be written, so the claim is handed back and the press again tells the
		// organisation. unconditional: the claim proved this press owns the stamp.
		try {
			await db.update(pledge).set({ toldAt: null }).where(eq(pledge.id, claimed.id));
		} catch {
			// the pledge keeps a stamp for a notice nobody sent; the throw below is what is logged.
		}
		throw error;
	}
}
