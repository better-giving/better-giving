import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readContactSummaries } from '../contacts/queries';
import { beforeNextBatch } from '../db/batch.testing';
import { createDb, type Db } from '../db/client';
import { client, first, openUnmigrated, run, stmt } from '../db/database.testing';
import { receivePledge } from './receive-pledge';

// Mark received below its route (../../../routes/_app.admin.donations._index.pledges.db.spec.ts),
// against a real database: the arms a press through the screen cannot reach on demand.

// the donor read after the commit, made to fail in the one case that needs it.
vi.mock('../contacts/queries', async (actual) => {
	const queries = await actual<typeof import('../contacts/queries')>();
	return { ...queries, readContactSummaries: vi.fn(queries.readContactSummaries) };
});

const MAYA = '019fb600-0000-7000-8000-000000000001';
const JAMES = '019fb600-0000-7000-8000-000000000002';
const FORM_ID = '019fb600-0000-7000-8000-0000000000f1';
const PLEDGE_ID = '019fb600-0000-7000-8000-000000000101';

const ARRIVAL = { pledgeId: PLEDGE_ID, amountMinor: 951_240, dated: new Date('2026-11-18') };

let db: Db;
beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	for (const table of [
		'ledger_entry',
		'entry_group',
		'pledge',
		'payment',
		'line_item',
		'gift_match',
		'donation',
		'supporter_page',
		'supporter',
		'contact',
		'form'
	]) {
		await run(stmt(`delete from ${table}`));
	}
	const account = await first<{ id: string }>(
		stmt(`select id from account where is_postable = 1 and code = '4110'`)
	);
	await run(
		stmt(
			`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
			                   suggested_amounts, allowed_origins, created_at, updated_at)
			 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[2500]', '[]', 0, 0)`,
			FORM_ID,
			account?.id ?? ''
		)
	);
	await run(
		stmt(
			`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
			 values (?, 'individual', 'Maya Okafor', 'maya.okafor@example.org', 0, 0),
			        (?, 'individual', 'James Whitfield', 'j.whitfield@example.com', 0, 0)`,
			MAYA,
			JAMES
		)
	);
	await run(
		stmt(
			`insert into pledge (id, method, contact_id, currency, reference, ticker, shares_millionths,
			                     form_id, created_at)
			 values (?, 'stock', ?, 'USD', 'CFCP-AAPL-7Q2D', 'AAPL', 50000000, ?, 1794000000000)`,
			PLEDGE_ID,
			MAYA,
			FORM_ID
		)
	);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const stamp = async () =>
	(
		await first<{ donation_id: string | null }>(
			stmt('select donation_id from pledge where id = ?', PLEDGE_ID)
		)
	)?.donation_id;

const count = async (table: string) =>
	(await first<{ n: number }>(stmt(`select count(*) as n from ${table}`)))?.n ?? 0;

