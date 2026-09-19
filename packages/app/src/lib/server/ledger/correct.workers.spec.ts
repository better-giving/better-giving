import { env } from 'cloudflare:test';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { type Correction, postCorrection } from './correct';
import { PostingError } from './posting';
import { findEntryGroup, readRaisedByMonth } from './queries';

// the one write a human performs against the ledger, against a real D1.
//
// a workers spec because the two properties worth asserting are the database's: that the group and
// its two lines land in one `batch()`, and that a second posting under one id is refused by
// `entry_group_source_idx` rather than by a lookup this module could have raced past. a stand-in
// would only prove the stand-in (CLAUDE.md).

let db: Db;
beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	// the queue and the lines first: both point at `entry_group`, so the other order is a
	// constraint violation rather than an empty table.
	await env.DB.prepare('delete from quickbooks_sync').run();
	await env.DB.prepare('delete from quickbooks_connection').run();
	await env.DB.prepare('delete from ledger_entry').run();
	await env.DB.prepare('delete from entry_group').run();
});

/** the company connected, taking everything posted on or after `startAt`. */
async function connect(startAt = new Date('2026-01-01T00:00:00.000Z')): Promise<void> {
	await env.DB.prepare(
		`insert into quickbooks_connection (id, realm_id, access_token, access_token_expires_at,
		                                    refresh_token, start_at, created_at, updated_at)
		 values ('quickbooks', '4620816365', 'access', 0, 'refresh', ?, 0, 0)`
	)
		.bind(startAt.getTime())
		.run();
}

/** what the books owe QuickBooks, as the outbox holds it. */
async function queuedForQuickbooks() {
	const { results } = await env.DB.prepare(
		'select entry_group_id, status, attempts from quickbooks_sync'
	).all<{ entry_group_id: string; status: string; attempts: number }>();
	return results;
}

/** a fee that never posted, moved out of undeposited funds and into the expense it was taken for. */
const correction = (over: Partial<Correction> = {}): Correction => ({
	sourceId: uuidv7(),
	occurredAt: new Date(Date.UTC(2026, 2, 31)),
	amountMinor: 475,
	outOf: postableId('undepositedFunds'),
	into: postableId('processorFees'),
	note: 'Stripe fee for payment pi_123 that never posted.',
	...over
});

/** every line in the books, straight out of D1. */
async function lines() {
	const { results } = await env.DB.prepare(
		'select entry_group_id, account_id, amount_minor from ledger_entry order by id'
	).all<{ entry_group_id: string; account_id: string; amount_minor: number }>();
	return results;
}

