import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { donation } from '../db/schema';
import type { EmailMessage, EmailProvider } from '../email/provider';
import type { PaymentProvider } from '../payments/provider';
import type { SettleDeps } from './delivery';
import { sendReceipt } from './receipt';

// the one sender, against a real D1: what it sends, what it stamps, and what a second call for a
// gift already receipted does.
//
// the database is real because the claim is the whole subject — `receipt_sent_at` set only over a
// row where it is still null is a property of the statement rather than of this module's control
// flow, and standing in for D1 would only prove the stand-in (CLAUDE.md).
//
// it is driven directly rather than through ./settle.ts or ./collect.ts on purpose: both of those
// reach this module and neither may be what makes "one receipt per gift" true, so the claim is
// asserted where it is enforced.

const CONTACT_ID = '019fb300-0000-7000-8000-000000000010';
const DONATION_ID = '019fb300-0000-7000-8000-000000000011';

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	for (const table of ['payment', 'line_item', 'donation', 'contact', 'org_profile']) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	await env.DB.prepare(
		`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
		 values (?, 'individual', 'Ada Okafor', 'ada@example.org', 0, 0)`
	)
		.bind(CONTACT_ID)
		.run();
	await env.DB.prepare(
		`insert into donation (id, contact_id, total_minor, currency, fee_minor, received_at, created_at)
		 values (?, ?, 2500, 'USD', 0, 1754222400000, 0)`
	)
		.bind(DONATION_ID, CONTACT_ID)
		.run();
});