describe('receivePledge', () => {
	it('records the gift under the pledge’s own id and answers its donor', async () => {
		const result = await receivePledge(db, ARRIVAL);

		expect(result).toEqual({
			ok: true,
			gift: expect.objectContaining({
				donationId: PLEDGE_ID,
				amountMinor: 951_240,
				donorName: 'Maya Okafor',
				donorEmail: 'maya.okafor@example.org',
				pledge: { method: 'stock', shares: '50 shares of AAPL' }
			})
		});
		expect(await stamp()).toBe(PLEDGE_ID);
		expect(await count('donation')).toBe(1);
	});

	it.each([0, -500, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
		'throws on an amount of %s before reading anything',
		async (amountMinor) => {
			// a database with no tables: a read would answer `write_failed` rather than throw.
			const unmigrated = createDb(await openUnmigrated());

			await expect(receivePledge(unmigrated, { ...ARRIVAL, amountMinor })).rejects.toThrow(
				'a received pledge is a positive whole number of minor units'
			);
		}
	);

	it('answers not_found for an id no pledge has', async () => {
		const result = await receivePledge(db, {
			...ARRIVAL,
			pledgeId: '019fb600-0000-7000-8000-00000000dead'
		});

		expect(result).toEqual({ ok: false, reason: 'not_found' });
		expect(await count('donation')).toBe(0);
	});

	it('answers write_failed and logs where the pledge cannot be read', async () => {
		const unmigrated = createDb(await openUnmigrated());
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(await receivePledge(unmigrated, ARRIVAL)).toEqual({ ok: false, reason: 'write_failed' });
		expect(logged).toHaveBeenCalledWith('recording a received pledge failed:', expect.anything());
	});

	it('answers already_received where an earlier press’s batch lands between the read and its own', async () => {
		// the second press reads the pledge unreceived, then the first commits before the second's
		// batch runs: only the `donation` primary key stands between them.
		let earlier: Awaited<ReturnType<typeof receivePledge>> | undefined;
		beforeNextBatch(db, async () => {
			earlier = await receivePledge(db, { ...ARRIVAL, amountMinor: 1_000_000 });
		});

		const later = await receivePledge(db, ARRIVAL);

		expect(earlier).toMatchObject({ ok: true });
		expect(later).toEqual({
			ok: false,
			reason: 'already_received',
			gift: expect.objectContaining({ amountMinor: 1_000_000 })
		});
		expect(await count('payment')).toBe(1);
		expect(await first(stmt('select total_minor from donation'))).toEqual({
			total_minor: 1_000_000
		});
	});

	// a row `savePledge` refuses to save beside (./quote-pledge.db.spec.ts), written by hand here to
	// make the batch fail on a refusal the pledge's stamp does not answer.
	it('answers write_failed, stamping nothing, where the batch is refused for another cause', async () => {
		await run(
			stmt(
				`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
				 values (?, ?, 10000, 'USD', 0, 0)`,
				PLEDGE_ID,
				JAMES
			)
		);
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(await receivePledge(db, ARRIVAL)).toEqual({ ok: false, reason: 'write_failed' });
		expect(await stamp()).toBeNull();
		expect(await count('payment')).toBe(0);
		expect(logged).toHaveBeenCalledWith('recording a received pledge failed:', expect.anything());
	});

	describe('on a fundraiser’s form', () => {
		const PAGE_ID = '019fb600-0000-7000-8000-0000000000a1';

		const givenPage = async (endedAt: number | null, hiddenAt: number | null) => {
			await run(
				stmt(
					`insert into supporter (id, email, name, created_at)
					 values ('019fb600-0000-7000-8000-0000000000b1', 'ada@example.org', 'Ada Rivera', 0)`
				)
			);
			await run(
				stmt(
					`insert into supporter_page (id, supporter_id, slug, title, story, goal_minor, currency,
					                            form_id, status, published_at, ended_at, hidden_at,
					                            created_at, updated_at)
					 values (?, '019fb600-0000-7000-8000-0000000000b1', 'run-for-the-pantry',
					         'Run for the pantry', 'I am running.', 50000, 'USD', ?, ?, 0, ?, ?, 0, 0)`,
					PAGE_ID,
					FORM_ID,
					endedAt === null ? 'live' : 'ended',
					endedAt,
					hiddenAt
				)
			);
			await run(stmt('update pledge set supporter_page_id = ? where id = ?', PAGE_ID, PLEDGE_ID));
		};

		const givenOn = async () =>
			(
				await first<{ supporter_page_id: string | null }>(
					stmt('select supporter_page_id from donation where id = ?', PLEDGE_ID)
				)
			)?.supporter_page_id;

		it('counts the gift to the page where the page counts gifts on the day it arrived', async () => {
			await givenPage(null, null);

			expect(await receivePledge(db, ARRIVAL)).toMatchObject({ ok: true });
			expect(await givenOn()).toBe(PAGE_ID);
		});

		it.each([
			['ended', ARRIVAL.dated.getTime() - 1, null],
			['hidden', null, ARRIVAL.dated.getTime()]
		])(
			'gives the gift no page where the page was %s by the day it arrived',
			async (_, endedAt, hiddenAt) => {
				await givenPage(endedAt, hiddenAt);

				expect(await receivePledge(db, ARRIVAL)).toMatchObject({ ok: true });
				expect(await givenOn()).toBeNull();
				expect(await stamp()).toBe(PLEDGE_ID);
			}
		);
	});

	it('answers write_failed over the committed gift where the donor cannot be read after the commit, and the gift as recorded on the press again', async () => {
		vi.mocked(readContactSummaries).mockRejectedValueOnce(new Error('SQLITE_BUSY'));
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(await receivePledge(db, ARRIVAL)).toEqual({ ok: false, reason: 'write_failed' });
		expect(await stamp()).toBe(PLEDGE_ID);
		expect(logged).toHaveBeenCalledWith('recording a received pledge failed:', expect.any(Error));

		expect(await receivePledge(db, { ...ARRIVAL, amountMinor: 1_000_000 })).toEqual({
			ok: false,
			reason: 'already_received',
			gift: expect.objectContaining({
				donationId: PLEDGE_ID,
				amountMinor: 951_240,
				dated: ARRIVAL.dated,
				donorEmail: 'maya.okafor@example.org'
			})
		});
	});
});
