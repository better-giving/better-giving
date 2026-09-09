import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { POSTING_ACCOUNTS, ROLLUPS } from './accounts';
import { postableFromAccount, type PostableCandidate } from './postable';
import type { Account } from './schema';

// the drift guard between `accounts.ts` and `migrations/0000_initial_schema.sql`.
//
// the ids are deliberately duplicated across those two files (see the header of 0001),
// and without this test nothing detects a divergence: a later PR adds an account to
// the map with a fresh UUIDv7, forgets the migration, and `check`/`lint`/`build` all
// pass. it then surfaces as an FK rejection on `ledger_entry.account_id` — the
// donor's money taken and the ledger write thrown, in production, on a fork we
// cannot reach.
//
// it executes the real migration SQL against a real D1 rather than parsing it — see
// ./d1.setup.ts, which applies the committed `migrations/` files the same way wrangler
// does — so the check constraints, the FK on parent_id and the insert ordering are all
// exercised too.

type AccountRow = {
	id: string;
	code: string;
	type: string;
	is_postable: number;
	parent_id: string | null;
};

async function seededAccounts(): Promise<AccountRow[]> {
	const { results } = await env.DB.prepare(
		'select id, code, type, is_postable, parent_id from account order by code'
	).all<AccountRow>();
	return results;
}

/** the identity a ledger entry actually depends on. */
const identity = (a: { id: string; code: string; type: string }) => `${a.code}|${a.type}|${a.id}`;

describe('seeded chart of accounts', () => {
	// read once, in a hook rather than in the describe body: the rows now arrive over an
	// async binding, and a describe body cannot await.
	let rows: AccountRow[];
	beforeAll(async () => {
		rows = await seededAccounts();
	});

	const posting = Object.values(POSTING_ACCOUNTS);
	const rollups = Object.values(ROLLUPS);
	const declared = [...posting, ...rollups];

	it('matches accounts.ts exactly on (code, type, id), with no extra rows on either side', () => {
		expect(rows.map(identity).sort()).toEqual(declared.map(identity).sort());
	});

	it('has exactly as many rows as accounts.ts declares', () => {
		// set equality above would pass if one file contained a duplicate; this is the
		// count check that closes it.
		expect(rows).toHaveLength(declared.length);
		expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
		expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
	});

	it('marks every POSTING_ACCOUNTS member postable', () => {
		const byId = new Map(rows.map((r) => [r.id, r]));
		for (const a of posting) expect(byId.get(a.id)?.is_postable, a.code).toBe(1);
	});

	it('marks every ROLLUPS member non-postable', () => {
		const byId = new Map(rows.map((r) => [r.id, r]));
		for (const a of rollups) expect(byId.get(a.id)?.is_postable, a.code).toBe(0);
	});

	it('uses a UUIDv7 for every id', () => {
		// the version nibble. a hand-pasted id that is not a v7 breaks the one
		// invariant the hardcoding exists to preserve.
		for (const a of declared) expect(a.id, a.code).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
	});

	it('resolves every parent_id to a seeded account', () => {
		const ids = new Set(rows.map((r) => r.id));
		for (const r of rows) if (r.parent_id !== null) expect(ids, r.code).toContain(r.parent_id);
	});
});

describe('an `Account` row satisfies `PostableCandidate` by shape', () => {
	// the pin on a structural claim ./postable.ts makes and nothing compiled.
	//
	// `PostableCandidate` is declared structurally — `{ id: string; isPostable: boolean }` —
	// rather than as `Pick<Account, …>`, because importing `Account` from ./schema.ts is what
	// would make ./postable.ts a non-leaf — and schema.ts imports it, so that is a
	// postable.ts <-> schema.ts cycle. its docblock then asserts "an `Account` row satisfies it
	// by shape", which is true only while `schema.ts` declares `is_postable` as
	// `integer(..., { mode: 'boolean' })`. flip that column to number mode — a one-word edit
	// that looks like a modernisation — and the claim is false with nothing to say so:
	// `postableFromAccount` has no call sites yet, so no existing code would stop compiling.
	//
	// the assertion that matters here is the assignment, and it is checked by `tsc` during
	// `pnpm check`, not by `expect` during `pnpm test`. the runtime half exists so the pin is
	// referenced rather than dead, and because `postableFromAccount(row)` reading `row.id`
	// straight off an `Account` is the "no adapter" half of the same claim.

	it('is assignable without an adapter, and hands its id to postableFromAccount', () => {
		const row = {
			id: POSTING_ACCOUNTS.bankCash.id,
			isPostable: true
		} as Account;

		// the pin. widening `is_postable` past `boolean` breaks this line and only this line.
		const candidate: PostableCandidate = row;

		expect(postableFromAccount(candidate)).toBe(POSTING_ACCOUNTS.bankCash.id);
	});

	it('yields null for a rollup row, which is what keeps it out of the ledger', () => {
		const rollup = { id: ROLLUPS.donations.id, isPostable: false } as Account;
		expect(postableFromAccount(rollup)).toBeNull();
	});
});
