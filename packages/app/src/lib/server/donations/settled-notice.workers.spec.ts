import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import type { EmailMessage, EmailProvider } from '../email/provider';
import type { PaymentProvider } from '../payments/provider';
import type { SettleDeps } from './delivery';
import { sendSettledNotice, type SettledGift } from './settled-notice';

// the organisation's own news that a gift settled, against a real D1: `alert` reads `org_profile`
// for the address to send to, so there is a database in the path and the pool follows from that
// (CONTRIBUTING.md).
//
// what is asserted is the text of the message rather than the call, because the two facts under
// test are words an operator reads in their inbox — the donor's own note and the donor's
// dedication, worded the way the receipt words it.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.prepare('delete from org_profile').run();
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

/** the payment port, which this module never calls. */
const provider = new Proxy({} as PaymentProvider, {
	get: (_, name) => async () => {
		throw new Error(`the settled notice path called ${String(name)} on the payment port`);
	}
});

const deps = (email: EmailProvider): SettleDeps => ({ db, provider, email });

const gift = (over: Partial<SettledGift> = {}): SettledGift => ({
	amountMinor: 2500,
	currency: 'USD',
	donorName: 'Ada Okafor',
	donorEmail: 'ada@example.org',
	formName: 'General giving',
	repeating: 'none',
	receipt: 'sent',
	note: null,
	tribute: null,
	...over
});

/** the one message this sends, as plain text — which is the arm an operator's client may show. */
async function noticeFor(over: Partial<SettledGift> = {}): Promise<string> {
	const mail = mailer();
	await sendSettledNotice(deps(mail.port), gift(over));
	const [message] = mail.sent;
	if (message === undefined) throw new Error('no notice was sent');
	return message.text;
}

describe('sendSettledNotice()', () => {
	it('carries the donor’s dedication, worded the way the receipt words it', async () => {
		const text = await noticeFor({ tribute: { kind: 'memory', honoree: 'Chidi Okafor' } });

		expect(text).toContain('In memory of Chidi Okafor');
	});

	it('carries the donor’s own note', async () => {
		const text = await noticeFor({ note: 'For the new roof, with thanks.' });

		expect(text).toContain('For the new roof, with thanks.');
	});

	it('says neither where the gift carries neither', async () => {
		const text = await noticeFor();

		expect(text).not.toContain('Dedication');
		expect(text).not.toContain('Note');
	});
});
