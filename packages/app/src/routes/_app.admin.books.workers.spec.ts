import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { POSTING_ACCOUNTS, ROLLUPS } from '$lib/server/db/accounts';
import { createDb, type Db } from '$lib/server/db/client';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as books from './_app.admin.books';

// a workers spec, against the real D1 the pool binds and the committed migrations — which is what
// a posting has to be checked against: two balanced lines landing under one entry group is a
// property of `batch()` and of `entry_group`'s own constraints, and a stand-in would only prove the
// stand-in (CLAUDE.md).
//
// the rules about what one box may hold are `$lib/ledger/input-schema.spec.ts`, in the node pool
// with no database at all. what is here is the half that reaches one: the write, the account id off
// the wire, the answer a press is given, and the list the screen draws under the form.
//
// the chain is mounted rather than the action called, which is ../route-request.testing.ts's
// pattern: the session gate is a `middleware` on ./_app.tsx, so an action called on its own is an
// action with the gate above it never run.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

/** the screen, which is both where the form posts and where its answer is drawn. */
const SCREEN = '/admin/books';

let db: Db;
let request: RouteRequester;
let session: string;

beforeAll(async () => {
	db = createDb(env.DB);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/books', module: books }
	]);
	session = await signIn();
});

beforeEach(async () => {
	// the lines first: `ledger_entry.entry_group_id` is a foreign key, so the other order is a
	// constraint violation rather than an empty table.
	await env.DB.prepare('delete from ledger_entry').run();
	await env.DB.prepare('delete from entry_group').run();
});

/** a real session, as the `Cookie` header a browser would send back. */
async function signIn(): Promise<string> {
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.message);

	const auth = createAuth(
		db,
		{ ADMIN_PASSWORD: PASSWORD },
		{ secret: signingKey.secret, requestOrigin: ORIGIN }
	);
	const { headers } = await auth.api.signInStaff({
		body: { password: PASSWORD },
		headers: new Headers({ origin: ORIGIN }),
		returnHeaders: true
	});

	const cookies = headers.getSetCookie().map((value) => value.split(';', 1)[0]);
	expect(cookies.length).toBeGreaterThan(0);
	return cookies.join('; ');
}

/**
 * a body carrying the whole form, which is the only kind this action takes.
 *
 * every box a form states must arrive (`$lib/server/conform.ts`), so a fixture posting only the
 * fields a case is about would be refused for a reason the case is not about.
 */
const CORRECTION = {
	source_id: '019fb0d2-7d57-7c5e-a7df-baed1f27b405',
	occurred_on: '2026-03-31',
	out_of: POSTING_ACCOUNTS.undepositedFunds.id,
	into: POSTING_ACCOUNTS.processorFees.id,
	amount: '4.75',
	note: 'Stripe fee for payment pi_123 that never posted.'
};

/** the two lines `CORRECTION` moves, as the screen writes them. */
const MOVEMENT = ['5200 — Processor Fees +$4.75', '1020 — Undeposited Funds −$4.75'];

/** what a press is answered with, on each arm this screen draws. */
type Answer = {
	outcome?: { kind: 'posted' | 'already_posted'; sourceId: string; movement: string[] | null };
	freshId?: string;
	releasedId?: string;
	form?: { result: { error?: Record<string, string[]> } };
};

/** posts a body at the screen and reports what it answered with. */
async function post(fields: Record<string, string>) {
	const body = new FormData();
	for (const [field, value] of Object.entries(fields)) body.append(field, value);

	const response = await request(
		new Request(`${ORIGIN}${SCREEN}`, { method: 'POST', body, headers: { cookie: session } })
	);
	return { status: response.status, answer: (await response.json()) as Answer };
}

/** every entry group in the books, with its lines, straight out of D1. */
async function stored() {
	const groups = await env.DB.prepare(
		'select id, source_type, source_id, currency, occurred_at, memo from entry_group'
	).all<{
		id: string;
		source_type: string;
		source_id: string;
		currency: string;
		occurred_at: number;
		memo: string | null;
	}>();
	const lines = await env.DB.prepare(
		'select entry_group_id, account_id, amount_minor from ledger_entry order by id'
	).all<{ entry_group_id: string; account_id: string; amount_minor: number }>();
	return { groups: groups.results, lines: lines.results };
}

