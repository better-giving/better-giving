import { and, isNull } from 'drizzle-orm';
import { type ConsentState, consentState } from '../../contacts/consent';
import type { Db } from '../db/client';
import { contact } from '../db/schema';
import { inPage, type PageOf, type PageQuery, pageOf, storedTimesWalk } from './paging';

// one donor as the read API's donors list answers it (src/routes/integrations.v1.donors.ts).
//
// **the donors are the ones /admin/donors lists**: every contact not archived, whether or not a
// gift of theirs has settled — a donor staff typed in, or one whose only gift is still pending, is
// a donor on that screen and on this list alike. `listContacts` in ../contacts/queries.ts is the
// screen's read.
//
// **the keys are permanent.** each is a field some integrator's code reads, so a rename breaks it
// silently: add a key, never rename or drop one. every key is present on every donor, null where
// the donor has nothing to say. what a donor has given is not here: it is a sum over their gifts,
// which the gifts list answers one by one.
//
// **when a donor last changed is the row's own `updated_at`.** every write to a contact row is a
// drizzle `.update(contact)` that leaves the column unnamed, so the column's `$onUpdateFn` in
// ../db/schema.ts stamps it in the same statement — today that is
// `contactConsentUpdateStatements` in ../contacts/queries.ts alone, the consent a returning donor's
// gift carries, and only where it changes the answer. a writer naming
// `updated_at` itself, or writing the row past drizzle, would hide its change from `updated_since`.
// what this does not see is a donor leaving the list: an archived contact drops out of both orders
// rather than appearing as changed. nothing archives a contact yet.
//
// **two orders**, the gifts list's (./gift.ts's header): with no `updated_since`, newest first by
// when the donor was first recorded, then id; with it, every donor whose `updated_at` is at or
// after it, oldest change first, then id — resumed as that header says, from a minute before the
// last `updated_at` served, since the stamp is taken as the write is built.

/** one donor, as the read API's donors list answers it. */
export type ApiDonor = {
	readonly id: string;
	readonly name: string;
	readonly email: string | null;
	/**
	 * the donor's answer to whether the organisation may contact them: `agreed`, `declined`, or
	 * `unasked` where nobody put the question — a person it may still ask, where `declined` is a
	 * decision to honour. **the set may gain values**: a reader lets one it does not know pass.
	 */
	readonly consent: ConsentState;
	/** when the donor was first recorded, ISO 8601 in UTC. */
	readonly created_at: string;
	/** when this donor last changed, ISO 8601 in UTC: the time `updated_since` is compared with. */
	readonly updated_at: string;
};

/** the two orders donors are walked in, named as their cursors carry them (./paging.ts). */
export const DONOR_ORDERS = { newest: 'donors.newest', changed: 'donors.changed' } as const;

/** one page of donors in the order `query` names. */
export async function readDonorPage(db: Db, query: PageQuery): Promise<PageOf<ApiDonor>> {
	const walk = storedTimesWalk(query, contact);
	const rows = await selectDonors(db)
		.where(and(isNull(contact.archivedAt), walk.where))
		.orderBy(...walk.orderBy)
		.limit(query.limit + 1);
	const page = pageOf(rows, query.limit, walk.keyOf);
	return { rows: page.rows.map(renderDonor), next: page.next };
}

/**
 * the donors among `contactIds`, as the read API answers each, keyed by id — archived or not, since
 * what a webhook says about a donor stays true of them. an id that names no contact has no entry,
 * which is the caller's to answer for.
 */
export async function readDonors(
	db: Db,
	contactIds: readonly string[]
): Promise<Map<string, ApiDonor>> {
	if (contactIds.length === 0) return new Map();
	const rows = await selectDonors(db).where(inPage(contact.id, [...new Set(contactIds)]));
	return new Map(rows.map((row) => [row.id, renderDonor(row)]));
}

/** every column an `ApiDonor` is rendered from. */
function selectDonors(db: Db) {
	return db
		.select({
			id: contact.id,
			displayName: contact.displayName,
			primaryEmail: contact.primaryEmail,
			consentedToContact: contact.consentedToContact,
			createdAt: contact.createdAt,
			updatedAt: contact.updatedAt
		})
		.from(contact);
}

type DonorRow = Awaited<ReturnType<ReturnType<typeof selectDonors>['all']>>[number];

function renderDonor(row: DonorRow): ApiDonor {
	return {
		id: row.id,
		name: row.displayName,
		email: row.primaryEmail,
		consent: consentState(row.consentedToContact),
		created_at: row.createdAt.toISOString(),
		updated_at: row.updatedAt.toISOString()
	};
}
