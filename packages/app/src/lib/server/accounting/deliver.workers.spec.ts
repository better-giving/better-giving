import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { contact, donation, payment, quickbooksSync } from '../db/schema';
import { chargeEntry, feeEntry } from '../donations/entries';
import type { EmailMessage, EmailProvider } from '../email/provider';
import { post, postingStatements, type Posting } from '../ledger/posting';
import type { Settlement } from '../payments/provider';
import { dueRows, sendDueEntries, sendQueuedEntry } from './deliver';
import {
	failed,
	type AccountingProvider,
	type AccountingResult,
	type RemoteRecord,
	type SendAttempt
} from './provider';

// the outbox delivered, against a real D1 and a provider written here.
//
// the entries are built by ../donations/entries.ts and ../ledger/posting.ts rather than written out,
// as ./record.workers.spec.ts does, so a change to how a gift is recognised is a failure here
// rather than a mapping that quietly stops matching. what is asserted is the row: which status it
// lands in, what its `attempts` and `last_error` say, and whether the next run reads it again.
//
// the provider is a stub because nothing here is about Intuit — ./quickbooks.spec.ts holds that
// side. what this file is about is the queue, and a reason is handed over as the port's own
// `failed(...)` so the two cannot disagree about what a reason is called.

const MINUTE = 60_000;
/** the run's scheduled time. taken from the clock, because a run's deadline is measured from it. */
const NOW = new Date();
/**
 * when a fixture's queue row was written.
 *
 * before the run, because that is the only order there is: the posting that owes a gift commits its
 * queue row, and a sweep reads it afterwards. left at the insert's own clock these rows are written
 * a few milliseconds after `NOW` and nothing is due at all.
 */