/** what the screen is handed, off one visit through the chain the deployment serves it under. */
async function visit() {
	const response = await request(
		new Request(`${ORIGIN}${SCREEN}`, { headers: { cookie: session } })
	);
	expect(response.status).toBe(200);
	return (await response.json()) as {
		accounts: { value: string; label: string }[];
		sourceId: string;
		entries: { datedOn: string; source: string; movement: string[]; memo: string | null }[] | null;
		hasMore: boolean;
	};
}

/**
 * runs `during` with `table` out of reach, and puts it back whatever happens.
 *
 * renamed rather than dropped, so the migrations' own constraints and the rows around it survive —
 * the shape ./_app.admin._index.workers.spec.ts takes for a read that could not be answered.
 */
async function withoutTable<T>(table: string, during: () => Promise<T>): Promise<T> {
	await env.DB.prepare(`alter table ${table} rename to ${table}_hidden`).run();
	try {
		return await during();
	} finally {
		await env.DB.prepare(`alter table ${table}_hidden rename to ${table}`).run();
	}
}

describe('posting a correction', () => {
	it('writes the read values and answers on the screen with the movement it made', async () => {
		// what a correction *is* — the source type, the currency, the sign convention and the one
		// `batch()` — is `$lib/server/books/correct.ts` and is covered there, against the same D1.
		// what is this route's own is the translation, and the answer the press reports at the button.
		const { status, answer } = await post(CORRECTION);
		expect(status).toBe(200);
		expect(answer.outcome).toEqual({
			kind: 'posted',
			sourceId: CORRECTION.source_id,
			movement: MOVEMENT
		});

		const { groups, lines } = await stored();
		expect(groups).toHaveLength(1);
		const [group] = groups;
		expect(group?.source_id).toBe(CORRECTION.source_id);
		// the amount box holds major units and the column holds minor; the date box holds a day and
		// the column holds an instant. getting either wrong is a different figure in the books with
		// nothing looking wrong.
		expect(group?.occurred_at).toBe(Date.UTC(2026, 2, 31));
		expect(group?.memo).toBe(CORRECTION.note);
		expect(lines.find((line) => line.account_id === CORRECTION.into)?.amount_minor).toBe(475);
		expect(lines.find((line) => line.account_id === CORRECTION.out_of)?.amount_minor).toBe(-475);
	});

	it('appears in the list under the form, newest first', async () => {
		await post({ ...CORRECTION, occurred_on: '2026-03-01', note: 'the older one' });
		await post({
			...CORRECTION,
			source_id: '019fb0d2-7d57-7c5e-a7df-baed1f27b406',
			note: 'the newer one'
		});

		const { entries, hasMore } = await visit();
		expect(entries?.map((e) => e.memo)).toEqual(['the newer one', 'the older one']);
		const [newest] = entries ?? [];
		expect(newest?.datedOn).toBe('2026-03-31');
		expect(newest?.source).toBe('adjustment');
		expect(newest?.movement).toEqual(MOVEMENT);
		expect(hasMore).toBe(false);
	});
});

describe('a correction presented twice under one id', () => {
	it('lands once, and the second press says it is already in the books', async () => {
		// the page mints one id per load and the screen holds it over the answer, so a second press
		// of the same correction presents the same `(source_type, source_id)` pair and
		// `entry_group_source_idx` refuses it at the database. the books are in the state the
		// operator asked for, so the answer is neither a success nor a fault.
		await post(CORRECTION);
		const second = await post(CORRECTION);

		expect(second.status).toBe(200);
		expect(second.answer.outcome).toEqual({
			kind: 'already_posted',
			sourceId: CORRECTION.source_id,
			movement: MOVEMENT
		});
		expect((await stored()).groups).toHaveLength(1);
		expect((await stored()).lines).toHaveLength(2);
	});

	it('lands twice under two ids, which is what a deliberate second correction is', async () => {
		await post(CORRECTION);
		await post({ ...CORRECTION, source_id: '019fb0d2-7d57-7c5e-a7df-baed1f27b406' });

		expect((await stored()).groups).toHaveLength(2);
	});
});

