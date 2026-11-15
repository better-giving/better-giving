import type { InStatement, InValue } from '@libsql/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './client';
import { all, client, run, stmt } from './database.testing';
import { rejectionCode } from './rejection.testing';
import { giftMatch } from './schema';

// `gift_match`, at most one row per gift for employer matching, read off the applied migrations rather
// than off ./schema.ts.

const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';
const SQLITE_CONSTRAINT_UNIQUE = 'SQLITE_CONSTRAINT_UNIQUE';
const SQLITE_CONSTRAINT_FOREIGNKEY = 'SQLITE_CONSTRAINT_FOREIGNKEY';

const CONTACT_ID = '019fb600-0000-7000-8000-000000000001';

let next = 0;
const fresh = () => `019fb600-0000-7000-8000-1000000000${String(++next).padStart(2, '0')}`;

let tokens = 0;
/** a 32-symbol token in the minting alphabet, distinct per call. */
const token = () => `${String(++tokens).padStart(4, '0')}abcdefghjkmnpqrstvwxyz012345`;

async function gift(): Promise<string> {
	const id = fresh();
	await run(
		stmt(
			`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
			 values (?, ?, 10000, 'USD', 0, 0)`,
			id,
			CONTACT_ID
		)
	);
	return id;
}

const insertMatch = (columns: Record<string, InValue>): InStatement => {
	const names = Object.keys(columns);
	return stmt(
		`insert into gift_match (${names.join(', ')}) values (${names.map(() => '?').join(', ')})`,
		...Object.values(columns)
	);
};

/** the code and the constraint's name, so a row refused by a different constraint does not pass. */
const refusedBy = async (code: string, constraint: string, statement: InStatement) => {
	const chain = await rejectionCode(() => run(statement));
	expect(chain).toContain(code);
	expect(chain).toContain(constraint);
};

beforeAll(async () => {
	await run(
		stmt(
			`insert into contact (id, kind, display_name, created_at, updated_at)
			 values (?, 'individual', 'Gift Donor', 0, 0)`,
			CONTACT_ID
		)
	);
});

describe('a gift match', () => {
	it('refuses a second row for a gift that has one', async () => {
		const donationId = await gift();
		await run(insertMatch({ id: fresh(), donation_id: donationId, token: token(), created_at: 0 }));
		await refusedBy(
			SQLITE_CONSTRAINT_UNIQUE,
			'gift_match.donation_id',
			insertMatch({ id: fresh(), donation_id: donationId, token: token(), created_at: 0 })
		);
	});

	it('refuses a token another gift holds', async () => {
		const held = token();
		await run(insertMatch({ id: fresh(), donation_id: await gift(), token: held, created_at: 0 }));
		await refusedBy(
			SQLITE_CONSTRAINT_UNIQUE,
			'gift_match.token',
			insertMatch({ id: fresh(), donation_id: await gift(), token: held, created_at: 0 })
		);
	});

	it.each([
		['short', 'abcdefghjkmnpqrstvwxyz012345678'],
		['in capitals', 'ABCDEFGHJKMNPQRSTVWXYZ0123456789'],
		['holding a letter the alphabet leaves out', 'ilouabcdefghjkmnpqrstvwxyz012345']
	])('refuses a token %s', async (_, bad) => {
		await refusedBy(
			SQLITE_CONSTRAINT_CHECK,
			'gift_match_token_check',
			insertMatch({ id: fresh(), donation_id: await gift(), token: bad, created_at: 0 })
		);
	});

	it('mints a token its own check accepts when the writer names none', async () => {
		const donationId = await gift();
		const [row] = await createDb(client)
			.insert(giftMatch)
			.values({ donationId })
			.returning({ token: giftMatch.token });
		expect(row?.token).toMatch(/^[0-9a-hjkmnp-tv-z]{32}$/);
	});

	it('refuses a gift that does not exist', async () => {
		await refusedBy(
			SQLITE_CONSTRAINT_FOREIGNKEY,
			'FOREIGN KEY',
			insertMatch({ id: fresh(), donation_id: fresh(), token: token(), created_at: 0 })
		);
	});
});

describe('the employer a donor names', () => {
	it.each([
		['empty', ''],
		['whitespace', ' \t'],
		['a lone non-breaking space', '\u00a0']
	])('refuses one that is %s', async (_, blank) => {
		await refusedBy(
			SQLITE_CONSTRAINT_CHECK,
			'gift_match_employer_not_blank_check',
			insertMatch({
				id: fresh(),
				donation_id: await gift(),
				token: token(),
				employer: blank,
				created_at: 0
			})
		);
	});

	it('takes 200 characters and refuses 201', async () => {
		await run(
			insertMatch({
				id: fresh(),
				donation_id: await gift(),
				token: token(),
				employer: 'é'.repeat(200),
				created_at: 0
			})
		);
		await refusedBy(
			SQLITE_CONSTRAINT_CHECK,
			'gift_match_employer_length_check',
			insertMatch({
				id: fresh(),
				donation_id: await gift(),
				token: token(),
				employer: 'é'.repeat(201),
				created_at: 0
			})
		);
	});
});