const QUEUED_AT = new Date(NOW.getTime() - 5 * MINUTE);
const OCCURRED_AT = new Date(NOW.getTime() - 24 * 60 * MINUTE);

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	for (const table of [
		'quickbooks_sync',
		'ledger_entry',
		'entry_group',
		'payment',
		'donation',
		'contact',
		'org_profile'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, deductibility_statement, address_line1,
		                          city, country, notification_email, created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789', 'No goods or services were provided.',
		         '1 Main St', 'Springfield', 'US', 'ops@hope.example', 0, 0)`
	).run();
});

function mailer() {
	const sent: EmailMessage[] = [];
	const port: EmailProvider = {
		async send(message) {
			sent.push(message);
			return { ok: true };
		}
	};
	return { port, sent };
}

/** an arm nothing in this file reaches: the delivery sends records and asks nothing else. */
const notAsked = async (): Promise<never> => {
	throw new Error('the delivery asked the provider something it has no business asking');
};

/**
 * a provider answering per record key, recording every key it was handed.
 *
 * the default is acceptance with a remote id built from the key, which is what makes "sent twice"
 * visible: a second post of one gift would be a second entry in `asked`.
 */
function provider(
	answer: (
		key: string
	) => AccountingResult<RemoteRecord> | Promise<AccountingResult<RemoteRecord>> = accepted
) {
	const asked: string[] = [];
	const attempts: SendAttempt[] = [];
	const revisions: string[] = [];
	const port: AccountingProvider = {
		async sendGift(gift, attempt, revision) {
			asked.push(gift.key);
			attempts.push(attempt);
			revisions.push(revision);
			return answer(gift.key);
		},
		async sendCorrection(correction, attempt, revision) {
			asked.push(correction.key);
			attempts.push(attempt);
			revisions.push(revision);
			return answer(correction.key);
		},
		readCompany: notAsked,
		listAccounts: notAsked,
		createHoldingAccount: notAsked,
		authorizeUrl: notAsked,
		exchangeCode: notAsked,
		revokeTokens: notAsked
	};
	return { port, asked, attempts, revisions };
}

const accepted = (key: string): AccountingResult<RemoteRecord> => ({
	ok: true,
	value: { remoteId: `qb-${key.slice(0, 8)}` }
});

function deps(port: AccountingProvider, email: EmailProvider = mailer().port) {
	return { db, provider: port, email };
}

/** the postings committed the way every poster commits them, with a queue row for each of `owed`. */
async function commit(postings: readonly Posting[], owed: readonly Posting[]): Promise<void> {
	const statements: BatchItem<'sqlite'>[] = [
		...postings.flatMap((posting) => postingStatements(db, posting)),
		...owed.map((posting) =>
			db
				.insert(quickbooksSync)
				.values({ entryGroupId: idOf(posting), createdAt: QUEUED_AT, updatedAt: QUEUED_AT })
		)
	];
	// in chunks, because the read-bound case queues a hundred and one of these at once.
	for (let cut = 0; cut < statements.length; cut += 100) {
		const [first, ...rest] = statements.slice(cut, cut + 100);
		if (first === undefined) continue;
		await db.batch([first, ...rest]);
	}
}

function idOf(posting: Posting): string {
	const id = posting.group.id;
	if (id === undefined) throw new Error('the fixture posting carries no entry group id');
	return id;
}

/** a settled card charge, fee and all: what every gift in this file was given by. */
function settlement(): Settlement {
	return {
		providerTxnId: `ch_${uuidv7()}`,
		status: 'succeeded',
		method: 'card',
		amountMinor: 10_000,
		currency: 'USD',
		feeMinor: 320,
		metadata: {},
		occurredAt: OCCURRED_AT,
		arrival: null
	};
}

/** a donor, their gift, the charge that settled it, and the queue row the settlement owes. */
async function queuedGift(): Promise<string> {
	const contactId = uuidv7();
	const donationId = uuidv7();
	const paymentId = uuidv7();
	const settled = settlement();
	await db.batch([
		db.insert(contact).values({
			id: contactId,
			kind: 'individual',
			displayName: 'Ada Lovelace',
			primaryEmail: 'ada@example.org'
		}),
		db.insert(donation).values({
			id: donationId,
			contactId,
			totalMinor: 10_000,
			currency: 'USD',
			receivedAt: OCCURRED_AT
		}),
		db.insert(payment).values({
			id: paymentId,
			donationId,
			amountMinor: 10_000,
			currency: 'USD',
			direction: 'inbound',
			method: 'card',
			status: 'succeeded',
			provider: 'stripe',
			providerTxnId: settled.providerTxnId,
			occurredAt: OCCURRED_AT
		})
	]);

	const charged = {
		paymentId,
		donationId,
		revenue: [{ accountId: postableId('donationsDeductible'), amountMinor: settled.amountMinor }]
	} as const;
	const charge = chargeEntry(charged, settled);
	const fee = feeEntry(charged, settled);
	if (fee === null) throw new Error('the fixture settlement carried a fee and none was posted');
	// the cut is a line on the gift's own record, so only the charge is owed (./outbox.ts).
	await commit([charge, fee], [charge]);
	return idOf(charge);
}

/** which of this app's accounts a fixture correction debits: one a role stands for, or none. */
type CorrectedAccount = 'donationsDeductible' | 'salesTaxPayable';

/** a correcting entry, `account` on the debited side. */
function correction(account: CorrectedAccount): Posting {
	return post({
		sourceType: 'adjustment',
		sourceId: uuidv7(),
		currency: 'USD',
		occurredAt: OCCURRED_AT,
		memo: 'gift posted to the wrong fund',
		lines: [
			{ accountId: postableId(account), amountMinor: 2_500 },
			{ accountId: postableId('bankCash'), amountMinor: -2_500 }
		]
	});
}

async function queuedCorrection(
	account: CorrectedAccount = 'donationsDeductible'
): Promise<string> {
	const posting = correction(account);
	await commit([posting], [posting]);
	return idOf(posting);
}

/** the queue row as it stands. */
async function row(entryGroupId: string) {
	const [found] = await db
		.select()
		.from(quickbooksSync)
		.where(eq(quickbooksSync.entryGroupId, entryGroupId));
	if (found === undefined) throw new Error(`no queue row for ${entryGroupId}`);
	return found;
}

/** a row as an earlier run left it: tried `attempts` times, last written `agoMs` before `NOW`. */
async function tried(entryGroupId: string, attempts: number, agoMs: number): Promise<void> {
	const at = NOW.getTime() - agoMs;
	await env.DB.prepare(
		'update quickbooks_sync set attempts = ?, updated_at = ?, created_at = ? where entry_group_id = ?'
	)
		.bind(attempts, at, at, entryGroupId)
		.run();
}

/** a row as an outage nobody repaired left it: given up on and reported `agoMs` before `NOW`. */
async function givenUpOn(entryGroupId: string, agoMs: number): Promise<void> {
	const at = NOW.getTime() - agoMs;
	await env.DB.prepare(
		`update quickbooks_sync
		 set status = 'failed', attempts = 3, last_error = 'Intuit refused the payload.',
		     notified_at = ?, created_at = ?, updated_at = ?
		 where entry_group_id = ?`
	)
		.bind(at, at, at, entryGroupId)
		.run();
}

/** a row as a run that took it left it: claimed until `inMs` from `NOW`. */
async function lease(entryGroupId: string, inMs: number): Promise<void> {
	await env.DB.prepare('update quickbooks_sync set leased_until = ? where entry_group_id = ?')
		.bind(NOW.getTime() + inMs, entryGroupId)
		.run();
}

describe('one queued entry group', () => {
	it('sends a gift and writes what QuickBooks called it', async () => {
		const entryGroupId = await queuedGift();
		const qb = provider();

		const result = await sendQueuedEntry(deps(qb.port), entryGroupId, NOW);

		expect(result).toEqual({ disposition: 'sent', remoteId: `qb-${entryGroupId.slice(0, 8)}` });
		expect(await row(entryGroupId)).toMatchObject({
			status: 'sent',
			remoteId: `qb-${entryGroupId.slice(0, 8)}`,
			lastError: null
		});
	});

	it('sends a correction the same way', async () => {
		const entryGroupId = await queuedCorrection();
		const qb = provider();

		const result = await sendQueuedEntry(deps(qb.port), entryGroupId, NOW);

		expect(result).toMatchObject({ disposition: 'sent' });
		expect(await row(entryGroupId)).toMatchObject({
			status: 'sent',
			remoteId: `qb-${entryGroupId.slice(0, 8)}`
		});
	});

	it('never sends one that is already in QuickBooks', async () => {
		const entryGroupId = await queuedGift();
		const qb = provider();
		await sendQueuedEntry(deps(qb.port), entryGroupId, NOW);

		const again = await sendQueuedEntry(deps(qb.port), entryGroupId, NOW);

		// whatever an accountant did to that record afterwards: a second post would duplicate a
		// hand-edit, or resurrect something deliberately deleted.
		expect(again).toMatchObject({ disposition: 'nothing_owed' });
		expect(qb.asked).toEqual([entryGroupId]);
	});

	it('owes nothing for an entry group no row names', async () => {
		const qb = provider();

		expect(await sendQueuedEntry(deps(qb.port), uuidv7(), NOW)).toMatchObject({
			disposition: 'nothing_owed'
		});
	});
});

describe('the due backlog', () => {
	it('sends every entry group whose wait is over', async () => {
		const first = await queuedGift();
		const second = await queuedCorrection();
		const qb = provider();

		await sendDueEntries(deps(qb.port), NOW);

		expect(qb.asked.sort()).toEqual([first, second].sort());
		expect((await row(first)).status).toBe('sent');
		expect((await row(second)).status).toBe('sent');
	});

	it('sends a gift once where a second run reads the same backlog', async () => {
		const entryGroupId = await queuedGift();
		const overlapping = provider();
		const qb = provider(async (key) => {
			// a second run starts while this one's send is still in flight, which is what a minute's
			// cadence and a run that can outlast it make ordinary rather than exotic.
			await sendDueEntries(deps(overlapping.port), NOW);
			return accepted(key);
		});

		await sendDueEntries(deps(qb.port), NOW);

		// a second post outside Intuit's request-id window is a second record in the company's own
		// books, and nothing in this app or that one repairs it.
		expect(qb.asked).toEqual([entryGroupId]);
		expect(overlapping.asked).toEqual([]);
		expect((await row(entryGroupId)).status).toBe('sent');
	});

	it('reads no row a live run is still holding', async () => {
		const entryGroupId = await queuedGift();
		await lease(entryGroupId, MINUTE);
		const qb = provider();

		await sendDueEntries(deps(qb.port), NOW);

		expect(qb.asked).toEqual([]);
		expect(await row(entryGroupId)).toMatchObject({ status: 'pending', attempts: 0 });
	});

	it('takes back a row whose lease has run out', async () => {
		const entryGroupId = await queuedGift();
		await lease(entryGroupId, -1);
		const qb = provider();

		await sendDueEntries(deps(qb.port), NOW);

		// the run that claimed it died before it could write anything. the gift is still owed, and
		// waiting for a run that no longer exists is how it would never reach the books at all.
		expect(qb.asked).toEqual([entryGroupId]);
		expect((await row(entryGroupId)).status).toBe('sent');
	});

	it('leaves a sent row claimed by nobody', async () => {
		const entryGroupId = await queuedGift();

		await sendDueEntries(deps(provider().port), NOW);

		expect(await row(entryGroupId)).toMatchObject({ status: 'sent', leasedUntil: null });
	});

	it('counts the attempt as it claims the row, before anything is sent', async () => {
		const entryGroupId = await queuedGift();
		let inFlight: number | null = null;
		const qb = provider(async (key) => {
			inFlight = (await row(entryGroupId)).attempts;
			return accepted(key);
		});

		await sendDueEntries(deps(qb.port), NOW);

		// a run that dies between the post and writing it down leaves this count behind, and it is
		// what tells the next send to look before it posts.
		expect(inFlight).toBe(1);
		expect(qb.attempts).toEqual(['first']);
	});

	it('looks before it posts a row whose run died mid-send, once the lease is out', async () => {
		const entryGroupId = await queuedGift();
		const dying = provider(() => {
			throw new Error('the isolate went away after the post landed');
		});
		await sendDueEntries(deps(dying.port), NOW);

		const qb = provider();
		await sendDueEntries(deps(qb.port), new Date(NOW.getTime() + 6 * MINUTE));

		expect(qb.asked).toEqual([entryGroupId]);
		expect(qb.attempts).toEqual(['again']);
	});

	it('hands a send after one that never answered the same revision, and a new one after a written refusal', async () => {
		const entryGroupId = await queuedGift();
		const unanswered = provider(() => failed('unreachable', 'QuickBooks could not be reached.'));
		await sendDueEntries(deps(unanswered.port), NOW);
		const refusing = provider(() => failed('provider_error', 'QuickBooks answered 502.'));
		await sendDueEntries(deps(refusing.port), NOW);
		const qb = provider();
		await sendDueEntries(deps(qb.port), new Date(NOW.getTime() + 2 * MINUTE));

		// the adapter repeats a request exactly where the last one may have landed, and asks afresh
		// where it was answered (./quickbooks.ts's request id).
		expect(refusing.revisions).toEqual(unanswered.revisions);
		expect(qb.revisions).toEqual([String(NOW.getTime())]);
		expect(qb.revisions).not.toEqual(unanswered.revisions);
		expect(qb.asked).toEqual([entryGroupId]);
	});

	it('tells the provider whether this row has been handed over before', async () => {
		const entryGroupId = await queuedGift();
		const faulting = provider(() => failed('provider_error', 'QuickBooks answered 502.'));

		await sendDueEntries(deps(faulting.port), NOW);
		const qb = provider();
		await sendDueEntries(deps(qb.port), new Date(NOW.getTime() + MINUTE + 1_000));

		// what it buys the adapter: the scan for a record it may already have posted is paid by the
		// attempt that can find one, and by no other.
		expect(faulting.attempts).toEqual(['first']);
		expect(qb.attempts).toEqual(['again']);
		expect(qb.asked).toEqual([entryGroupId]);
	});

	it('counts a send that never answered, whatever else the run does about it', async () => {
		const entryGroupId = await queuedGift();
		const qb = provider(() =>
			failed('unreachable', 'QuickBooks could not be reached (TimeoutError).')
		);

		await sendDueEntries(deps(qb.port), NOW);

		// the run stopped and the row is left for the next one to read — but the call may have
		// created the record before the wait ran out, so the attempt is on the row and the next one
		// looks before it posts.
		expect(await row(entryGroupId)).toMatchObject({
			status: 'pending',
			leasedUntil: null,
			attempts: 1
		});
	});

	it.each([
		['reconnect_needed', 'The refresh token was rejected.'],
		['rate_limited', 'Intuit is throttling this company.'],
		['accounts_not_chosen', 'No account is chosen for a gift’s income.'],
		['not_connected', 'No QuickBooks company is connected.']
	] as const)(
		'gives the claim and its attempt back on a run stopped by %s',
		async (reason, detail) => {
			const entryGroupId = await queuedGift();
			const qb = provider(() => failed(reason, detail));

			await sendDueEntries(deps(qb.port), NOW);

			// each is an answer that nothing was made, so the row reads as never sent: a move may still
			// drop it, and its next send does not pay for a look first.
			expect(await row(entryGroupId)).toMatchObject({
				status: 'pending',
				leasedUntil: null,
				attempts: 0
			});
		}
	);

	it('narrows the backlog through the index, and reaches each entry group by its key', async () => {
		const { sql: statement, params } = dueRows(db, NOW).toSQL();

		const plan = await env.DB.prepare(`explain query plan ${statement}`)
			.bind(...params)
			.all<{ detail: string }>();

		// the order is sorted over the due rows (./deliver.ts's `dueRows`); what must never happen is
		// a scan of every row the deployment ever sent, or of the ledger.
		const detail = plan.results.map((step) => step.detail).join(' | ');
		expect(detail).toContain('SEARCH quickbooks_sync USING INDEX quickbooks_sync_status_due_idx');
		expect(detail).toContain(
			'SEARCH entry_group USING INDEX sqlite_autoindex_entry_group_1 (id=?)'
		);
		expect(detail).not.toContain('SCAN');
	});

	it('leaves a provider fault waiting, and tries it again once the wait is over', async () => {
		const entryGroupId = await queuedGift();
		const faulting = provider(() => failed('provider_error', 'QuickBooks answered 502.'));

		await sendDueEntries(deps(faulting.port), NOW);

		expect(await row(entryGroupId)).toMatchObject({
			status: 'pending',
			attempts: 1,
			lastError: 'QuickBooks answered 502.',
			remoteId: null
		});

		const qb = provider();
		await sendDueEntries(deps(qb.port), new Date(NOW.getTime() + MINUTE + 1_000));

		expect(qb.asked).toEqual([entryGroupId]);
		expect((await row(entryGroupId)).status).toBe('sent');
	});

	it('does not read a row whose wait is not over', async () => {
		const entryGroupId = await queuedGift();
		await tried(entryGroupId, 1, 30_000);
		const qb = provider();

		await sendDueEntries(deps(qb.port), NOW);

		// one attempt buys a minute, and half of one has passed.
		expect(qb.asked).toEqual([]);
		expect(await row(entryGroupId)).toMatchObject({ status: 'pending', attempts: 1 });
	});

	it('gives up on a row nothing about a later run would answer, and sends the one behind it', async () => {
		const unmapped = await queuedCorrection('salesTaxPayable');
		await tried(unmapped, 0, 10 * MINUTE);
		const sendable = await queuedGift();
		const qb = provider();

		await sendDueEntries(deps(qb.port), NOW);

		// refused while its record was being read, so nothing left for Intuit and the claim's attempt
		// is given back.
		expect(await row(unmapped)).toMatchObject({ status: 'failed', remoteId: null, attempts: 0 });
		expect((await row(unmapped)).lastError).toContain('Sales Tax Payable');
		expect((await row(sendable)).status).toBe('sent');
		expect(qb.asked).toEqual([sendable]);
	});

	it('stops the run on a dead credential, leaving every row unsent', async () => {
		const first = await queuedGift();
		await tried(first, 0, 10 * MINUTE);
		const second = await queuedGift();
		const qb = provider(() => failed('reconnect_needed', 'The refresh token was rejected.'));

		await sendDueEntries(deps(qb.port), NOW);

		expect(qb.asked).toEqual([first]);
		for (const entryGroupId of [first, second]) {
			expect(await row(entryGroupId)).toMatchObject({
				status: 'pending',
				attempts: 0,
				lastError: null,
				remoteId: null
			});
		}
	});

	it('holds a gift whose holding nobody has picked, and sends the one behind it', async () => {
		const held = await queuedGift();
		await tried(held, 0, 10 * MINUTE);
		const behind = await queuedGift();
		const qb = provider((key) =>
			key === held
				? failed('holding_not_chosen', 'No QuickBooks account is chosen for Stripe balance.')
				: accepted(key)
		);

		await sendDueEntries(deps(qb.port), NOW);

		// one processor's holding left unpicked is that processor's gifts waiting, not the backlog's.
		expect(qb.asked).toEqual([held, behind]);
		expect(await row(held)).toMatchObject({
			status: 'pending',
			attempts: 1,
			lastError: 'No QuickBooks account is chosen for Stripe balance.'
		});
		expect(await row(behind)).toMatchObject({ status: 'sent' });
	});

	it('stops the run where the income and fee accounts have not been picked, touching no row', async () => {
		const first = await queuedGift();
		await tried(first, 0, 10 * MINUTE);
		const second = await queuedGift();
		const qb = provider(() =>
			failed('accounts_not_chosen', 'No account is chosen for a gift’s income.')
		);

		await sendDueEntries(deps(qb.port), NOW);

		// the connection is made on one screen and the accounts picked on another, so a backlog
		// queued in between is waiting on a press rather than on anything about a row.
		expect(qb.asked).toEqual([first]);
		for (const entryGroupId of [first, second]) {
			expect(await row(entryGroupId)).toMatchObject({ status: 'pending', attempts: 0 });
		}
	});

	it('sends ten entry groups in a run and leaves the eleventh queued', async () => {
		const postings = Array.from({ length: 11 }, () => correction('donationsDeductible'));
		await commit(postings, postings);
		const qb = provider();

		await sendDueEntries(deps(qb.port), NOW);

		expect(qb.asked).toHaveLength(10);
		const statuses = await Promise.all(postings.map(async (p) => (await row(idOf(p))).status));
		expect(statuses.filter((status) => status === 'pending')).toHaveLength(1);
	});

	it('goes on to the row behind one whose send threw', async () => {
		const throwing = await queuedGift();
		await tried(throwing, 0, 10 * MINUTE);
		const behind = await queuedGift();
		const qb = provider((key) => {
			if (key === throwing) throw new Error('the isolate went away');
			return accepted(key);
		});

		await sendDueEntries(deps(qb.port), NOW);

		// left as the claim wrote it: what throws is the database or a defect in the adapter, and
		// either can come after the post landed, so the claim's attempt stays on the row.
		expect(await row(throwing)).toMatchObject({ status: 'pending', attempts: 1 });
		expect((await row(behind)).status).toBe('sent');
	});

	it('starts no send twenty seconds after the run was scheduled', async () => {
		const entryGroupId = await queuedGift();
		await tried(entryGroupId, 0, 30 * MINUTE);
		const qb = provider();

		await sendDueEntries(deps(qb.port), new Date(NOW.getTime() - 25_000));

		expect(qb.asked).toEqual([]);
		expect(await row(entryGroupId)).toMatchObject({ status: 'pending', attempts: 0 });
	});
});

describe('the failure notice', () => {
	it('is one email for the whole failing backlog, and stamps every row in it', async () => {
		const first = await queuedGift();
		const second = await queuedGift();
		const mail = mailer();
		const faulting = provider(() => failed('provider_error', 'QuickBooks answered 502.'));

		await sendDueEntries(deps(faulting.port, mail.port), NOW);

		expect(mail.sent).toHaveLength(1);
		expect(mail.sent[0]).toMatchObject({ to: 'ops@hope.example' });
		expect(mail.sent[0]?.text).toContain('QuickBooks answered 502.');
		expect((await row(first)).notifiedAt).not.toBeNull();
		expect((await row(second)).notifiedAt).not.toBeNull();
	});

	it('counts what is waiting and what has been given up on', async () => {
		const waiting = await queuedGift();
		const givenUp = await queuedCorrection('salesTaxPayable');
		const mail = mailer();
		const qb = provider((key) =>
			key === waiting ? failed('provider_error', 'QuickBooks answered 502.') : accepted(key)
		);

		await sendDueEntries(deps(qb.port, mail.port), NOW);

		expect((await row(givenUp)).status).toBe('failed');
		expect(mail.sent[0]?.text).toContain('Waiting to be sent: 1');
		expect(mail.sent[0]?.text).toContain('Given up on: 1');
	});

	it('stamps a row without putting off the next attempt on it', async () => {
		const entryGroupId = await queuedGift();
		const mail = mailer();
		const faulting = provider(() => failed('provider_error', 'QuickBooks answered 502.'));

		await sendDueEntries(deps(faulting.port, mail.port), NOW);

		// `updated_at` is what the wait is measured from, so a row costed an extra interval for
		// having been reported is a gift that reaches the books later for no reason at all.
		expect(await row(entryGroupId)).toMatchObject({ notifiedAt: NOW, updatedAt: NOW });
	});

	it('reports a fresh backlog behind a row given up on and stamped months ago', async () => {
		const abandoned = await queuedGift();
		await givenUpOn(abandoned, 60 * 24 * 60 * MINUTE);
		await queuedGift();
		const mail = mailer();
		const faulting = provider(() => failed('provider_error', 'QuickBooks answered 502.'));

		await sendDueEntries(deps(faulting.port, mail.port), NOW);

		// a row nobody ever retried never leaves the failing set, so a stamp that silenced on
		// existing at all would silence every outage behind that one gift, forever.
		expect(mail.sent).toHaveLength(1);
		// re-armed rather than left standing: the stamp is what the next day's cooldown is measured
		// from, and a row keeping its old one would report the same backlog again tomorrow.
		expect((await row(abandoned)).notifiedAt).toEqual(NOW);
	});

	it('says nothing about a backlog reported an hour ago', async () => {
		await queuedGift();
		const mail = mailer();
		const faulting = provider(() => failed('provider_error', 'QuickBooks answered 502.'));

		await sendDueEntries(deps(faulting.port, mail.port), NOW);
		await sendDueEntries(deps(faulting.port, mail.port), new Date(NOW.getTime() + 60 * MINUTE));

		expect(mail.sent).toHaveLength(1);
	});

	it('is sent again for a backlog nobody has repaired in a day', async () => {
		await queuedGift();
		const mail = mailer();
		const faulting = provider(() => failed('provider_error', 'QuickBooks answered 502.'));

		await sendDueEntries(deps(faulting.port, mail.port), NOW);
		await sendDueEntries(
			deps(faulting.port, mail.port),
			new Date(NOW.getTime() + 25 * 60 * MINUTE)
		);

		expect(mail.sent).toHaveLength(2);
	});

	it('is sent again for a backlog that cleared and then failed again', async () => {
		const first = await queuedGift();
		const mail = mailer();
		const faulting = provider(() => failed('provider_error', 'QuickBooks answered 502.'));

		await sendDueEntries(deps(faulting.port, mail.port), NOW);
		await sendDueEntries(deps(provider().port, mail.port), new Date(NOW.getTime() + 2 * MINUTE));
		expect((await row(first)).status).toBe('sent');

		const second = await queuedGift();
		await sendDueEntries(deps(faulting.port, mail.port), new Date(NOW.getTime() + 3 * MINUTE));

		expect((await row(second)).status).toBe('pending');
		expect(mail.sent).toHaveLength(2);
	});

	it('says nothing about a run with nothing due', async () => {
		const sent = await queuedGift();
		await sendDueEntries(deps(provider().port), NOW);
		const before = await row(sent);
		const mail = mailer();
		const qb = provider();

		await sendDueEntries(deps(qb.port, mail.port), new Date(NOW.getTime() + MINUTE));

		expect(qb.asked).toEqual([]);
		expect(mail.sent).toEqual([]);
		expect(await row(sent)).toEqual(before);
	});

	it('counts a gift whose run died holding it, once the lease is out', async () => {
		const died = await queuedGift();
		// how a claim leaves a row when its send throws: counted, lease run out, and — measured from
		// the `updated_at` the claim held — inside its wait, so this run does not take it again.
		await tried(died, 1, 30_000);
		await lease(died, -1);
		const mail = mailer();

		await sendDueEntries(deps(provider().port, mail.port), NOW);

		expect(mail.sent).toHaveLength(1);
		expect(mail.sent[0]?.text).toContain('Waiting to be sent: 1');
		expect((await row(died)).notifiedAt).not.toBeNull();
	});

	it('says nothing about a gift another run is sending right now', async () => {
		const inFlight = await queuedGift();
		const mail = mailer();
		const qb = provider(async (key) => {
			// a second run finishes while this send is still out, with the claim's attempt on the row.
			await sendDueEntries(deps(provider().port, mail.port), NOW);
			return accepted(key);
		});

		await sendDueEntries(deps(qb.port), NOW);

		expect(mail.sent).toEqual([]);
		expect((await row(inFlight)).status).toBe('sent');
	});
});

describe('the notice for a run that could not send anything', () => {
	const DEAD = () => failed('reconnect_needed', 'The refresh token was rejected.');

	it('tells an operator as soon as a dead credential has a backlog behind it', async () => {
		const first = await queuedGift();
		const second = await queuedGift();
		const mail = mailer();

		await sendDueEntries(deps(provider(DEAD).port, mail.port), NOW);

		expect(mail.sent).toHaveLength(1);
		expect(mail.sent[0]?.text).toContain('The refresh token was rejected.');
		expect(mail.sent[0]?.text).toContain('Waiting to be sent: 2');
		for (const entryGroupId of [first, second]) {
			// the row the run never reached is stamped with the one it did: what is being reported is
			// the backlog, not a row.
			expect(await row(entryGroupId)).toMatchObject({
				notifiedAt: NOW,
				attempts: 0,
				updatedAt: QUEUED_AT
			});
		}
	});

	it('tells an operator as soon as the accounts are unpicked with a backlog behind them', async () => {
		const entryGroupId = await queuedGift();
		const mail = mailer();
		const qb = provider(() =>
			failed('accounts_not_chosen', 'No account is chosen for a gift’s income.')
		);

		await sendDueEntries(deps(qb.port, mail.port), NOW);

		expect(mail.sent).toHaveLength(1);
		expect(mail.sent[0]?.text).toContain('No account is chosen for a gift’s income.');
		expect((await row(entryGroupId)).notifiedAt).toEqual(NOW);
	});

	it('is not sent a second time while the same fault stands', async () => {
		await queuedGift();
		const mail = mailer();

		await sendDueEntries(deps(provider(DEAD).port, mail.port), NOW);
		await sendDueEntries(deps(provider(DEAD).port, mail.port), new Date(NOW.getTime() + MINUTE));

		expect(mail.sent).toHaveLength(1);
	});

	it('takes the same rung as the failing notice, and re-arms after a day', async () => {
		await queuedGift();
		const mail = mailer();

		await sendDueEntries(deps(provider(DEAD).port, mail.port), NOW);
		await sendDueEntries(
			deps(provider(DEAD).port, mail.port),
			new Date(NOW.getTime() + 25 * 60 * MINUTE)
		);

		expect(mail.sent).toHaveLength(2);
	});

	it('says nothing where the backlog was finished while the run was waiting', async () => {
		const entryGroupId = await queuedGift();
		const mail = mailer();
		const qb = provider(async () => {
			// a run overlapping this one sent the only queued entry before this one's answer came
			// back. there is no backlog behind the fault, so there is nothing to report yet.
			await env.DB.prepare(
				"update quickbooks_sync set status = 'sent', remote_id = 'qb-elsewhere'"
			).run();
			return failed('reconnect_needed', 'The refresh token was rejected.');
		});

		await sendDueEntries(deps(qb.port, mail.port), NOW);

		expect(mail.sent).toEqual([]);
		expect((await row(entryGroupId)).notifiedAt).toBeNull();
	});

	it('says nothing about a provider that could not be reached this minute', async () => {
		const entryGroupId = await queuedGift();
		const mail = mailer();
		const qb = provider(() =>
			failed('unreachable', 'QuickBooks could not be reached (TimeoutError).')
		);

		await sendDueEntries(deps(qb.port, mail.port), NOW);

		// five minutes of backlog behind one timeout is a blip, and the next run clears it.
		expect(mail.sent).toEqual([]);
		expect((await row(entryGroupId)).notifiedAt).toBeNull();
	});

	it('tells an operator where a gift has waited out the hour unreachable', async () => {
		const entryGroupId = await queuedGift();
		await tried(entryGroupId, 0, 2 * 60 * MINUTE);
		const mail = mailer();
		const qb = provider(() =>
			failed('unreachable', 'QuickBooks could not be reached (TimeoutError).')
		);

		await sendDueEntries(deps(qb.port, mail.port), NOW);

		expect(mail.sent).toHaveLength(1);
		expect(mail.sent[0]?.text).toContain('Oldest has waited: 2 hours');
		expect((await row(entryGroupId)).notifiedAt).toEqual(NOW);
	});

	it('says nothing about a throttled provider, whatever is behind it', async () => {
		const entryGroupId = await queuedGift();
		await tried(entryGroupId, 0, 6 * 60 * MINUTE);
		const mail = mailer();
		const qb = provider(() => failed('rate_limited', 'Intuit is throttling this app.'));

		await sendDueEntries(deps(qb.port, mail.port), NOW);

		// it clears itself within a run or two, and the rows behind it were never touched.
		expect(mail.sent).toEqual([]);
		expect((await row(entryGroupId)).notifiedAt).toBeNull();
	});

	it('says nothing about a renewed credential it could not store, and leaves the backlog as it was', async () => {
		const entryGroupId = await queuedGift();
		await tried(entryGroupId, 0, 6 * 60 * MINUTE);
		const mail = mailer();
		const unsaved = provider(() =>
			failed('credential_unsaved', 'QuickBooks issued a new credential and it could not be stored.')
		);

		await sendDueEntries(deps(unsaved.port, mail.port), NOW);

		// the stored token still renews for a day, so this is a write to try again, not an outage.
		expect(mail.sent).toEqual([]);
		expect(await row(entryGroupId)).toMatchObject({
			status: 'pending',
			attempts: 0,
			lastError: null,
			notifiedAt: null
		});

		const next = provider();
		await sendDueEntries(deps(next.port, mail.port), new Date(NOW.getTime() + MINUTE));

		expect(next.asked).toEqual([entryGroupId]);
		expect(next.attempts).toEqual(['first']);
	});

	it('says nothing where no company is connected', async () => {
		const entryGroupId = await queuedGift();
		await tried(entryGroupId, 0, 6 * 60 * MINUTE);
		const mail = mailer();
		const qb = provider(() => failed('not_connected', 'No QuickBooks company is connected.'));

		await sendDueEntries(deps(qb.port, mail.port), NOW);

		// disconnecting is something somebody did, and the console's connection screen shows it.
		expect(mail.sent).toEqual([]);
		expect((await row(entryGroupId)).notifiedAt).toBeNull();
	});

	it('tells an operator again about a backlog that cleared and then blocked again', async () => {
		const first = await queuedGift();
		const mail = mailer();

		await sendDueEntries(deps(provider(DEAD).port, mail.port), NOW);
		await sendDueEntries(deps(provider().port, mail.port), new Date(NOW.getTime() + MINUTE));
		expect((await row(first)).status).toBe('sent');

		await queuedGift();
		await sendDueEntries(
			deps(provider(DEAD).port, mail.port),
			new Date(NOW.getTime() + 2 * MINUTE)
		);

		expect(mail.sent).toHaveLength(2);
	});

	it('says which of the two outages it is', async () => {
		const first = await queuedGift();
		const mail = mailer();

		await sendDueEntries(deps(provider(DEAD).port, mail.port), NOW);
		await sendDueEntries(deps(provider().port, mail.port), new Date(NOW.getTime() + MINUTE));
		expect((await row(first)).status).toBe('sent');

		await queuedGift();
		const refusing = provider(() => failed('provider_error', 'QuickBooks answered 502.'));
		await sendDueEntries(deps(refusing.port, mail.port), new Date(NOW.getTime() + 2 * MINUTE));

		// one sends an operator to the connection and the other to the gifts, so the two may never
		// read as the same outage.
		expect(mail.sent.map((message) => message.subject)).toEqual([
			'Nothing is reaching QuickBooks at all',
			'QuickBooks would not take some of this deployment’s gifts'
		]);
	});
});
