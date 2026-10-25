import { beforeEach, describe, expect, it } from 'vitest';
import { connectorHarness, under } from '../connector-routes.testing';
import * as splat from './connector.v1.$';
import * as donations from './connector.v1.donations';
import * as donor from './connector.v1.donors.$id';
import * as donors from './connector.v1.donors._index';
import * as results from './connector.v1.results';
import { first, run, stmt } from '$lib/server/db/database.testing';

// `donations.record`: a gift that arrived in hand, recorded from the chat through the writer the
// dashboard's Add a donation drives, and nothing else on this surface writes money — no refund, no
// change to a recurring gift.

// registered ahead of the harness's own, which empties `form`: a gift may name one.
beforeEach(async () => {
	for (const table of [
		'zapier_delivery',
		'quickbooks_sync',
		'ledger_entry',
		'entry_group',
		'payment',
		'line_item',
		'donation',
		'contact'
	])
		await run(stmt(`delete from ${table}`));
});

const h = connectorHarness(() => ({
	donations: under('donations', donations),
	donor: under('donors/:id', donor),
	donors: under('donors', donors),
	results: under('results', results),
	unserved: under('*', splat)
}));
const { call, connect } = h;

const usd = (amount: string) => ({ amount, currency: 'USD' });

const CHEQUE = {
	amount: usd('250.00'),
	date: '2026-09-03',
	donor: { name: 'Ada Okafor', email: 'ada@example.org' },
	method: 'check',
	note: 'envelope at the spring fair'
};

/** `body` posted to `donations.record`, under `idempotencyKey` where one is given. */
const record = (key: string, body: unknown, idempotencyKey?: string): Promise<Response> =>
	call('donations', '/donations', {
		method: 'POST',
		key,
		body,
		...(idempotencyKey === undefined ? {} : { headers: { 'idempotency-key': idempotencyKey } })
	});

const count = async (table: string) =>
	(await first<{ n: number }>(stmt(`select count(*) as n from ${table}`)))?.n ?? 0;

