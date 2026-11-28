import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sponsorEventCursor } from '../db/schema';
import { settleEvent } from '../donations/settle';
import type { SettleDeps } from '../donations/delivery';
import { sponsorEvent } from '../payments/sponsor';

// the hourly pull of a hosted site's sponsor events: `0 * * * *` in src/cron-runs.ts.
//
// a delivery carries what the sponsor saw when it sent it, and one that never arrived is never
// sent again — so once an hour this asks the sponsor for every event past the one it has applied
// through (`GET /events?after=<seq>`, ../payments/sponsor.ts) and hands each to `settleEvent` in
// ../donations/settle.ts, which is what a delivery's verified body reaches. the cursor
// (`sponsor_event_cursor`, ../db/schema.ts) is written after each event has been dealt with, so a
// restart resumes there; an event already applied answers `already_posted` and is passed again.
//
// the walk ends the run at the first event not applied, because the cursor may not pass one. a
// read or write worth making again (`incomplete`) or a gift not settled here yet (`not_yet`) is
// asked for again on the next run, from that event. an envelope the adapter cannot read
// (`sponsorEvent` in ../payments/sponsor.ts) reads the same on every run, so the pull stops there
// each hour, logged and mailed to nobody, and applies nothing past it. every other answer —
// posted, already in the books, ignored, told to staff — moves the cursor past the event. a read
// the sponsor did not answer ends the run, logged only: an hourly run that could not reach the
// sponsor is a sponsor outage, not something to mail.
//
// a gift or a payout arrives twice — once by delivery, once through this read — and that is the
// point rather than a waste. both writes are keyed on the processor's own id
// (`entry_group_source_idx` and `payment_provider_txn_idx` in ../db/schema.ts), so the second
// writes nothing. an outcome that only tells staff, such as a payout the ledger refuses
// (../ledger/record-payout.ts), tells them again.

/** pages asked for in one run. a backlog past this is read on the next run. */
const PAGES_PER_RUN = 10;

/** the cursor's one row, whose id the table checks (`sponsor_event_cursor_id_check`). */
const CURSOR_ID = 'sponsor';

/**
 * applies every sponsor event past the stored cursor. `now` is the run's scheduled time, stamped on
 * the cursor row.
 */
export async function pullSponsorEvents(deps: SettleDeps, now: Date): Promise<void> {
	if (deps.provider.processor !== 'sponsor') return;
	// the read's key, handed here by the cron run: the pull is the one caller that reads the feed.
	const read = deps.sponsorFeed;
	if (read === undefined) return;

	let cursor = await readCursor(deps.db);
	for (let page = 0; page < PAGES_PER_RUN; page += 1) {
		const feed = await read(cursor);
		if (!feed.ok) {
			console.error('the sponsor’s events could not be read:', cursor, feed.detail);
			return;
		}
		for (const envelope of feed.value.events) {
			const seq = sequenceOf(envelope);
			const known = sponsorEvent(envelope);
			const result = known.ok
				? await settleEvent(deps, known.value)
				: { ok: false as const, detail: known.detail };
			// an envelope that cannot be read, a read or write worth making again (`incomplete`) and
			// a gift not settled here yet (`not_yet`) all stop the walk here: the cursor may not pass
			// an event not applied.
			if (!result.ok || result.outcome === 'not_yet') {
				console.error('the sponsor’s event was not applied:', seq, result.detail);
				return;
			}
			cursor = await writeCursor(deps, seq, now);
		}
		if (!feed.value.more) return;
	}
}

async function readCursor(db: Db): Promise<number> {
	const [row] = await db
		.select({ seq: sponsorEventCursor.seq })
		.from(sponsorEventCursor)
		.where(eq(sponsorEventCursor.id, CURSOR_ID));
	return row?.seq ?? 0;
}

/** the event applied: an upsert, so the first run writes the one row and no seed script is needed. */
async function writeCursor(deps: SettleDeps, seq: number, now: Date): Promise<number> {
	try {
		await deps.db
			.insert(sponsorEventCursor)
			.values({ id: CURSOR_ID, seq, updatedAt: now })
			.onConflictDoUpdate({
				target: sponsorEventCursor.id,
				set: { seq, updatedAt: now }
			});
	} catch (error) {
		console.error('the sponsor’s event cursor could not be moved:', seq, error);
	}
	return seq;
}

/** the envelope's own sequence, which `readSponsorFeed` has checked is a sequence number. */
function sequenceOf(envelope: unknown): number {
	const seq =
		typeof envelope === 'object' && envelope !== null
			? (envelope as { seq?: unknown }).seq
			: undefined;
	if (typeof seq !== 'number' || !Number.isSafeInteger(seq)) {
		throw new Error('the sponsor feed answered an event with no sequence number');
	}
	return seq;
}