describe('the stamps', () => {
	it.each([
		['filed_at', 'filed_by'],
		['matched_at', 'matched_by'],
		['voided_at', 'voided_by']
	])('refuses %s without its %s, and the reverse', async (stamp, by) => {
		const extra = stamp === 'voided_at' ? { void_reason: 'Refunded' } : {};
		await refusedBy(
			SQLITE_CONSTRAINT_CHECK,
			`gift_match_${by}_check`,
			insertMatch({
				id: fresh(),
				donation_id: await gift(),
				token: token(),
				[stamp]: 1,
				...extra,
				created_at: 0
			})
		);
		await refusedBy(
			SQLITE_CONSTRAINT_CHECK,
			`gift_match_${by}_check`,
			insertMatch({
				id: fresh(),
				donation_id: await gift(),
				token: token(),
				[by]: 'donor',
				created_at: 0
			})
		);
	});

	it('refuses a blank who', async () => {
		await refusedBy(
			SQLITE_CONSTRAINT_CHECK,
			'gift_match_filed_by_not_blank_check',
			insertMatch({
				id: fresh(),
				donation_id: await gift(),
				token: token(),
				filed_at: 1,
				filed_by: ' ',
				created_at: 0
			})
		);
	});

	it('refuses a void with no reason, a blank one, or a reason with no void', async () => {
		const voided = { voided_at: 1, voided_by: 'system' };
		await refusedBy(
			SQLITE_CONSTRAINT_CHECK,
			'gift_match_void_reason_check',
			insertMatch({
				id: fresh(),
				donation_id: await gift(),
				token: token(),
				...voided,
				created_at: 0
			})
		);
		await refusedBy(
			SQLITE_CONSTRAINT_CHECK,
			'gift_match_void_reason_not_blank_check',
			insertMatch({
				id: fresh(),
				donation_id: await gift(),
				token: token(),
				...voided,
				void_reason: '  ',
				created_at: 0
			})
		);
		await refusedBy(
			SQLITE_CONSTRAINT_CHECK,
			'gift_match_void_reason_check',
			insertMatch({
				id: fresh(),
				donation_id: await gift(),
				token: token(),
				void_reason: 'Refunded',
				created_at: 0
			})
		);
	});

	it('takes a match before a filing, and a void beside a match, each with its who', async () => {
		const donationId = await gift();
		await run(
			insertMatch({
				id: fresh(),
				donation_id: donationId,
				token: token(),
				employer: 'Acme Corp',
				matched_at: 2,
				matched_by: '01HSTAFFUSERID',
				voided_at: 3,
				voided_by: 'system',
				void_reason: 'Refunded',
				created_at: 0
			})
		);
		expect(
			await all(
				stmt(
					'select filed_at, matched_by, voided_by from gift_match where donation_id = ?',
					donationId
				)
			)
		).toEqual([{ filed_at: null, matched_by: '01HSTAFFUSERID', voided_by: 'system' }]);
	});
});

describe('the pack’s failed sends', () => {
	it('count none on a row that names no count', async () => {
		const donationId = await gift();
		await run(insertMatch({ id: fresh(), donation_id: donationId, token: token(), created_at: 0 }));
		expect(
			await all(stmt('select pack_tries from gift_match where donation_id = ?', donationId))
		).toEqual([{ pack_tries: 0 }]);
	});

	it('refuse a count below nothing', async () => {
		await refusedBy(
			SQLITE_CONSTRAINT_CHECK,
			'gift_match_pack_tries_check',
			insertMatch({
				id: fresh(),
				donation_id: await gift(),
				token: token(),
				pack_tries: -1,
				created_at: 0
			})
		);
	});
});

describe('the reminder sweep', () => {
	it('reads only the rows still owed a reminder, through its partial index', async () => {
		const plan = await all<{ detail: string }>(
			stmt(
				`explain query plan select id from gift_match
				 where reminder_due_at <= ? and reminded_at is null and filed_at is null
				   and matched_at is null and voided_at is null`,
				Date.now()
			)
		);
		expect(plan.map((p) => p.detail).join('\n')).toContain(
			'USING INDEX gift_match_reminder_due_idx'
		);
	});
});