describe('a different correction presented under an id the books already hold', () => {
	it('is refused, never answered as already posted, and hands back a fresh id', async () => {
		// the id is held by the screen only while the boxes hold what it was sent under, but a press
		// the screen got wrong must not be swallowed: the entry read back under the id is compared
		// with what was submitted, and a mismatch is a refusal the operator can press through.
		await post(CORRECTION);
		const differing = [
			{ ...CORRECTION, amount: '5.00' },
			{ ...CORRECTION, note: 'a different correction' },
			{ ...CORRECTION, occurred_on: '2026-03-30' },
			{ ...CORRECTION, into: POSTING_ACCOUNTS.bankCash.id }
		];
		for (const body of differing) {
			const { status, answer } = await post(body);
			expect(status).toBe(409);
			expect(answer.outcome).toBeUndefined();
			const [sentence] = answer.form?.result.error?.[''] ?? [];
			expect(sentence).toContain('matched an earlier correction');
			expect(sentence).toContain('Press again');
			expect(answer.releasedId).toBe(CORRECTION.source_id);
			expect(answer.freshId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
		}
		expect((await stored()).groups).toHaveLength(1);
	});

	it('posts under the fresh id it handed back', async () => {
		await post(CORRECTION);
		const { answer } = await post({ ...CORRECTION, amount: '5.00' });

		const again = await post({ ...CORRECTION, amount: '5.00', source_id: answer.freshId ?? '' });
		expect(again.answer.outcome?.kind).toBe('posted');
		expect((await stored()).groups).toHaveLength(2);
	});
});

describe('an account off the wire', () => {
	it('is refused where it names no postable account, and nothing is written', async () => {
		const { status } = await post({ ...CORRECTION, into: 'not-an-account' });
		expect(status).toBe(400);
		expect((await stored()).groups).toHaveLength(0);
	});

	it('is refused where it names a reporting rollup, which the chart does carry', async () => {
		// `4100 Donations` is seeded, so an existence check would let it through — and one ledger
		// entry naming it makes every report over its subtree double-count, permanently.
		const { status } = await post({ ...CORRECTION, into: ROLLUPS.donations.id });
		expect(status).toBe(400);
		expect((await stored()).groups).toHaveLength(0);
	});
});

describe('a correction a rule refuses', () => {
	it('writes nothing, and answers on the box the rule is about', async () => {
		const refused: [Record<string, string>, string][] = [
			[{ ...CORRECTION, amount: 'twenty' }, 'amount'],
			[{ ...CORRECTION, amount: '0' }, 'amount'],
			[{ ...CORRECTION, amount: '-4.75' }, 'amount'],
			[{ ...CORRECTION, into: CORRECTION.out_of }, 'into'],
			[{ ...CORRECTION, note: '' }, 'note'],
			[{ ...CORRECTION, occurred_on: '2026-02-30' }, 'occurred_on']
		];
		for (const [body, box] of refused) {
			const { status, answer } = await post(body);
			expect(status, box).toBe(400);
			expect(Object.keys(answer.form?.result.error ?? {}), box).toEqual([box]);
		}
		expect((await stored()).groups).toHaveLength(0);
	});
});

describe('a write that failed', () => {
	it('says so without claiming nothing was recorded, and hands back a fresh id', async () => {
		const { status, answer } = await withoutTable('ledger_entry', () => post(CORRECTION));

		expect(status).toBe(500);
		const [sentence] = answer.form?.result.error?.[''] ?? [];
		expect(sentence).toContain('Press again');
		expect(sentence).not.toMatch(/nothing (was|has been) (recorded|posted)/i);
		// a fresh id rides back for a press whose boxes change before it is made again: the one this
		// write was sent under may already hold it.
		expect(answer.freshId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
		expect(answer.freshId).not.toBe(CORRECTION.source_id);
		// one `batch()`, so the header did not land without its lines.
		expect((await stored()).groups).toHaveLength(0);
	});
});

describe('the screen as it is served', () => {
	it('offers the nine postable accounts and no rollup, labelled by code and name', async () => {
		// derived from the seeded chart with no read, so the pickers stand even where the list below
		// them could not be read.
		const { accounts } = await visit();
		expect(accounts).toHaveLength(9);
		expect(accounts[0]).toEqual({
			value: POSTING_ACCOUNTS.bankCash.id,
			label: '1010 — Bank / Cash'
		});
		expect(accounts.map((a) => a.value)).not.toContain(ROLLUPS.donations.id);
		// the blank the pickers open on is the screen's and not the chart's.
		expect(accounts.map((a) => a.value)).not.toContain('');
	});

	it('mints a fresh id for the next correction on every load', async () => {
		const first = await visit();
		const second = await visit();
		expect(first.sourceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
		expect(second.sourceId).not.toBe(first.sourceId);
	});

	it('says the list could not be read rather than drawing it empty, and still offers the form', async () => {
		const served = await withoutTable('entry_group', () => visit());

		expect(served.entries).toBe(null);
		expect(served.accounts).toHaveLength(9);
	});
});
