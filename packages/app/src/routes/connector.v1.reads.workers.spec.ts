import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { CONNECTOR_ACTIONS } from '$lib/server/connector/surface';
import { page } from '$lib/server/db/schema';
import { createCampaign } from '$lib/server/pages/campaign';
import { gift, refund, repeatingGift } from '$lib/server/pages/settled-gifts.testing';
import { connectorHarness, under } from '../connector-routes.testing';
import * as donations from './connector.v1.donations';
import * as donor from './connector.v1.donors.$id';
import * as donors from './connector.v1.donors._index';
import * as hello from './connector.v1.hello';
import * as recurring from './connector.v1.recurring';
import * as results from './connector.v1.results';

// the reads of `/connector/v1` over gifts, donors and recurring gifts: what the dashboard's home,
// its gifts list and its donor file state, in the connector's terms. every gift reaches the books
// through $lib/server/pages/settled-gifts.testing.ts — settled 2026-09-10, refunded 2026-09-20 —
// so what is summed is what the production writers post.

// registered ahead of the harness's own, which empties `form` and `page`: a gift names its form.
beforeEach(async () => {
	for (const table of [
		'dispute',
		'zapier_delivery',
		'quickbooks_sync',
		'ledger_entry',
		'entry_group',
		'payment',
		'line_item',
		'donation',
		'recurring_plan',
		'contact'
	])
		await env.DB.prepare(`delete from ${table}`).run();
});

const h = connectorHarness(() => ({
	hello: under('hello', hello),
	results: under('results', results),
	donations: under('donations', donations),
	donors: under('donors', donors),
	donor: under('donors/:id', donor),
	recurring: under('recurring', recurring)
}));
const { call, connect } = h;

const usd = (amount: string) => ({ amount, currency: 'USD' });

/** a new campaign's id, and the settings row its gifts are made through. */
async function campaign(name: string): Promise<{ id: string; formId: string }> {
	const { pageId } = await createCampaign(h.db, { name });
	const [row] = await h.db.select({ formId: page.formId }).from(page).where(eq(page.id, pageId));
	if (!row?.formId) throw new Error('a new campaign owns a form');
	return { id: pageId, formId: row.formId };
}

describe('hello', () => {
	it('lists the reads and the hand-recorded gift among the actions', async () => {
		const response = await call('hello', '/hello');

		const { actions } = (await response.json()) as { actions: string[] };
		expect(actions).toEqual([...CONNECTOR_ACTIONS]);
		expect(actions).toEqual(
			expect.arrayContaining([
				'results.summary',
				'donations.list',
				'donations.record',
				'donors.list',
				'donors.get',
				'recurring.list'
			])
		);
	});
});

