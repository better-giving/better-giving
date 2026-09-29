import { and, eq, exists, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../db/client';
import { contact } from '../db/schema';
import { donorUpdatedWebhookStatements } from '../webhooks/events';

// every write to a contact after the insert that makes it (./queries.ts), and the event each one
// owes a webhook destination: a change here is a change the read API's donors list shows
// (../integrations/donor.ts), so each is announced as `donor.updated`. today that is the consent
// answer a returning donor's gift carries (`resolveDonor` in ../donations/donor.ts).
// ./sole-updater.spec.ts holds that no other module updates the table.
//
// **the event lands exactly when the change does, with no read in front.** the event's INSERT…
// SELECT goes first in the same `batch()` and selects only where the update's own `where` holds —
// the row named and a stored value that differs from the one being written — so it sees the row
// the update is about to change. an answer given again matches nothing in either statement: no
// event, no write, no `updated_at` moved.

/**
 * the consent answer a donor just gave, over the one they gave before — unexecuted, for the same
 * `batch()` that writes the gift it arrived with: the `donor.updated` rows it owes, then the update.
 *
 * a returning donor is matched to the contact row they already have, so an answer written only on
 * insert would be the first one they ever gave and every later one would be discarded. true -> false
 * is a withdrawal and false -> true is a grant; a consent record that holds neither is worse than
 * one that was never kept, because it reads as an answer.
 *
 * it names the row by id, so it is not the read-then-write CLAUDE.md bans: the caller has already
 * resolved which contact this is, and the one value read inside the write, the stored answer,
 * decides whether it writes and never what.
 *
 * the update runs only where the answer differs — `is not` rather than `<>`, so a donor nobody had
 * asked (`null`) answering for the first time is a change — so the same answer given again writes
 * nothing, and moves no `updated_at` a read API caller's `updated_since` would take for a change.
 *
 * `updated_at` moves with a change, from the column's own `$onUpdateFn` rather than from anything
 * here: this is a write to the row, and system time is what that column records.
 *
 * it takes a boolean and never null: absent is the state of a contact nobody asked, and no path
 * that reaches this function is one — the gift carries a required answer. a caller that would pass
 * null wants no statement at all.
 */
export function consentChangeStatements(
	db: Db,
	contactId: string,
	consented: boolean
): [BatchItem<'sqlite'>, BatchItem<'sqlite'>] {
	const changesRow = and(
		eq(contact.id, contactId),
		sql`${contact.consentedToContact} is not ${consented ? 1 : 0}`
	);
	return [
		donorUpdatedWebhookStatements(
			db,
			contactId,
			exists(db.select({ one: sql`1` }).from(contact).where(changesRow))
		),
		db.update(contact).set({ consentedToContact: consented }).where(changesRow)
	];
}
