import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import type { PledgeMethod } from '../db/schema';
import type { EmailProvider } from '../email/provider';
import { receivedPledge } from '../pages/settled-gifts.testing';
import { connectQuickbooks, saveQuickbooksAccounts } from './connection';
import { sendDueEntries } from './deliver';
import { createAccountingProvider } from './factory';
import { QUICKBOOKS_SANDBOX_URL } from './quickbooks';
import { all, client, run, stmt } from '$lib/server/db/database.testing';

// a stock or IRA (QCD) pledge marked received, sent to QuickBooks, against a real database.
//
// the gift is written by `receivePledge` in ../donations/receive-pledge.ts, the path Mark received
// takes, so its queue row is the one that batch commits. what is sent is read through the delivery
// and the QuickBooks adapter together, with Intuit faked at `fetch`. nothing in ./record.ts or
// ./quickbooks.ts reads a payment's method: a received pledge's entry debits 1010 Bank / Cash as a
// cheque's does, so it goes over the way a gift in hand does, into the company's Undeposited Funds.
//
// ../../../../vitest.config.ts sets `unstubGlobals`, so the stubbed `fetch` is taken back before the
// next case.

const FORM_ID = 'frm_pledgetobooks0001';
const CONFIGURED = {
	QUICKBOOKS_CLIENT_ID: 'notarealclientid',
	QUICKBOOKS_CLIENT_SECRET: 'notarealclientsecret',
	QUICKBOOKS_API_URL: QUICKBOOKS_SANDBOX_URL
};
const INCOME = '79';
const FEES = '80';
const UNDEPOSITED = '4';
const DONOR = '77';

let db: Db;

beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	for (const table of [
		'zapier_delivery',
		'quickbooks_sync',
		'quickbooks_connection',
		'ledger_entry',
		'entry_group',
		'payment',
		'line_item',
		'gift_match',
		'pledge',
		'donation',
		'contact',
		'form',
		'org_profile'
	]) {
		await run(stmt(`delete from ${table}`));
	}
	await run(
		stmt(
			`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins, created_at, updated_at)
		 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`,
			FORM_ID,
			postableId('donationsDeductible')
		)
	);
	await run(
		stmt(`insert into org_profile (id, legal_name, tax_id, deductibility_statement, address_line1,
		                          city, country, notification_email, created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789', 'No goods or services were provided.',
		         '1 Main St', 'Springfield', 'US', 'ops@hope.example', 0, 0)`)
	);
	await connectQuickbooks(db, {
		realmId: '4620816365',
		tokens: {
			accessToken: 'access-one',
			accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
			refreshToken: 'refresh-one',
			refreshTokenExpiresAt: new Date(Date.now() + 8_640_000_000)
		},
		startAt: new Date('2026-01-01T00:00:00.000Z')
	});
});

const quietMail: EmailProvider = { send: async () => ({ ok: true }) };

/** the operator's picks, Undeposited Funds among them unless `undeposited` is null. */
async function picked(undeposited: string | null = UNDEPOSITED): Promise<void> {
	await saveQuickbooksAccounts(db, {
		income: { id: INCOME, name: 'Contributions' },
		fee: { id: FEES, name: 'Processing fees' },
		stripeBalance: null,
		paypalBalance: null,
		chariotBalance: null,
		nowpaymentsBalance: null,
		undepositedFunds: undeposited === null ? null : { id: undeposited, name: 'Undeposited Funds' }
	});
}

/** a company that knows the donor as 77 and takes every journal entry posted to it. */
function intuit(): Record<string, unknown>[] {
	const posted: Record<string, unknown>[] = [];
	vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		const url = new URL(request.url);
		const body = await request.text();
		if (url.pathname.endsWith('/query')) {
			if (body.startsWith('select * from Preferences')) {
				return Response.json({
					QueryResponse: { Preferences: [{ CurrencyPrefs: { HomeCurrency: { value: 'USD' } } }] }
				});
			}
			if (body.startsWith('select * from Customer')) {
				return Response.json({ QueryResponse: { Customer: [{ Id: DONOR }] } });
			}
			return Response.json({ QueryResponse: {} });
		}
		if (url.pathname.endsWith('/journalentry')) {
			posted.push(JSON.parse(body));
			return Response.json({ JournalEntry: { Id: String(1200 + posted.length) } });
		}
		throw new Error(`unscripted request: ${request.method} ${url}`);
	});
	return posted;
}

/** one delivery run, a minute from now so every row queued so far is due. */
async function runDelivery(): Promise<void> {
	await sendDueEntries(
		{ db, provider: createAccountingProvider(CONFIGURED, db), email: quietMail, origin: null },
		new Date(Date.now() + 60_000)
	);
}

/** a posted entry's lines as account, side, amount and customer. */
function sides(entry: Record<string, unknown> | undefined) {
	const lines = (entry?.Line ?? []) as {
		Amount: number;
		JournalEntryLineDetail: {
			PostingType: string;
			AccountRef: { value: string };
			Entity?: { EntityRef: { value: string } };
		};
	}[];
	return lines.map(({ Amount, JournalEntryLineDetail: detail }) => [
		detail.AccountRef.value,
		detail.PostingType,
		Amount,
		detail.Entity?.EntityRef.value ?? null
	]);
}

async function queueRows() {
	return all<{ status: string; remote_id: string | null; last_error: string | null }>(
		stmt('select status, remote_id, last_error from quickbooks_sync')
	);
}

describe('a received pledge', () => {
	it.each<[PledgeMethod, number, number]>([
		['stock', 951_240, 9_512.4],
		['ira_qcd', 480_000, 4_800]
	])(
		'on %s goes over as a gift from Undeposited Funds into income, with no fee line',
		async (method, amountMinor, amount) => {
			await picked();
			await receivedPledge(db, FORM_ID, method, amountMinor);
			const posted = intuit();

			await runDelivery();

			expect(posted.map((entry) => entry.TxnDate)).toEqual(['2026-09-10']);
			expect(sides(posted[0])).toEqual([
				[UNDEPOSITED, 'Debit', amount, DONOR],
				[INCOME, 'Credit', amount, DONOR]
			]);
			expect(await queueRows()).toEqual([{ status: 'sent', remote_id: '1201', last_error: null }]);
		}
	);

	it('waits while Undeposited Funds is unpicked, and goes over once it is picked', async () => {
		await picked(null);
		await receivedPledge(db, FORM_ID, 'stock', 951_240);
		const posted = intuit();

		await runDelivery();

		expect(posted).toEqual([]);
		expect(await queueRows()).toEqual([
			{
				status: 'pending',
				remote_id: null,
				last_error: expect.stringContaining('Undeposited Funds')
			}
		]);

		await picked();
		await run(stmt('update quickbooks_sync set updated_at = 0'));
		await runDelivery();

		expect(sides(posted[0])).toEqual([
			[UNDEPOSITED, 'Debit', 9_512.4, DONOR],
			[INCOME, 'Credit', 9_512.4, DONOR]
		]);
		expect(await queueRows()).toEqual([{ status: 'sent', remote_id: '1201', last_error: null }]);
	});
});
