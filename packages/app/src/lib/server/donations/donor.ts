import type { BatchItem } from 'drizzle-orm/batch';
import {
	contactConsentUpdateStatement,
	contactInsertStatement,
	findContactByEmail,
	newContactRow
} from '../contacts/queries';
import type { ParsedContact } from '../contacts/contact-input';
import type { Db } from '../db/client';

// who a gift is filed under, for both paths that take one.
//
// it is its own module rather than ./record.ts's private function because the two paths need the
// same answer at different moments. a single gift writes the donor inside the one `batch()` that
// writes the donation, its lines and its payment — nothing about that donor is worth keeping if
// the gift is not — so ./record.ts takes a statement and commits it with the rest. a repeating gift
// cannot: the commitment is created at the processor in between, and a donor this deployment failed
// to write has to refuse the gift before anything is committed to rather than after. so that path
// commits the donor on their own, first, and a gift filed under a contact that is not here is the
// failure it exists to make impossible.
//
// the two functions below are that split: `resolveDonor` decides and hands back a statement,
// `commitDonor` decides and writes. matching a returning donor, and what a consent answer does to
// the row they already have, is one implementation either way — the same rule applied twice would
// be two donor files with one form between them.

/** the donor a gift is filed under, and the write that has not happened yet. */
export type ResolvedDonor = {
	readonly contactId: string;
	readonly created: boolean;
	/** the one statement this donor needs, for the caller's own `batch()` — or none. */
	readonly statement: BatchItem<'sqlite'> | null;
};

/**
 * the donor this gift is filed under, and the one statement that writes them: an insert for a
 * contact this deployment has not seen, an update of the consent answer for one it has.
 *
 * ---------------------------------------------------------------------------
 * this is a read followed by a write, and it stays one.
 *
 * two gifts from one donor arriving at the same moment can both miss the read and mint two contact
 * rows. that is the accepted outcome, not a defect to design around.
 * `contact_primary_email_lower_idx` is deliberately not unique (../db/schema.ts) — one household
 * shares an address and an organization's address is often a staff member's — and making it unique
 * to close this race would convert a duplicate donor into a refused donation, which is strictly
 * worse: the duplicate is two rows a human merges, the refusal is a gift that never arrives.
 *
 * nothing in the books depends on it either. no ledger entry references `contact`, so a duplicate
 * costs the donor file its tidiness and costs the accounts nothing. this is the case CLAUDE.md
 * describes: a lost race is settled by a correcting entry — here, a merge — and never by a
 * rollback. do not reach for a transaction (`Db` has none, and D1 has none to give it), and do not
 * add a unique index.
 * ---------------------------------------------------------------------------
 *
 * the lookup is by email and only by email, and it is skipped where a donor gave none. matching on
 * a name would file two different people under one record, which is the failure that cannot be
 * undone by merging.
 *
 * that qualifier is narrower on this path than it is on /admin's, and the difference is worth
 * knowing: `findContactByEmail` is offered to a human there, who confirms the match against a
 * person they can see. here it is applied unattended to an address nobody has verified, so a
 * stranger who types an address already on an `organization` row files an individual's gift under
 * that organization — and undoing that is a split rather than a merge, which is the harder
 * direction. it is accepted for now because the alternatives are worse at v0's scale: refusing the
 * gift loses money to a typo, and minting a second row for every address that already exists gives
 * up the dedupe entirely. verifying the address before matching is what actually closes it, and
 * that is a receipting decision rather than a write-path one.
 *
 * a matched contact keeps every identifying value it already had. the name and phone this submission
 * carried are read for nothing, which is deliberate: they are unverified values from a public form,
 * and letting them overwrite a record staff have curated would make a donation form an
 * unauthenticated edit of the donor file. `RecordedDonation.donorWasCreated` is what reports which
 * of the two happened, so nothing downstream has to infer it.
 *
 * the consent answer is the one exception, and it is an exception for the reason the rest is not.
 * a name on a public form is the donor's account of a fact staff may already know better; a consent
 * answer is not a fact about the donor at all, it is something they just said, and the most recent
 * statement is the only one that means anything. so it overwrites, in both directions.
 *
 * that overwrite is not a read-then-write, and nothing about it needs a transaction: the row is
 * named by id, and no value read inside the write decides what is written. CLAUDE.md's ban is on
 * gating an invariant on such a read.
 *
 * `null` is where the exception stops, and it is the reason this hands back a statement that may be
 * absent. the donor said nothing, because the integrator never asked (`consentedToContact` in
 * packages/form/src/v1.ts) — so there is no recent statement to prefer, and writing the `null` through
 * would un-answer a donor who did answer, on their next gift through a form that stopped asking.
 * a new contact still stores it: `null` is the state that column starts in, and starting there is
 * exactly what "nobody asked this person" means.
 */
