import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '../db/client';
import type { EmailMessage, EmailProvider, SendResult } from '../email/provider';
import type { MailDeps } from './delivery';
import { sendOwedRefundNotices, sendRefundNotice, type RefundNoticeTarget } from './refund-notice';

// the one sender of the refund notice, against a real D1 for the donor it reads off the gift, the
// organisation's details and the staff address an alert goes to. driven directly rather than
// through ./reverse.ts, the same as ./tribute-notice.workers.spec.ts: which deliveries reach it is
// that writer's to prove, and what one call does is this file's.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

const CONTACT_ID = '019fb400-0000-7000-8000-000000000001';
const DONATION_ID = '019fb400-0000-7000-8000-000000000002';
const GIFT_ID = '019fb400-0000-7000-8000-000000000003';
const REFUND_ID = '019fb400-0000-7000-8000-000000000004';

beforeEach(async () => {
	for (const table of ['dispute', 'payment', 'donation', 'contact', 'org_profile']) {
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
		 values (?, ?, 10000, 'USD', 0, 1785758400000, 0)`
	)
		.bind(DONATION_ID, CONTACT_ID)
		.run();
	await env.DB.prepare(
		`insert into payment (id, donation_id, amount_minor, currency, direction, method, status,
		                      occurred_at, created_at)
		 values (?, ?, 10000, 'USD', 'inbound', 'card', 'succeeded', 1785758400000, 0)`
	)
		.bind(GIFT_ID, DONATION_ID)
		.run();
});

/** the organisation's details, with the address staff alerts go to. */
const orgProfile = () =>
	env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, deductibility_statement, address_line1,
		                          city, country, notification_email, created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789', 'No goods or services were provided.',
		         '1 Main St', 'Springfield', 'US', 'ops@hope.example', 0, 0)`
	).run();

/** a transport that records every message, and refuses the ones addressed to `refuse`. */
function mailer(refuse: string | null = null) {
	const sent: EmailMessage[] = [];
	const port: EmailProvider = {
		async send(message) {
			sent.push(message);
			return message.to === refuse
				? { ok: false, reason: 'connect_failed', detail: 'no route to host', indeterminate: false }
				: { ok: true };
		}
	};
	return { port, sent };
}

const deps = (email: EmailProvider): MailDeps => ({ db, email });

const target = (over: Partial<RefundNoticeTarget> = {}): RefundNoticeTarget => ({
	giftPaymentId: GIFT_ID,
	donationId: DONATION_ID,
	refundId: REFUND_ID,
	giftMinor: 10_000,
	refundedMinor: 2_500,
	currency: 'USD',
	...over
});

/** a refund-direction row of the gift, as the writer leaves one: standing unless told otherwise. */
async function withdrawal(
	id: string,
	amountMinor: number,
	disputed: 'open' | 'lost' | null = null
) {
	await env.DB.prepare(
		`insert into payment (id, donation_id, amount_minor, currency, direction, method, status,
		                      occurred_at, parent_payment_id, created_at)
		 values (?, ?, ?, 'USD', 'refund', 'card', 'succeeded', 1787000000000, ?, 0)`
	)
		.bind(id, DONATION_ID, amountMinor, GIFT_ID)
		.run();
	if (disputed === null) return;
	await env.DB.prepare(
		`insert into dispute (payment_id, outcome, closed_at, created_at, updated_at)
		 values (?, ?, ?, 0, 0)`
	)
		.bind(id, disputed === 'lost' ? 'lost' : null, disputed === 'lost' ? 1787000000000 : null)
		.run();
}

describe('sendRefundNotice()', () => {
	it('writes to the donor, naming the part refunded and what is now deductible', async () => {
		await orgProfile();
		await withdrawal(REFUND_ID, 2_500);
		const mail = mailer();

		await sendRefundNotice(deps(mail.port), target());

		expect(mail.sent.map((m) => m.to)).toEqual(['ada@example.org']);
		const [notice] = mail.sent;
		expect(notice?.subject).toBe('Part of your gift to Hope Foundation has been refunded');
		expect(notice?.text).toContain('Dear Ada,');
		expect(notice?.text).toContain('USD 25.00');
		expect(notice?.text).toContain('USD 75.00');
	});

	/** the receipt names the day the gift was authorized, which a slow settlement does not move. */
	it('names the gift by the day on its receipt, not the day it settled', async () => {
		await orgProfile();
		await env.DB.prepare('update payment set occurred_at = ? where id = ?')
			.bind(Date.parse('2026-09-01T09:00:00Z'), GIFT_ID)
			.run();
		await withdrawal(REFUND_ID, 2_500);
		const mail = mailer();

		await sendRefundNotice(deps(mail.port), target());

		expect(mail.sent[0]?.text).toContain('made on August 3, 2026');
	});

	it('states as deductible what the gift collected less the refunds that stand and the part that was never deductible', async () => {
		await orgProfile();
		await env.DB.prepare('update donation set non_deductible_minor = 1000 where id = ?')
			.bind(DONATION_ID)
			.run();
		await withdrawal(REFUND_ID, 2_500);
		await withdrawal('019fb400-0000-7000-8000-000000000005', 500, 'lost');
		await withdrawal('019fb400-0000-7000-8000-000000000006', 3_000, 'open');
		const mail = mailer();

		await sendRefundNotice(deps(mail.port), target());

		expect(mail.sent[0]?.text).toContain('the deductible amount of this gift is now USD 60.00');
	});

	it('states nothing deductible, never below it, once the refunds and the part never deductible reach the gift', async () => {
		await orgProfile();
		await env.DB.prepare('update donation set non_deductible_minor = 3000 where id = ?')
			.bind(DONATION_ID)
			.run();
		await withdrawal(REFUND_ID, 8_000);
		const mail = mailer();

		await sendRefundNotice(deps(mail.port), target({ refundedMinor: 8_000 }));

		expect(mail.sent[0]?.text).toContain('the deductible amount of this gift is now USD 0.00');
	});

	it('says the whole gift was refunded once nothing of it is left', async () => {
		await orgProfile();
		await withdrawal(REFUND_ID, 10_000);
		const mail = mailer();

		await sendRefundNotice(deps(mail.port), target({ refundedMinor: 10_000 }));

		expect(mail.sent[0]?.subject).toBe('Your gift to Hope Foundation has been refunded');
	});

	/** nothing deductible is not nothing left: the part never deductible is still the donor's gift. */
	it('says part of the gift was refunded while some is left, though none of it is deductible', async () => {
		await orgProfile();
		await env.DB.prepare('update donation set non_deductible_minor = 3000 where id = ?')
			.bind(DONATION_ID)
			.run();
		await withdrawal(REFUND_ID, 8_000);
		const mail = mailer();

		await sendRefundNotice(deps(mail.port), target({ refundedMinor: 8_000 }));

		expect(mail.sent[0]?.subject).toBe('Part of your gift to Hope Foundation has been refunded');
	});

	/** an unaddressed donor is not a fault: nobody is written to and nobody is alerted. */
	it('sends nothing where the donor gave no address', async () => {
		await orgProfile();
		const mail = mailer();

		await env.DB.prepare('update contact set primary_email = null where id = ?')
			.bind(CONTACT_ID)
			.run();

		await sendRefundNotice(deps(mail.port), target());

		expect(mail.sent).toHaveLength(0);
	});

	/**
	 * a registered name is what the notice cannot be written without, and a deployment with no
	 * organisation saved has no staff address either (a blank name is refused by the table's own
	 * CHECK), so the alert reaches the logs and nowhere else — `alert`'s floor in ./delivery.ts.
	 */
	it('writes to nobody where the organisation is not saved, and says so in the logs', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const mail = mailer();

		await sendRefundNotice(deps(mail.port), target());
		const lines = logged.mock.calls.map(([line]) => line);
		logged.mockRestore();

		expect(mail.sent).toHaveLength(0);
		expect(lines).toContain('A donor wasn’t told about their refund:');
	});

	/** the refund stands whether or not the donor heard of it, so staff are told who was missed. */
	it('tells staff when the transport refuses the notice', async () => {
		await orgProfile();
		const mail = mailer('ada@example.org');

		await sendRefundNotice(deps(mail.port), target());

		expect(mail.sent.map((m) => m.to)).toEqual(['ada@example.org', 'ops@hope.example']);
		const alerted = mail.sent[1];
		expect(alerted?.subject).toBe('A donor wasn’t told about their refund');
		expect(alerted?.text).toContain(REFUND_ID);
		expect(alerted?.text).toContain('no route to host');
		const said = alerted?.text.replace(/\s+/g, ' ');
		expect(said).toContain('It will be sent again automatically for up to a week.');
		expect(said).toContain('go to SMTP and press Send test email');
	});

	/**
	 * it runs after the refund's batch has committed, so a throw would be a 5xx the processor reads
	 * as "deliver this again" against a refund already recorded. nothing escapes, and staff are
	 * told the step faulted.
	 */
	it('never throws, and tells staff when the transport faults outright', async () => {
		await orgProfile();
		const sent: EmailMessage[] = [];
		const port: EmailProvider = {
			async send(message) {
				if (message.to === 'ada@example.org') throw new Error('socket hung up');
				sent.push(message);
				return { ok: true };
			}
		};

		await expect(sendRefundNotice(deps(port), target())).resolves.toBeUndefined();

		expect(sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(sent[0]?.subject).toBe('A donor wasn’t told about their refund');
		expect(sent[0]?.text.replace(/\s+/g, ' ')).toContain('failed with an unexpected error');
		expect(sent[0]?.text).toContain('socket hung up');
	});

	it('never throws when the alert’s own transport faults too', async () => {
		await orgProfile();
		const port: EmailProvider = {
			async send() {
				throw new Error('socket hung up');
			}
		};
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(sendRefundNotice(deps(port), target())).resolves.toBeUndefined();
		logged.mockRestore();
	});
});

const HOUR = 60 * 60_000;

/**
 * a run now, which is what its deadline reads the clock against, over refunds written `ago` before
 * it — by default an hour, past the delivery's own grace and well inside the week a notice is
 * owed for.
 */
async function sweep(email: EmailProvider, ago = HOUR) {
	const now = Date.now();
	await env.DB.prepare(`update payment set created_at = ? where direction = 'refund'`)
		.bind(now - ago)
		.run();
	await sendOwedRefundNotices(deps(email), new Date(now));
}

/**
 * a refund that tells its donor, as ./reverse.ts writes one: owing its notice from the moment it is
 * written until a send goes.
 */
async function owedRefund(id: string, amountMinor: number) {
	await withdrawal(id, amountMinor);
	await env.DB.prepare('update payment set notice_owed_since = created_at where id = ?')
		.bind(id)
		.run();
}

/** a transport that answers every message to the donor with `failure`, and records them all. */
function failing(failure: Extract<SendResult, { ok: false }>) {
	const sent: EmailMessage[] = [];
	const port: EmailProvider = {
		async send(message) {
			sent.push(message);
			return message.to === 'ada@example.org' ? failure : { ok: true };
		}
	};
	return { port, sent };
}

const TIMED_OUT = {
	ok: false,
	reason: 'connect_failed',
	detail: 'Could not reach the mail host in `SMTP_HOST`: Timed out waiting for response.',
	indeterminate: true
} as const;

const NOT_AN_ADDRESS = {
	ok: false,
	reason: 'invalid_message',
	detail: 'The recipient is not a bare address.',
	indeterminate: false
} as const;

describe('sendOwedRefundNotices()', () => {
	/** the outage is the case it exists for: the alert rides the same transport and is lost too. */
	it('sends a notice the transport refused, once the transport is back', async () => {
		await orgProfile();
		await owedRefund(REFUND_ID, 2_500);
		await sendRefundNotice(deps(mailer('ada@example.org').port), target());
		const mail = mailer();

		await sweep(mail.port);

		expect(mail.sent.map((m) => m.to)).toEqual(['ada@example.org']);
		expect(mail.sent[0]?.subject).toBe('Part of your gift to Hope Foundation has been refunded');
		expect(mail.sent[0]?.text).toContain('USD 25.00');
		expect(mail.sent[0]?.text).toContain('USD 75.00');
	});

	it('never sends again a notice that went', async () => {
		await orgProfile();
		await owedRefund(REFUND_ID, 2_500);
		await sendRefundNotice(deps(mailer().port), target());
		const mail = mailer();

		await sweep(mail.port);

		expect(mail.sent).toEqual([]);
	});

	it('sends a notice whose step faulted outright', async () => {
		await orgProfile();
		await owedRefund(REFUND_ID, 2_500);
		const faulting: EmailProvider = {
			async send() {
				throw new Error('socket hung up');
			}
		};
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await sendRefundNotice(deps(faulting), target());
		const mail = mailer();

		await sweep(mail.port);

		expect(mail.sent.map((m) => m.to)).toEqual(['ada@example.org']);
	});

	it('sends a notice once, however many runs follow', async () => {
		await orgProfile();
		await owedRefund(REFUND_ID, 2_500);
		const mail = mailer();

		await sweep(mail.port);
		await sweep(mail.port);

		expect(mail.sent.map((m) => m.to)).toEqual(['ada@example.org']);
	});

	/** a donor given an address later is not written to about a refund nobody could tell them of. */
	it('owes nothing on a refund whose donor had no address', async () => {
		await orgProfile();
		await owedRefund(REFUND_ID, 2_500);
		await env.DB.prepare('update contact set primary_email = null where id = ?')
			.bind(CONTACT_ID)
			.run();
		await sendRefundNotice(deps(mailer().port), target());
		await env.DB.prepare(`update contact set primary_email = 'ada@example.org' where id = ?`)
			.bind(CONTACT_ID)
			.run();
		const mail = mailer();

		await sweep(mail.port);

		expect(mail.sent).toEqual([]);
	});

	/** the delivery that wrote it is still on its own send, and two would reach the donor. */
	it('leaves a refund written in the last half hour to the delivery that wrote it', async () => {
		await orgProfile();
		await owedRefund(REFUND_ID, 2_500);
		const mail = mailer();

		await sweep(mail.port, 29 * 60_000);

		expect(mail.sent).toEqual([]);
	});

	it('gives up on a notice a week after its refund', async () => {
		await orgProfile();
		await owedRefund(REFUND_ID, 2_500);
		const mail = mailer();

		await sweep(mail.port, 7 * 24 * HOUR);

		expect(mail.sent).toEqual([]);
	});

	it('sends nothing of a refund that did not stand', async () => {
		await orgProfile();
		await owedRefund(REFUND_ID, 2_500);
		await env.DB.prepare(`update payment set status = 'cancelled' where id = ?`)
			.bind(REFUND_ID)
			.run();
		const mail = mailer();

		await sweep(mail.port);

		expect(mail.sent).toEqual([]);
	});

	/** the delivery that wrote the refund told staff; a run every half hour would tell them again. */
	it('logs a notice that still does not send, tells staff nothing, and keeps it owed', async () => {
		await orgProfile();
		await owedRefund(REFUND_ID, 2_500);
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const refusing = mailer('ada@example.org');

		await sweep(refusing.port);
		const lines = logged.mock.calls.map(([line]) => line);
		const mail = mailer();
		await sweep(mail.port);

		expect(refusing.sent.map((m) => m.to)).toEqual(['ada@example.org']);
		expect(lines).toContain('A donor wasn’t told about their refund:');
		expect(mail.sent.map((m) => m.to)).toEqual(['ada@example.org']);
	});

	/** a worker from before the column records a refund it has already told the donor of. */
	it('owes nothing on a refund written without the column', async () => {
		await orgProfile();
		await withdrawal(REFUND_ID, 2_500);
		const mail = mailer();

		await sweep(mail.port);

		expect(mail.sent).toEqual([]);
	});

	/** the first timeout on the delivery is the outage case: the host may simply not be there. */
	it('sends again a notice whose delivery send timed out', async () => {
		await orgProfile();
		await owedRefund(REFUND_ID, 2_500);
		await sendRefundNotice(deps(failing(TIMED_OUT).port), target());
		const mail = mailer();

		await sweep(mail.port);

		expect(mail.sent.map((m) => m.to)).toEqual(['ada@example.org']);
	});

	/** a host that takes the message and then goes quiet would otherwise get it every half hour. */
	it('stops owing a notice once a run’s own send of it times out', async () => {
		await orgProfile();
		await owedRefund(REFUND_ID, 2_500);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const timedOut = failing(TIMED_OUT);
		await sweep(timedOut.port);
		const mail = mailer();

		await sweep(mail.port);

		expect(timedOut.sent.map((m) => m.to)).toEqual(['ada@example.org']);
		expect(mail.sent).toEqual([]);
	});

	it('stops owing a notice the transport refuses as unsendable, on a run', async () => {
		await orgProfile();
		await owedRefund(REFUND_ID, 2_500);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await sweep(failing(NOT_AN_ADDRESS).port);
		const mail = mailer();

		await sweep(mail.port);

		expect(mail.sent).toEqual([]);
	});

	it('stops owing a notice the transport refuses as unsendable, on the delivery, and tells staff', async () => {
		await orgProfile();
		await owedRefund(REFUND_ID, 2_500);
		const refused = failing(NOT_AN_ADDRESS);
		await sendRefundNotice(deps(refused.port), target());
		const mail = mailer();

		await sweep(mail.port);

		expect(refused.sent.map((m) => m.to)).toEqual(['ada@example.org', 'ops@hope.example']);
		expect(mail.sent).toEqual([]);
		// no mail setting fixes an address the transport refuses, so staff are sent to the gift.
		const said = refused.sent[1]?.text.replace(/\s+/g, ' ');
		expect(said).toContain('It won’t be sent again.');
		expect(said).toContain('The donor’s email address was refused.');
		expect(said).not.toContain('SMTP');
	});
});