describe('postCorrection()', () => {
	it('lands one adjustment of two lines, the one figure with its sign flipped', async () => {
		// the sign convention lives here and at no call site — `+` is a debit and `−` a credit,
		// project-wide (./posting.ts). the same figure is used on both sides, which is what makes
		// the entry balanced by construction rather than by arithmetic somebody could get wrong.
		const input = correction();
		expect(await postCorrection(db, input)).toEqual({ ok: true });

		const group = await findEntryGroup(db, 'adjustment', input.sourceId);
		expect(group?.currency).toBe('USD');
		expect(group?.occurredAt).toEqual(input.occurredAt);
		expect(group?.memo).toBe(input.note);

		const posted = await lines();
		expect(posted).toHaveLength(2);
		expect(posted.reduce((total, l) => total + l.amount_minor, 0)).toBe(0);
		expect(posted.find((l) => l.account_id === input.into)?.amount_minor).toBe(475);
		expect(posted.find((l) => l.account_id === input.outOf)?.amount_minor).toBe(-475);
	});
	it('refuses a second posting under one id, and lands nothing for it', async () => {
		// what a double press presents. the screen redirects to itself and never remounts, so the
		// boxes still hold the correction and the button is live — and the ledger is append-only, so
		// a second entry is not something anyone can take back. the id is minted per page load, so
		// the pair is the same one and `entry_group_source_idx` is what refuses it.
		const input = correction();
		expect(await postCorrection(db, input)).toEqual({ ok: true });
		expect(await postCorrection(db, input)).toEqual({ ok: false, reason: 'already_posted' });

		expect(await lines()).toHaveLength(2);
	});

	it('lands a second correction of identical figures under a fresh id', async () => {
		// the other half of the same rule, and the reason `source_id` is minted rather than derived
		// from the correction: two identical corrections posted deliberately must both land
		// (`entry_group_source_idx` in ../db/schema.ts), and an id derived from the figures would
		// make the second one read as a duplicate of the first.
		expect(await postCorrection(db, correction())).toEqual({ ok: true });
		expect(await postCorrection(db, correction())).toEqual({ ok: true });

		expect(await lines()).toHaveLength(4);
	});

	it('lets a rejection that is not a duplicate through', async () => {
		// only a duplicate is answered as one. everything else is a fault this module cannot explain,
		// and answering it as `already_posted` would tell a caller a correction is in the books when
		// nothing was written at all — which is the failure ../db/rejection.ts exists to make
		// avoidable, by reading the extended result code rather than matching on prose.
		//
		// a fraction of a cent is the reachable one: `post()` refuses a non-integer line outright, so
		// this throws before any statement is issued.
		await expect(postCorrection(db, correction({ amountMinor: 4.75 }))).rejects.toThrowError(
			PostingError
		);
		expect(await lines()).toHaveLength(0);
	});

	it('refuses a zero or negative amount before any write', async () => {
		// a negative balances just as well and posts the correction the other way round, so the sign
		// would be a second place the direction is spelled.
		await expect(postCorrection(db, correction({ amountMinor: -475 }))).rejects.toThrowError(
			/amountMinor is -475\b/
		);
		await expect(postCorrection(db, correction({ amountMinor: 0 }))).rejects.toThrowError(
			/amountMinor is 0\b/
		);
		expect(await lines()).toHaveLength(0);
	});

	it('refuses the same account on both sides before any write', async () => {
		// both lines on one account sum to zero and move nothing, so `post()` would pass it — a
		// correction that is in the books and corrects nothing.
		const into = postableId('undepositedFunds');
		await expect(postCorrection(db, correction({ into }))).rejects.toThrowError(/same account/);
		expect(await lines()).toHaveLength(0);
	});

	it('moves raised for the month the correction is dated, not the month it was posted in', async () => {
		// a cheque banked in march that never reached the books, posted in whatever month someone
		// noticed. raised is the donations subtree's credits, so march is the month that moves.
		await postCorrection(
			db,
			correction({
				occurredAt: new Date(Date.UTC(2026, 2, 31)),
				outOf: postableId('donationsDeductible'),
				into: postableId('bankCash')
			})
		);

		expect(await readRaisedByMonth(db)).toEqual([{ month: '2026-03', raisedMinor: 475 }]);
	});
});

describe('postCorrection() — what a correction owes QuickBooks', () => {
	it('queues the correcting entry in the commit that posted it', async () => {
		await connect();
		const input = correction();

		expect(await postCorrection(db, input)).toEqual({ ok: true });

		const group = await findEntryGroup(db, 'adjustment', input.sourceId);
		expect(await queuedForQuickbooks()).toEqual([
			{ entry_group_id: group?.id, status: 'pending', attempts: 0 }
		]);
	});

	it('queues nothing where no company is connected', async () => {
		expect(await postCorrection(db, correction())).toEqual({ ok: true });

		expect(await queuedForQuickbooks()).toEqual([]);
	});

	it('queues nothing a second time for a correction presented again', async () => {
		await connect();
		const input = correction();
		await postCorrection(db, input);

		expect(await postCorrection(db, input)).toEqual({ ok: false, reason: 'already_posted' });

		expect(await queuedForQuickbooks()).toHaveLength(1);
	});
});