describe('results.summary', () => {
	it('totals settled gifts net of refunds, per campaign, over a window of days', async () => {
		const key = await connect();
		const coats = await campaign('Winter coats');
		const books = await campaign('Library books');
		await gift(h.db, coats.formId, 10_000);
		const refunded = await gift(h.db, coats.formId, 5_000);
		await refund(h.db, refunded, 2_000);
		await gift(h.db, books.formId, 2_500);
		await gift(h.db, books.formId, 9_900, false);

		const all = await call('results', '/results', { key });
		expect(all.status).toBe(200);
		expect(await all.json()).toEqual({
			total: usd('155.00'),
			gift_count: 3,
			donor_count: 1,
			campaigns: expect.arrayContaining([
				{ id: coats.id, title: 'Winter coats', total: usd('130.00'), gift_count: 2, goal: null },
				{ id: books.id, title: 'Library books', total: usd('25.00'), gift_count: 1, goal: null }
			])
		});

		// the refund is dated the 20th, so a window closing on the 15th has not seen it.
		const before = await call('results', '/results?from=2026-09-01&to=2026-09-15', { key });
		expect(await before.json()).toMatchObject({ total: usd('175.00'), gift_count: 3 });
		const after = await call('results', '/results?from=2026-09-16&to=2026-09-30', { key });
		expect(await after.json()).toMatchObject({ total: usd('-20.00'), gift_count: 0 });
	});

	it('narrows every figure to one campaign', async () => {
		const key = await connect();
		const coats = await campaign('Winter coats');
		const books = await campaign('Library books');
		await gift(h.db, coats.formId, 10_000);
		await gift(h.db, books.formId, 2_500);

		const response = await call('results', `/results?campaign_id=${coats.id}`, { key });

		expect(await response.json()).toEqual({
			total: usd('100.00'),
			gift_count: 1,
			donor_count: 1,
			campaigns: [
				{ id: coats.id, title: 'Winter coats', total: usd('100.00'), gift_count: 1, goal: null }
			]
		});
	});

	it('refuses a campaign that is not there, a day that is not one, and an unknown filter', async () => {
		const key = await connect();

		const missing = await call('results', '/results?campaign_id=pg_missing', { key });
		expect(missing.status).toBe(404);
		expect(await missing.json()).toMatchObject({ code: 'not_found' });

		const badDay = await call('results', '/results?from=2026-02-30&to=sept', { key });
		expect(badDay.status).toBe(422);
		expect(await badDay.json()).toMatchObject({
			code: 'invalid',
			errors: [
				{ path: 'from', message: expect.any(String) },
				{ path: 'to', message: expect.any(String) }
			]
		});

		const backwards = await call('results', '/results?from=2026-09-30&to=2026-09-01', { key });
		expect(backwards.status).toBe(422);

		const stray = await call('results', '/results?campaign=x', { key });
		expect(stray.status).toBe(422);
		expect(await stray.json()).toMatchObject({ errors: [{ path: 'campaign' }] });
	});
});

type Listed = { data: Record<string, unknown>[]; next_cursor: string | null };

const amounts = (list: Listed) => list.data.map((gift) => gift.amount);

describe('donations.list', () => {
	it('lists settled gifts newest first in the read API’s rendering, a page at a time', async () => {
		const key = await connect();
		const coats = await campaign('Winter coats');
		const books = await campaign('Library books');
		await gift(h.db, coats.formId, 10_000);
		await gift(h.db, coats.formId, 5_000);
		await gift(h.db, books.formId, 2_500);
		await gift(h.db, books.formId, 9_900, false);

		const first = await call('donations', '/donations?limit=2', { key });
		expect(first.status).toBe(200);
		const one = (await first.json()) as Listed;
		expect(amounts(one)).toEqual(['25.00', '50.00']);
		expect(one.data[0]).toMatchObject({
			amount_minor: 2_500,
			currency: 'USD',
			status: 'settled',
			donor_name: 'Ada Okafor',
			form_id: books.formId,
			campaign_id: books.id
		});
		const second = await call('donations', `/donations?limit=2&cursor=${one.next_cursor}`, {
			key
		});
		const two = (await second.json()) as Listed;
		expect(amounts(two)).toEqual(['100.00']);
		expect(two.next_cursor).toBeNull();
	});

	it('narrows to one campaign and a window of days', async () => {
		const key = await connect();
		const coats = await campaign('Winter coats');
		const books = await campaign('Library books');
		await gift(h.db, coats.formId, 10_000);
		await gift(h.db, books.formId, 2_500);

		const onlyCoats = await call('donations', `/donations?campaign_id=${coats.id}`, { key });
		expect(amounts((await onlyCoats.json()) as Listed)).toEqual(['100.00']);
		const early = await call('donations', '/donations?to=2026-09-09', { key });
		expect(await early.json()).toEqual({ data: [], next_cursor: null });
		const onTheDay = await call('donations', '/donations?from=2026-09-10&to=2026-09-10', { key });
		expect(amounts((await onTheDay.json()) as Listed)).toEqual(['25.00', '100.00']);
	});

	it('refuses a cursor it did not issue and a campaign that is not there', async () => {
		const key = await connect();

		const cursor = await call('donations', '/donations?cursor=nonsense', { key });
		expect(cursor.status).toBe(422);
		expect(await cursor.json()).toMatchObject({ errors: [{ path: 'cursor' }] });
		const missing = await call('donations', '/donations?campaign_id=pg_missing', { key });
		expect(missing.status).toBe(404);
	});
});