/** the organisation's details, without which no donor receipt renders at all. */
const orgProfile = () =>
	env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, deductibility_statement, address_line1,
		                          city, country, notification_email, created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789', 'No goods or services were provided.',
		         '1 Main St', 'Springfield', 'US', 'ops@hope.example', 0, 0)`
	).run();

function mailer(ok = true) {
	const sent: EmailMessage[] = [];
	const port: EmailProvider = {
		async send(message) {
			sent.push(message);
			return ok
				? { ok: true }
				: { ok: false, reason: 'connect_failed', detail: 'no route to host', indeterminate: false };
		}
	};
	return { port, sent };
}

/**
 * the payment port, which this module never calls.
 *
 * every method refuses, so a receipt that reached the processor for anything would fail here rather
 * than pass quietly — which is the claim `SettleDeps` in ./delivery.ts makes about this consumer.
 */
const provider = new Proxy({} as PaymentProvider, {
	get: (_, name) => async () => {
		throw new Error(`the receipt path called ${String(name)} on the payment port`);
	}
});

const deps = (email: EmailProvider): SettleDeps => ({ db, provider, email });

const target = (over: Partial<Parameters<typeof sendReceipt>[1]> = {}) => ({
	donationId: DONATION_ID,
	donorName: 'Ada Okafor',
	donorEmail: 'ada@example.org' as string | null,
	contribution: {
		totalMinor: 2500,
		nonDeductibleMinor: 0,
		coveredFeeMinor: 0,
		currency: 'USD',
		receivedAt: new Date('2026-08-03T12:00:00.000Z')
	},
	// the ordinary gift, given for nobody. what a dedicated one prints is
	// packages/emails/src/templates/receipt.spec.tsx, and that it survives the whole settlement
	// path is ./settle.workers.spec.ts.
	tribute: null,
	// the ordinary gift, credited to no cause. the row the template draws for one is
	// packages/emails/src/templates/receipt.spec.tsx; the two cases below are that this module
	// hands the name over rather than dropping it.
	program: null as string | null,
	...over
});

const stampOf = async () => {
	const [row] = await db.select().from(donation).where(eq(donation.id, DONATION_ID));
	return row?.receiptSentAt ?? null;
};

describe('sendReceipt()', () => {
	beforeEach(orgProfile);

	it('sends the donor their receipt and stamps the gift', async () => {
		const mail = mailer();

		const outcome = await sendReceipt(deps(mail.port), target());

		expect(outcome).toBe('sent');
		expect(mail.sent.map((m) => m.to)).toEqual(['ada@example.org']);
		expect(await stampOf()).not.toBeNull();
	});

	it('sends nothing for a gift already receipted, and keeps the stamp it had', async () => {
		const first = mailer();
		await sendReceipt(deps(first.port), target());
		const stamped = await stampOf();

		const again = mailer();
		await sendReceipt(deps(again.port), target());

		// the claim is what refuses it, so a second caller cannot receipt a donor twice by reasoning
		// its way to the same gift — which is the rule this module exists to hold rather than to
		// document.
		expect(again.sent).toHaveLength(0);
		expect(await stampOf()).toEqual(stamped);
	});

	/**
	 * the one outcome a caller can say something true about.
	 *
	 * every other way of not sending has already told an operator on its own, and a donor with no
	 * address has not — so it is answered distinctly rather than collapsed into "not sent", which is
	 * what lets ./settled-notice.ts state it without predicting anything about this module.
	 */
	it('sends nothing for a donor there is no address for, and says which it was', async () => {
		const mail = mailer();

		const outcome = await sendReceipt(deps(mail.port), target({ donorEmail: null }));

		expect(outcome).toBe('no_address');
		expect(mail.sent).toHaveLength(0);
		expect(await stampOf()).toBeNull();
	});

	it('answers a gift already receipted without claiming it sent anything', async () => {
		await sendReceipt(deps(mailer().port), target());

		const outcome = await sendReceipt(deps(mailer().port), target());

		// a receipt did go, just not on this call — and the caller must not read that as the donor
		// having been left with nothing.
		expect(outcome).toBe('not_sent');
	});

	it('answers a send that failed the same way, having already reported it', async () => {
		const outcome = await sendReceipt(deps(mailer(false).port), target());

		expect(outcome).toBe('not_sent');
	});

	it('hands the claim back when the send fails, and can send on the next attempt', async () => {
		await sendReceipt(deps(mailer(false).port), target());

		// the claim is taken before the mail, so a send that failed has to give it back: a gift left
		// reading "receipted" over a receipt nobody got is the one state the unreceipted list cannot
		// show anybody.
		expect(await stampOf()).toBeNull();

		const retry = mailer();
		await sendReceipt(deps(retry.port), target());

		expect(retry.sent.map((m) => m.to)).toEqual(['ada@example.org']);
		expect(await stampOf()).not.toBeNull();
	});

	it('states the cause the gift was credited to', async () => {
		const mail = mailer();

		await sendReceipt(deps(mail.port), target({ program: 'Clean water' }));

		expect(mail.sent[0]?.text).toContain('Clean water');
	});

	it('states no cause on a gift credited to none', async () => {
		const mail = mailer();

		await sendReceipt(deps(mail.port), target());

		// the row is omitted rather than printed empty — a receipt naming a blank cause is a
		// document a donor files with a gap in it.
		expect(mail.sent[0]?.text).not.toContain('Program');
	});

	it('hands the claim back when the receipt step faults outright', async () => {
		const broken: EmailProvider = {
			async send() {
				throw new Error('the socket went away');
			}
		};

		// the alert goes out over the same transport, so this is also the case where reporting the
		// fault faults. neither may raise: the caller has already committed the gift to the books.
		await expect(sendReceipt(deps(broken), target())).resolves.toBe('not_sent');
		expect(await stampOf()).toBeNull();
	});
});

describe('sendReceipt() — a deployment that cannot render one yet', () => {
	it('hands the claim back and leaves the gift owed a receipt', async () => {
		const mail = mailer();

		// no `org_profile` row, so the donor audience refuses rather than printing a document with a
		// blank legal name on it (../email/receipt.ts).
		await sendReceipt(deps(mail.port), target());

		expect(mail.sent).toHaveLength(0);
		expect(await stampOf()).toBeNull();
	});
});