export async function resolveDonor(
	db: Db,
	parsed: ParsedContact,
	consented: boolean | null
): Promise<ResolvedDonor> {
	if (parsed.primaryEmail !== null) {
		const existing = await findContactByEmail(db, parsed.primaryEmail);
		if (existing !== null) {
			return {
				contactId: existing.id,
				created: false,
				// `contactConsentUpdateStatement` takes a boolean and nothing else (../contacts/queries.ts),
				// which is what makes this the only place the third case can be decided.
				statement:
					consented === null ? null : contactConsentUpdateStatement(db, existing.id, consented)
			};
		}
	}

	// the pair ../contacts/queries.ts documents: mint the row so its id is readable now, and take
	// the statement so the insert lands in the caller's one `batch()`.
	const row = newContactRow(parsed, consented);
	return { contactId: row.id, created: true, statement: contactInsertStatement(db, row) };
}

/**
 * the donor written, or the reason they were not — a `detail` and nothing to match on, because
 * every way this fails has the same answer.
 *
 * ./record.ts's four reasons exist because one of them, `duplicate_intent`, is a success in
 * disguise and a caller has to tell it apart. nothing here has that shape: the row is minted with a
 * fresh id or is one already read back, so a rejection out of this write is the database being
 * unable to take it and there is no second thing for a caller to do about it.
 */
export type CommitDonorResult =
	| { readonly ok: true; readonly value: { readonly contactId: string; readonly created: boolean } }
	| { readonly ok: false; readonly detail: string };

/**
 * the donor, committed on their own before anything else in this gift exists.
 *
 * for the caller with nothing to be atomic with: a repeating gift's commitment is created at the
 * processor carrying this `contactId`, and every charge it ever collects is attributed by it
 * (../payments/provider.ts). `recurring_plan.contact_id` is a foreign key with no existence check
 * in front of it, so a commitment created before the row it names is a live commitment whose
 * settlements can never be written — and unlike a donation, nothing about it expires.
 *
 * so the order is the design and it is the opposite of ./record.ts's: the write goes first, and the
 * call that can leave something behind at a third party goes second. a donor committed for a gift
 * the processor then refuses is a contact row with no donation against it, which costs the donor
 * file one row a human can merge or ignore — and that is the side of this trade to be wrong on.
 *
 * it never throws, for the reason `recordDonation` does not: the path above it is a public,
 * payment-initiating endpoint that answers a refusal rather than a 500 with no body.
 */
export async function commitDonor(
	db: Db,
	parsed: ParsedContact,
	consented: boolean | null
): Promise<CommitDonorResult> {
	try {
		const donor = await resolveDonor(db, parsed, consented);
		// a matched donor whose consent was never asked contributes no statement at all — see
		// `resolveDonor`. there is nothing else in this batch to keep it non-empty, so the write is
		// skipped rather than made empty: the row this names already exists, which is the whole of
		// what the caller needs to be true.
		if (donor.statement !== null) await db.batch([donor.statement]);
		return { ok: true, value: { contactId: donor.contactId, created: donor.created } };
	} catch (error) {
		// logged here because the detail below cannot name a cause, and a deployment that refused a
		// donation with no line anywhere saying why is worse than the refusal. wrapped, for the reason
		// `logProviderFault` in ../payments/provider.ts states: `console.error` serialises what it is
		// given and therefore runs the thrower's own getters, so the one path that must not throw
		// would have a throw site in it.
		try {
			console.error('recording a donor failed:', error);
		} catch {
			// nothing to report it to, and nothing this function may throw.
		}
		return {
			ok: false,
			detail:
				'the donor could not be written, and nothing about them was stored. this is a fault in ' +
				'this app or in the database rather than anything about the donation; the cause is in ' +
				'this deployment’s logs (the Cloudflare dashboard, or `pnpm run logs` from a checkout).'
		};
	}
}
