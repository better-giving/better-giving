import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { all, client, first, run, stmt } from '../db/database.testing';
import { sqliteResultCode } from '../db/rejection';
import { receivePledge } from './receive-pledge';

// the `pledge` statement docs/privacy.md -> Erasure gives a deployer, run as its text against the
// migrated schema: every check on `pledge` accepts it, and a pledge marked received after it gives
// its gift nothing it cleared. the doc is the one source; this spec reads the statement out of it.

const PRIVACY = resolve(import.meta.dirname, '../../../../../../docs/privacy.md');
/** the stand-in the doc's statement names the donor by. */
const PLACEHOLDER = "'CONTACT_ID'";

function documentedStatement(): string {
	const blocks = [...readFileSync(PRIVACY, 'utf8').matchAll(/```sql\n([\s\S]*?)```/g)]
		.map(([, body]) => body ?? '')
		.filter((body) => /\bUPDATE\s+pledge\b/i.test(body));
	expect(blocks).toHaveLength(1);
	const [statement = ''] = blocks;
	expect(statement.split(PLACEHOLDER)).toHaveLength(2);
	return statement.replace(PLACEHOLDER, '?');
}

const MAYA = '019fb700-0000-7000-8000-000000000001';
const JAMES = '019fb700-0000-7000-8000-000000000002';
const FORM_ID = '019fb700-0000-7000-8000-0000000000f1';
/** Maya's: a stock pledge with a named public note and a dedication with someone to tell. */
const NAMED = '019fb700-0000-7000-8000-000000000101';
/** Maya's: an IRA pledge with an anonymous public note and a dedication. */
const ANONYMOUS = '019fb700-0000-7000-8000-000000000102';
/** James's: the same words, and not his to erase. */
const OTHER = '019fb700-0000-7000-8000-000000000103';

const PERSONAL = [
	'note',
	'note_public',
	'note_anonymous',
	'note_shown_name',
	'tribute_kind',
	'tribute_honoree',
	'tribute_notify_name',
	'tribute_notify_email'
] as const;

const CLEARED = {
	note: null,
	note_public: 0,
	note_anonymous: 0,
	note_shown_name: null,
	tribute_kind: null,
	tribute_honoree: null,
	tribute_notify_name: null,
	tribute_notify_email: null
};

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
			                     custodian, amount_minor, form_id, note, note_public, note_anonymous,
			                     note_shown_name, tribute_kind, tribute_honoree, tribute_notify_name,
			                     tribute_notify_email, created_at)
			 values (?, 'stock', ?, 'USD', 'CFCP-AAPL-7Q2D', 'AAPL', 50000000, null, null, ?,
			         'For my mother', 1, 0, 'Maya O.', 'memory', 'Ada Okafor', 'Ben Okafor',
			         'ben.okafor@example.org', 1794000000000),
			        (?, 'ira_qcd', ?, 'USD', 'CFCP-IRA-3K9P', null, null, 'Fidelity', 500000, ?,
			         'From the IRA', 1, 1, 'Anonymous', 'honor', 'Grace Lin', null, null,
			         1794000000000),
			        (?, 'stock', ?, 'USD', 'CFCP-MSFT-8H4T', 'MSFT', 10000000, null, null, ?,
			         'For my mother', 1, 0, 'James W.', 'memory', 'Ada Okafor', 'Ben Okafor',
			         'ben.okafor@example.org', 1794000000000)`,
			NAMED,
			MAYA,
			FORM_ID,
			ANONYMOUS,
			MAYA,
			FORM_ID,
			OTHER,
			JAMES,
			FORM_ID
		)
	);
});

const giftOf = (id: string) =>
	first<Record<(typeof PERSONAL)[number], unknown>>(
		stmt(`select ${PERSONAL.join(', ')} from donation where id = ?`, id)
	);

const arrival = (pledgeId: string) => ({
	pledgeId,
	amountMinor: 951_240,
	dated: new Date('2026-11-18')
});

describe('erasing a donor’s pledges', () => {
	it('is owed: Mark received copies what the donor typed onto the gift', async () => {
		expect(await receivePledge(db, arrival(NAMED))).toMatchObject({ ok: true });

		expect(await giftOf(NAMED)).toMatchObject({
			note: 'For my mother',
			note_shown_name: 'Maya O.',
			tribute_honoree: 'Ada Okafor',
			tribute_notify_email: 'ben.okafor@example.org'
		});
	});

	it('runs as docs/privacy.md gives it, clearing only that donor’s, and Mark received after copies none of it', async () => {
		await run(stmt(documentedStatement(), MAYA));

		const rows = await all<Record<string, unknown>>(
			stmt(`select id, ${PERSONAL.join(', ')} from pledge order by id`)
		);
		expect(rows).toEqual([
			{ id: NAMED, ...CLEARED },
			{ id: ANONYMOUS, ...CLEARED },
			expect.objectContaining({ id: OTHER, note: 'For my mother', tribute_honoree: 'Ada Okafor' })
		]);

		for (const id of [NAMED, ANONYMOUS]) {
			const received = await receivePledge(db, arrival(id));
			expect(received).toMatchObject({
				ok: true,
				gift: {
					tributeKind: null,
					tributeHonoree: null,
					tributeNotifyName: null,
					tributeNotifyEmail: null
				}
			});
			expect(await giftOf(id)).toEqual(CLEARED);
		}
	});

	it.each([
		['the public flag without the shown name', 'note_public = 0, note_anonymous = 0'],
		['the dedication without its honoree', 'tribute_kind = NULL'],
		['the person to tell without the dedication', 'tribute_kind = NULL, tribute_honoree = NULL']
	])('is one statement because the checks refuse %s', async (_, set) => {
		const refused = await run(stmt(`UPDATE pledge SET ${set} WHERE id = ?`, NAMED)).then(
			() => null,
			(error: unknown) => sqliteResultCode(error)
		);

		expect(refused).toBe('SQLITE_CONSTRAINT_CHECK');
	});

	it('runs again on a pledge already received, leaving its gift stamped', async () => {
		expect(await receivePledge(db, arrival(NAMED))).toMatchObject({ ok: true });

		await run(stmt(documentedStatement(), MAYA));

		expect(
			await first(
				stmt(`select donation_id, ${PERSONAL.join(', ')} from pledge where id = ?`, NAMED)
			)
		).toEqual({ donation_id: NAMED, ...CLEARED });
	});
});