/** a donor typed into the file by hand, with nothing given; their id. */
async function typedDonor(name: string, email: string): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
		 values (?, 'individual', ?, ?, 0, 0)`
	)
		.bind(id, name, email)
		.run();
	return id;
}

describe('donors.list', () => {
	it('lists the donor file with what each has given, net of refunds', async () => {
		const key = await connect();
		const coats = await campaign('Winter coats');
		const refunded = await gift(h.db, coats.formId, 10_000);
		await refund(h.db, refunded, 4_000);
		await typedDonor('Grace Hopper', 'grace@example.org');

		const response = await call('donors', '/donors', { key });
		expect(response.status).toBe(200);
		const listed = (await response.json()) as Listed;
		expect(listed.next_cursor).toBeNull();
		expect(listed.data).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'Ada Okafor',
					email: 'ada@example.org',
					gift_count: 1,
					total_given: usd('60.00')
				}),
				expect.objectContaining({
					name: 'Grace Hopper',
					gift_count: 0,
					total_given: usd('0.00')
				})
			])
		);
	});

	it('matches q against name or email as the dashboard’s donor search does, a page at a time', async () => {
		const key = await connect();
		await typedDonor('Grace Hopper', 'grace@example.org');
		await typedDonor('Alan Turing', 'alan@bletchley.example');
		await typedDonor('Ada Lovelace', 'countess@GRACE.example');

		const byName = await call('donors', '/donors?q=grace&limit=1', { key });
		const first = (await byName.json()) as Listed;
		expect(first.data).toHaveLength(1);
		const rest = await call('donors', `/donors?q=grace&limit=1&cursor=${first.next_cursor}`, {
			key
		});
		const second = (await rest.json()) as Listed;
		expect([...first.data, ...second.data].map((d) => d.name).sort()).toEqual([
			'Ada Lovelace',
			'Grace Hopper'
		]);
		expect(second.next_cursor).toBeNull();
	});
});

describe('donors.get', () => {
	it('answers a donor with their gifts, newest first', async () => {
		const key = await connect();
		const coats = await campaign('Winter coats');
		await gift(h.db, coats.formId, 10_000);
		await gift(h.db, coats.formId, 2_500);
		const listed = (await (await call('donors', '/donors', { key })).json()) as Listed;
		const id = listed.data[0]?.id as string;

		const response = await call('donor', `/donors/${id}`, { key });

		expect(response.status).toBe(200);
		const read = (await response.json()) as Record<string, unknown> & { gifts: Listed };
		expect(read).toMatchObject({
			id,
			name: 'Ada Okafor',
			gift_count: 2,
			total_given: usd('125.00')
		});
		expect(amounts(read.gifts)).toEqual(['25.00', '100.00']);
		expect(read.gifts.data[0]).toMatchObject({ donor_id: id, campaign_id: coats.id });
		expect(read.gifts.next_cursor).toBeNull();
	});

	it('answers an id no donor has with not_found', async () => {
		const key = await connect();

		const response = await call('donor', `/donors/${crypto.randomUUID()}`, { key });

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ code: 'not_found' });
	});
});

describe('recurring.list', () => {
	it('lists each recurring gift in the read API’s rendering', async () => {
		const key = await connect();
		const coats = await campaign('Winter coats');
		await repeatingGift(h.db, coats.formId, 2_500, 2);

		const response = await call('recurring', '/recurring', { key });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			data: [
				{
					id: expect.any(String),
					donor_id: expect.any(String),
					amount: '25.00',
					amount_minor: 2_500,
					currency: 'USD',
					frequency: 'monthly',
					status: 'active',
					next_charge_at: expect.any(String),
					started_at: expect.any(String),
					updated_at: expect.any(String)
				}
			],
			next_cursor: null
		});
	});

	it('takes no write', async () => {
		const key = await connect();

		const response = await call('recurring', '/recurring', { method: 'POST', key, body: {} });

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ code: 'unknown_action' });
	});
});