describe('donations.record', () => {
	it('records a gift in hand, which donations.list and results.summary then count', async () => {
		const key = await connect();

		const response = await record(key, CHEQUE);

		expect(response.status).toBe(201);
		const recorded = (await response.json()) as Record<string, unknown>;
		expect(recorded).toMatchObject({
			amount: '250.00',
			amount_minor: 25_000,
			currency: 'USD',
			method: 'check',
			status: 'settled',
			occurred_at: '2026-09-03T00:00:00.000Z',
			donor_name: 'Ada Okafor',
			donor_email: 'ada@example.org',
			form_id: null,
			campaign_id: null,
			note: 'envelope at the spring fair'
		});
		const listed = await call('donations', '/donations', { key });
		expect(await listed.json()).toEqual({ data: [recorded], next_cursor: null });
		const donorId = recorded.donor_id;
		const file = await call('donor', `/donors/${String(donorId)}`, { key });
		expect(await file.json()).toMatchObject({
			gifts: { data: [expect.objectContaining({ note: 'envelope at the spring fair' })] }
		});
		const summary = await call('results', '/results?from=2026-09-01&to=2026-09-30', { key });
		expect(await summary.json()).toMatchObject({
			total: usd('250.00'),
			gift_count: 1,
			donor_count: 1
		});
	});

	it('files the gift under the donor on file with that email, and a name alone under a new one', async () => {
		const key = await connect();
		const first = (await (await record(key, CHEQUE)).json()) as { donor_id: string };

		const again = await record(key, {
			...CHEQUE,
			amount: '40',
			donor: { name: 'A. Okafor', email: 'ADA@example.org' }
		});
		const nameOnly = await record(key, {
			...CHEQUE,
			amount: '10.00',
			method: 'cash',
			donor: { name: 'Grace Hopper' }
		});

		expect(again.status).toBe(201);
		expect(await again.json()).toMatchObject({ donor_id: first.donor_id, amount: '40.00' });
		expect(await nameOnly.json()).toMatchObject({
			donor_name: 'Grace Hopper',
			donor_email: null,
			method: 'cash'
		});
		const listed = (await (await call('donors', '/donors', { key })).json()) as {
			data: { name: string; gift_count: number }[];
		};
		expect(listed.data.map((d) => [d.name, d.gift_count]).sort()).toEqual([
			['Ada Okafor', 2],
			['Grace Hopper', 1]
		]);
	});

	it('refuses a bad amount, date, method and donor name at their paths, writing nothing', async () => {
		const key = await connect();

		const response = await record(key, {
			amount: '0',
			date: '2026-02-30',
			donor: { name: ' ', email: 'not an address' },
			method: 'bank_transfer'
		});

		expect(response.status).toBe(422);
		const problem = (await response.json()) as {
			code: string;
			errors: { path: string; message: string }[];
		};
		expect(problem.code).toBe('invalid');
		expect(problem.errors.map((e) => e.path).sort()).toEqual([
			'amount',
			'date',
			'donor.email',
			'donor.name',
			'method'
		]);
		expect(problem.errors.find((e) => e.path === 'method')?.message).toMatch(/cash.*check/);
		expect(await count('donation')).toBe(0);
		expect(await count('entry_group')).toBe(0);
	});

	it('refuses a campaign, an unknown key and another currency, writing nothing', async () => {
		const key = await connect();

		const response = await record(key, {
			...CHEQUE,
			amount: { amount: '25.00', currency: 'EUR' },
			campaign_id: 'pg_anything',
			receipt: true
		});

		expect(response.status).toBe(422);
		const problem = (await response.json()) as { errors: { path: string; message: string }[] };
		expect(problem.errors.map((e) => e.path).sort()).toEqual([
			'amount.currency',
			'campaign_id',
			'receipt'
		]);
		expect(problem.errors.find((e) => e.path === 'campaign_id')?.message).toMatch(/campaign/);
		expect(await count('donation')).toBe(0);
	});

	it('records one gift for two posts under one Idempotency-Key, answering the second 200', async () => {
		const key = await connect();

		const first = await record(key, CHEQUE, 'chat-turn-41');
		const second = await record(key, CHEQUE, 'chat-turn-41');

		expect(first.status).toBe(201);
		expect(second.status).toBe(200);
		expect(await second.json()).toEqual(await first.json());
		expect(await count('donation')).toBe(1);
		expect(await count('payment')).toBe(1);
	});

	it('refuses a different note under an Idempotency-Key already spent', async () => {
		const key = await connect();
		await record(key, CHEQUE, 'chat-turn-41');

		const changed = await record(key, { ...CHEQUE, note: 'a different envelope' }, 'chat-turn-41');

		expect(changed.status).toBe(409);
		expect(await changed.json()).toMatchObject({ code: 'idempotency_conflict' });
		expect(await count('donation')).toBe(1);
	});

	it('refuses a different gift under an Idempotency-Key already spent', async () => {
		const key = await connect();
		await record(key, CHEQUE, 'chat-turn-41');

		const changed = await record(key, { ...CHEQUE, amount: '25.00' }, 'chat-turn-41');

		expect(changed.status).toBe(409);
		expect(await changed.json()).toMatchObject({ code: 'idempotency_conflict' });
		expect(await count('donation')).toBe(1);
	});

	it('records two gifts for two posts without a key, and under two keys', async () => {
		const key = await connect();

		await record(key, CHEQUE);
		await record(key, CHEQUE);
		await record(key, CHEQUE, 'one');
		await record(key, CHEQUE, 'two');

		expect(await count('donation')).toBe(4);
	});

	it('serves no refund', async () => {
		const key = await connect();
		const recorded = (await (await record(key, CHEQUE)).json()) as { id: string };

		const response = await call('unserved', `/donations/${recorded.id}/refund`, {
			method: 'POST',
			key,
			body: {}
		});

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ code: 'unknown_action' });
	});
});
