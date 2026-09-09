import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { donation } from '../db/schema';
import type { EmailMessage, EmailProvider } from '../email/provider';
import type { PaymentProvider } from '../payments/provider';
import type { SettleDeps } from './delivery';
import { sendTributeNotice } from './tribute-notice';

// the one sender of the tribute notice, against a real D1: who it writes to, what it stamps, and
// what a second call for a gift already notified does.
//
// the database is real because the claim is the whole subject — `tribute_notified_at` set only
// over a row where it is still null is a property of the statement rather than of this module's
// control flow, and standing in for D1 would only prove the stand-in (CLAUDE.md).
//
// it is driven directly rather than through ./settle.ts or ./collect.ts, the same as
// ./receipt.workers.spec.ts: both of those reach this module and neither may be what makes "one
// notice per family" true.

const CONTACT_ID = '019fb300-0000-7000-8000-000000000020';
const DONATION_ID = '019fb300-0000-7000-8000-000000000021';

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
		`insert into donation (id, contact_id, total_minor, currency, fee_minor, received_at,
		                       created_at, tribute_kind, tribute_honoree, tribute_notify_name,
		                       tribute_notify_email)
		 values (?, ?, 2500, 'USD', 0, 1754222400000, 0, 'memory', 'Chidi Okafor', 'Ngozi Okafor',
		         'ngozi@example.org')`
	)
		.bind(DONATION_ID, CONTACT_ID)
		.run();
});

/** the organisation's details. only the registered name is what this notice cannot be written without. */
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
 * every method refuses, so a notice that reached the processor for anything would fail here rather
 * than pass quietly — which is the claim `SettleDeps` in ./delivery.ts makes about this consumer.
 */
const provider = new Proxy({} as PaymentProvider, {
	get: (_, name) => async () => {
		throw new Error(`the tribute notice path called ${String(name)} on the payment port`);
	}
});

const deps = (email: EmailProvider): SettleDeps => ({ db, provider, email });

const target = (over: Partial<Parameters<typeof sendTributeNotice>[1]> = {}) => ({
	donationId: DONATION_ID,
	donorName: 'Ada Okafor' as string | null,
	tributeKind: 'memory' as string | null,
	tributeHonoree: 'Chidi Okafor' as string | null,
	notifyName: 'Ngozi Okafor' as string | null,
	notifyEmail: 'ngozi@example.org' as string | null,
	...over
});

const stampOf = async () => {
	const [row] = await db.select().from(donation).where(eq(donation.id, DONATION_ID));
	return row?.tributeNotifiedAt ?? null;
};

describe('sendTributeNotice()', () => {
	beforeEach(orgProfile);

	it('writes to the person the donor named and stamps the gift', async () => {
		const mail = mailer();

		const outcome = await sendTributeNotice(deps(mail.port), target());

		expect(outcome).toBe('sent');
		expect(mail.sent.map((m) => m.to)).toEqual(['ngozi@example.org']);
		expect(await stampOf()).not.toBeNull();
	});

	/**
	 * the guard that makes "once per series" hold.
	 *
	 * ./collect.ts writes both notify columns null on every collection after the one that opened the
	 * commitment (../db/schema.ts, `tribute_notified_at`), so a later collection arrives here naming
	 * nobody — and this is the arm that answers it. it costs no query, which is what keeps a monthly
	 * gift from claiming a stamp on every charge for a year.
	 */
	it('sends nothing and claims nothing where nobody was named', async () => {
		const mail = mailer();

		const outcome = await sendTributeNotice(
			deps(mail.port),
			target({ notifyName: null, notifyEmail: null })
		);

		expect(outcome).toBe('nobody_to_tell');
		expect(mail.sent).toHaveLength(0);
		expect(await stampOf()).toBeNull();
	});

	it('sends nothing for a gift already notified, and keeps the stamp it had', async () => {
		const first = mailer();
		await sendTributeNotice(deps(first.port), target());
		const stamped = await stampOf();

		const again = mailer();
		const outcome = await sendTributeNotice(deps(again.port), target());

		// the claim is what refuses it, so a redelivered webhook cannot tell one family twice by
		// reasoning its way to the same gift.
		expect(outcome).toBe('not_sent');
		expect(again.sent).toHaveLength(0);
		expect(await stampOf()).toEqual(stamped);
	});

	it('hands the claim back when the send fails, and can send on the next attempt', async () => {
		const outcome = await sendTributeNotice(deps(mailer(false).port), target());

		// the claim is taken before the mail, so a send that failed has to give it back: a gift left
		// reading "told" over a notice nobody got is a family nothing will ever tell.
		expect(outcome).toBe('not_sent');
		expect(await stampOf()).toBeNull();

		const retry = mailer();
		await sendTributeNotice(deps(retry.port), target());

		expect(retry.sent.map((m) => m.to)).toEqual(['ngozi@example.org']);
		expect(await stampOf()).not.toBeNull();
	});

	it('hands the claim back when the step faults outright', async () => {
		const broken: EmailProvider = {
			async send() {
				throw new Error('the socket went away');
			}
		};

		// the alert goes out over the same transport, so this is also the case where reporting the
		// fault faults. neither may raise: the caller has already committed the gift to the books.
		await expect(sendTributeNotice(deps(broken), target())).resolves.toBe('not_sent');
		expect(await stampOf()).toBeNull();
	});
});

describe('sendTributeNotice() — a deployment that cannot write one yet', () => {
	it('hands the claim back and leaves the family untold', async () => {
		const mail = mailer();

		// no `org_profile` row, so the notice refuses rather than reaching a grieving family from an
		// organisation that cannot name itself (../email/tribute.ts).
		const outcome = await sendTributeNotice(deps(mail.port), target());

		expect(outcome).toBe('not_sent');
		expect(mail.sent.map((m) => m.to)).not.toContain('ngozi@example.org');
		expect(await stampOf()).toBeNull();
	});
});
