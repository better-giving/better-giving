import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FormInputValues } from '../../forms/fields';
import { POSTING_ACCOUNTS } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import {
	parseFormInput,
	parseFormProgram,
	type ParsedForm,
	type ParsedFormProgram
} from './form-input';
import {
	archiveForm,
	createForm,
	readForm,
	updateFormProgram,
	readFormOrigins,
	readForms,
	updateFormGiving,
	updateFormName,
	updateFormOrigins
} from './queries';

// real D1 inside workerd, over the committed migrations — so the JSON check, the composite
// postable foreign key and `STRICT` are all the deployed ones.
//
// the `form` table object is deliberately not imported here: every read and write of it lives
// in ./queries.ts, and the probes below reach past drizzle on purpose — a check is a property
// of the database, so the statement that tests it should be the one a hand-written
// `wrangler d1 execute` would send.

let db: Db;

/**
 * the form every case below is about, written by this file.
 *
 * a deployment ships with no forms — `migrations/` seeds the chart of accounts and the signing
 * key and nothing else — so a test that needs one makes it. the id is arbitrary and local to
 * this file, which is the point: no app code and no migration names a form id.
 */
const PRIMARY_FORM_ID = 'frm_primaryformtest1';

/**
 * a postable revenue account, read out of the table rather than written down.
 *
 * `form` carries the composite postable foreign key, so a made-up id fails on the INSERT — and
 * the seeded account ids are reference data belonging to
 * `migrations/0000_initial_schema.sql`, so pinning one here would be a second copy of it.
 */
let revenueAccountId: string;

/**
 * a second postable revenue account, read out of the table for the same reason. a fixture row
 * pointed at it is what gives "a save of the name leaves the fund column alone" something to be
 * wrong about: `createForm` writes 4110, so a write that reached the column would move it there.
 */
let otherRevenueAccountId: string;

/**
 * how many forms the committed `migrations/` leave behind, captured before any test writes
 * one. storage is per-file, and `beforeAll` runs ahead of every `beforeEach`, so this is the
 * count a freshly deployed database has.
 */
let formsAfterMigrating: number;

beforeAll(async () => {
	// the request-path constructor, not a fixture: what these tests exercise is what `requestDb`
	// builds for every request (src/request-context.ts).
	db = createDb(env.DB);

	const row = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4110'`
	).first<{ id: string }>();
	if (!row)
		throw new Error(
			'no 4110 account — has the chart of accounts in migrations/0000_initial_schema.sql moved?'
		);
	revenueAccountId = row.id;

	const other = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4120'`
	).first<{ id: string }>();
	if (!other)
		throw new Error(
			'no 4120 account — has the chart of accounts in migrations/0000_initial_schema.sql moved?'
		);
	otherRevenueAccountId = other.id;

	const count = await env.DB.prepare('select count(*) as n from form').first<{ n: number }>();
	formsAfterMigrating = count?.n ?? -1;
});

// storage is isolated per test file, not per test, so a form written by one `it` is visible to
// the next. every case starts from one form and nothing else, so the table is emptied and the
// primary row re-made rather than patched back into shape.
beforeEach(async () => {
	await env.DB.prepare('delete from form').run();
	// after the forms, because `form.program_id` points here and nothing carries an ON DELETE.
	await env.DB.prepare('delete from program').run();
	// later than `insertSecondForm`'s, so "oldest first" has something to be wrong about.
	await insertForm(PRIMARY_FORM_ID, 'General Fund', 1000);
});

it('the migrations seed no form, so a deployment starts with none', () => {
	// the rule this guards is not "one fewer row". a seeded form needs a fixed id for
	// `ON CONFLICT DO NOTHING` to have anything to conflict with, and a form id is public — it
	// goes in the org's own HTML — so a seed means every fork ships the same 80 bits in its
	// snippet. the first form is one a human makes, and this is what fails if a migration ever
	// puts one back.
	expect(formsAfterMigrating).toBe(0);
});

/** writes the column directly, so the decode under test is not also the thing that wrote it. */
async function storeRawOrigins(id: string, json: string): Promise<void> {
	await env.DB.prepare('update form set allowed_origins = ? where id = ?').bind(json, id).run();
}

describe('readForms', () => {
	it('hands back the origin list as an array, never the JSON the column holds', async () => {
		// the seam this whole folder exists to own: `allowed_origins` is plain text, so a
		// query that returned the row untouched would put a JSON string in a route and a
		// `JSON.parse` in a component.
		await storeRawOrigins(PRIMARY_FORM_ID, '["https://acme.org","http://localhost:5173"]');
		const [form] = await readForms(db);
		expect(form?.allowedOrigins).toEqual(['https://acme.org', 'http://localhost:5173']);
	});

	it('returns every form, oldest first', async () => {
		// a list and not a lookup, which is the whole reason no form id appears in app code: a
		// deployment that grows a second form must show both rather than silently pick one. the
		// older row is first, and the tiebreak on `id` is why the order does not reshuffle when
		// two forms share a millisecond.
		const other = await insertSecondForm();
		expect((await readForms(db)).map((f) => f.id)).toEqual([other, PRIMARY_FORM_ID]);
	});

	it('leaves archived forms out', async () => {
		// `archived_at` carries the same meaning here as on `contact` — forms archive, they never
		// delete (see FORM_STATUSES in ../../forms/statuses.ts) — so a list that showed them would
		// an id, a copyable snippet and a live save box for a form staff have already retired.
		const other = await insertSecondForm();
		await env.DB.prepare('update form set archived_at = 1, status = ? where id = ?')
			.bind('archived', other)
			.run();
		expect((await readForms(db)).map((f) => f.id)).toEqual([PRIMARY_FORM_ID]);
	});

	it('selects the four columns this page needs and no others', async () => {
		// pinned on the query, not on the route's projection. `form` carries three JSON columns
		// and `copy` has no decode — so a `select()` of the whole row hands `suggested_amounts`
		// and `copy` out as raw JSON strings, which is exactly what ./form-json.ts says never
		// leaves this seam. the route dropping them today is luck, and this is the assertion that
		// is not.
		//
		// neither how a donor may pay nor how often a gift may repeat is among them, and neither is
		// a fact about a form: every form offers `OFFERED_PAYMENT_METHODS` in
		// `$lib/forms/offered-rails.ts` and the cadences `./offered-cadences.ts` reads off the
		// processor's account. neither has a column left to select: `form` carries no
		// `payment_methods` and no `frequencies`.
		const [form] = await readForms(db);
		expect(Object.keys(form ?? {}).sort()).toEqual(['allowedOrigins', 'id', 'name', 'status']);
	});
});

/**
 * one form, past drizzle.
 *
 * raw SQL rather than a query from ./queries.ts, and that is not a shortcut: there is no
 * form-creation query to reach for, deliberately (/admin/forms has no CRUD). writing the row
 * directly also keeps the thing under test off the fixture's path.
 */
async function insertForm(
	id: string,
	name: string,
	createdAt: number,
	fund: string = revenueAccountId
): Promise<string> {
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, created_at, updated_at)
		 values (?, ?, 'draft', ?, 'USD', ?, ?)`
	)
		.bind(id, name, fund, createdAt, createdAt)
		.run();
	return id;
}

/** a second form, so "only this one" is a claim with something to be wrong about. */
async function insertSecondForm(): Promise<string> {
	return insertForm('frm_secondformtest1', 'Building Fund', 0);
}

// ---------------------------------------------------------------------------
// making, reading, editing and retiring a form.

/** a submission that parses, so each case below states only what it is about. */
function submitted(over: Partial<FormInputValues> = {}): ParsedForm {
	const result = parseFormInput({
		name: 'Gala 2026',
		status: 'live',
		// major units, which is what an operator types: `$lib/forms/amounts.ts` is what turns them
		// into the integers the columns below are asserted against. one entry per box, which is how
		// the amounts editor submits them.
		suggested_amounts: ['25.00', '50.00', '100.00'],
		min_minor: '5.00',
		max_minor: '10000.00',
		// one entry per box, which is how the sites editor submits them — the group is a repeating
		// row rather than a textarea, so the list crosses as a list.
		allowed_origins: ['https://acme.org', 'https://give.acme.org'],
		program_mode: 'none',
		program_id: '',
		...over
	});
	if (!result.ok) throw new Error(`fixture did not parse: ${JSON.stringify(result.errors)}`);
	return result.value;
}

/** the program group alone, parsed, which is what `updateFormProgram` takes. */
function programOf(over: Partial<FormInputValues> = {}): ParsedFormProgram {
	const result = parseFormProgram({ program_mode: 'none', program_id: '', ...over });
	if (!result.ok) throw new Error(`fixture did not parse: ${JSON.stringify(result.errors)}`);
	return result.value;
}

/**
 * a create that must have landed, so a case about anything else is not also asserting that.
 *
 * `createForm` answers `null` for a pin no active cause answers to, which is the one refusal it
 * has — every case that is not about that one goes through here.
 */
async function created(input: ParsedForm) {
	const made = await createForm(db, input);
	if (made === null) throw new Error('the fixture form was refused; is its program active?');
	return made;
}

/** a cause, written past drizzle so a fixture is not also exercising ../programs/queries.ts. */
async function insertProgram(id: string, name: string, archived = false): Promise<string> {
	await env.DB.prepare(
		`insert into program (id, name, status, created_at, updated_at, archived_at)
		 values (?, ?, ?, 0, 0, ?)`
	)
		.bind(id, name, archived ? 'archived' : 'active', archived ? 0 : null)
		.run();
	return id;
}

/** the raw text of one column, past drizzle and past every decode. */
async function rawColumn(id: string, column: string): Promise<unknown> {
	const row = await env.DB.prepare(`select ${column} as v from form where id = ?`)
		.bind(id)
		.first<{ v: unknown }>();
	return row?.v ?? null;
}

describe('createForm', () => {
	it('mints a public id the length check accepts, prefixed so a human can place it', async () => {
		// the one primary key in this schema that is not a uuidv7: it sits in the org's own HTML
		// and is quoted back by an unauthenticated request, so it is 80 random bits rather than
		// a timestamp. `form_id_length_check` is the floor under it.
		const made = await created(submitted());
		expect(made.id.startsWith('frm_')).toBe(true);
		expect(made.id.length).toBeGreaterThanOrEqual(12);
	});

	it('writes USD, which is not an input and not editable', async () => {
		// v0 is USD-only by decision: a non-USD form surfaces bank-debit rails whose mandate flow
		// the client machine does not model. read past drizzle, because the point is what is in
		// the column rather than what the mapper hands back.
		const made = await created(submitted());
		expect(await rawColumn(made.id, 'currency')).toBe('USD');
	});

	it('stores every JSON column as JSON its own CHECK accepts, and reads it back decoded', async () => {
		// two array columns and one object, and only text underneath all three — so a write that
		// stored a JavaScript array verbatim is refused by D1 rather than by anything in this
		// repo, and a read that skipped the decode puts a JSON string in a route.
		const made = await created(submitted());

		expect(await rawColumn(made.id, 'suggested_amounts')).toBe('[2500,5000,10000]');
		expect(await rawColumn(made.id, 'allowed_origins')).toBe(
			'["https://acme.org","https://give.acme.org"]'
		);
		// `copy` has no codec in this repo, so nothing writes it and it stays the column default.
		expect(await rawColumn(made.id, 'copy')).toBe('{}');

		expect(made.suggestedAmounts).toEqual([2500, 5000, 10000]);
		expect(made.allowedOrigins).toEqual(['https://acme.org', 'https://give.acme.org']);
	});

	it('leaves the forms already there alone', async () => {
		await created(submitted());
		expect((await readForms(db)).map((f) => f.name)).toContain('General Fund');
	});

	it('records the gift against the tax-deductible fund, which no submission names', async () => {
		// the column is not an input on either form screen, so the account is this write's own
		// decision rather than something a body can move. asserted past drizzle as well as off the
		// returned record, because what a gift is filed against is the column and not the mapping.
		const made = await created(submitted());
		expect(made.revenueAccountId).toBe(POSTING_ACCOUNTS.donationsDeductible.id);
		expect(await rawColumn(made.id, 'revenue_account_id')).toBe(
			POSTING_ACCOUNTS.donationsDeductible.id
		);
	});
});

describe('readForm', () => {
	it('hands back one form with every JSON column decoded and no raw JSON on it', async () => {
		// the same seam `readForms` keeps for the list: `form` holds three JSON columns as plain
		// text, so a `select()` of the row would put two JSON strings in an edit page. `copy` is
		// absent because this folder owns no decode for it.
		const made = await created(submitted());
		const found = await readForm(db, made.id);
		expect(Object.keys(found ?? {}).sort()).toEqual([
			'allowedOrigins',
			'currency',
			'id',
			'maxMinor',
			'minMinor',
			'name',
			'programId',
			'programMode',
			'revenueAccountId',
			'status',
			'suggestedAmounts'
		]);
		expect(found?.minMinor).toBe(500);
		expect(found?.maxMinor).toBe(1000000);
		expect(found?.revenueAccountId).toBe(revenueAccountId);
	});

	it('answers null for an id no form carries', async () => {
		expect(await readForm(db, 'frm_nosuchformatall')).toBeNull();
	});

	it('still finds an archived form, unlike the list', async () => {
		// an edit page has to tell "this form was retired" from "there is no such form": the
		// first is a sentence and the second is a 404, and a lookup that hid the archived row
		// would make them the same answer.
		const made = await created(submitted());
		await archiveForm(db, made.id);
		expect((await readForm(db, made.id))?.status).toBe('archived');
	});
});

describe('readFormOrigins', () => {
	/**
	 * the one column the public api's preflight needs, and the whole of what it may know about a
	 * form before a browser has been allowed to ask anything.
	 *
	 * it exists so that answering a preflight is not a `readForm` — nine columns and two JSON
	 * decodes to reach one list, on an unauthenticated path anybody may aim at, handing the route
	 * a whole form record it has no business holding.
	 */
	it('reads the origins, decoded, and nothing else', async () => {
		const made = await created(submitted());
		expect(await readFormOrigins(db, made.id)).toEqual([
			'https://acme.org',
			'https://give.acme.org'
		]);
	});

	/**
	 * an id nothing matches and a form naming no site are one answer, deliberately: the preflight
	 * grants nothing in either case, and telling them apart is what would make this a form-id
	 * oracle for every page on the internet.
	 */
	it('answers an empty list for an id no form carries', async () => {
		expect(await readFormOrigins(db, 'frm_nosuchformatall')).toEqual([]);
	});

	/**
	 * archived like `readForm` rather than filtered like the list. the preflight is answered
	 * before the refusal ladder runs, so a retired form's sites are still the sites its preflight
	 * is decided against — what tells the page the form is gone is the 410 on the request itself.
	 */
	it('reads a retired form’s list too', async () => {
		const made = await created(submitted());
		await archiveForm(db, made.id);
		expect(await readFormOrigins(db, made.id)).toContain('https://acme.org');
	});
});

// ---------------------------------------------------------------------------
// the three group writes. the editor saves a group at a time, so each one sets only the columns
// its own group owns, and a group that does not own a column has no way to write it.
//
// each assertion below is made against all three, because three writes is three chances to lose
// one: the `where` that keeps an archived row out of reach,
// the composite foreign key behind the fund, and the guard that says the branded fund must be the
// one this submission named. what is new is the property three functions exist for — a group write
// must not reach a column outside its own group — and that is asserted first.
//
// `submitted()` hands back a whole `ParsedForm`, which carries every group's fields, so it is
// accepted where any one group's parsed value is wanted. that is the type doing what it says: a
// value past every check is past each group's.
// ---------------------------------------------------------------------------

describe('the three group writes', () => {
	it('each writes its own columns and touches no other', async () => {
		// the whole reason there are three rather than one taking a partial: a `Partial<>` argument
		// makes "do not write a column this group does not own" a rule every caller keeps on its
		// own, and one spread of the wrong object turns a save of the name into a save that clears
		// the amount bounds.
		const made = await created(submitted());

		await updateFormName(db, made.id, submitted({ name: 'Gala 2027', status: 'draft' }));
		let after = await readForm(db, made.id);
		expect(after).toMatchObject({ name: 'Gala 2027', status: 'draft' });
		// and nothing the name group does not own moved.
		expect(after?.minMinor).toBe(made.minMinor);
		expect(after?.suggestedAmounts).toEqual(made.suggestedAmounts);
		expect(after?.allowedOrigins).toEqual(made.allowedOrigins);

		await updateFormGiving(
			db,
			made.id,
			submitted({ min_minor: '10.00', max_minor: '20.00', suggested_amounts: ['10.00'] })
		);
		after = await readForm(db, made.id);
		expect(after).toMatchObject({ minMinor: 1000, maxMinor: 2000, suggestedAmounts: [1000] });
		// the name group's own write is still standing, which is the other direction of the claim.
		expect(after?.name).toBe('Gala 2027');
		expect(after?.allowedOrigins).toEqual(made.allowedOrigins);

		await updateFormOrigins(db, made.id, submitted({ allowed_origins: [] }));
		after = await readForm(db, made.id);
		expect(after?.allowedOrigins).toEqual([]);
		expect(after?.name).toBe('Gala 2027');
		expect(after?.minMinor).toBe(1000);
	});

	it('reports an unknown id instead of writing anything, whichever group asked', async () => {
		// an edit posts to an id from a URL, so a stale tab is the ordinary way here. it is an
		// answer rather than a throw because the caller turns it into a rejected save, not a 500.
		const missing = 'frm_nosuchformatall';
		expect(await updateFormName(db, missing, submitted())).toBe(false);
		expect(await updateFormGiving(db, missing, submitted())).toBe(false);
		expect(await updateFormOrigins(db, missing, submitted())).toBe(false);
	});

	it('leaves every other form alone', async () => {
		const made = await created(submitted());
		await updateFormName(db, made.id, submitted({ name: 'Renamed' }));
		expect((await readForm(db, PRIMARY_FORM_ID))?.name).toBe('General Fund');
	});

	it('refuses to write an archived form back into an editable state', async () => {
		// retiring is one-way from these functions' side. `status` is the only retirement signal
		// `FormRecord` carries and the name group's write sets it, so an update that reached an
		// archived row would leave `status = 'draft'` beside a set `archived_at`: a form
		// `readForms` hides forever, `archiveForm` answers `false` about, and no screen can
		// retire again. the `where` is on all three, so all three are asserted.
		const made = await created(submitted());
		await archiveForm(db, made.id);
		const stamped = await rawColumn(made.id, 'archived_at');

		expect(await updateFormName(db, made.id, submitted({ name: 'Back From The Dead' }))).toBe(
			false
		);
		// the suggested tiles move with the floor, because the fixture parses the whole form and a
		// tile under the smallest gift is a submission `parseFormInput` refuses.
		expect(
			await updateFormGiving(
				db,
				made.id,
				submitted({ min_minor: '99.99', suggested_amounts: ['99.99'] })
			)
		).toBe(false);
		expect(await updateFormOrigins(db, made.id, submitted({ allowed_origins: [] }))).toBe(false);

		expect(await rawColumn(made.id, 'status')).toBe('archived');
		expect(await rawColumn(made.id, 'archived_at')).toBe(stamped);
		// and every column each of the three would have written is the one the row had. compared
		// field by field rather than against `made`, because archiving legitimately moved `status`
		// and a whole-record comparison would be asserting that it had not.
		const after = await readForm(db, made.id);
		expect(after?.name).toBe(made.name);
		expect(after?.minMinor).toBe(made.minMinor);
		expect(after?.suggestedAmounts).toEqual(made.suggestedAmounts);
		expect(after?.allowedOrigins).toEqual(made.allowedOrigins);
	});

	it('leaves the fund column where it stands when the name is saved', async () => {
		// the name group writes the two columns its own boxes hold and no third. the fixture row is
		// pointed at 4120 rather than at what `createForm` writes, so "the column did not move" has
		// something to be wrong about: a write that reached it would leave 4110 here.
		const pointed = await insertForm(
			'frm_otherfundform01',
			'Restricted Appeal',
			2000,
			otherRevenueAccountId
		);

		expect(await updateFormName(db, pointed, submitted({ name: 'Renamed Appeal' }))).toBe(true);

		expect((await readForm(db, pointed))?.name).toBe('Renamed Appeal');
		expect(await rawColumn(pointed, 'revenue_account_id')).toBe(otherRevenueAccountId);
	});
});

describe('updateFormOrigins', () => {
	it('refuses a row that is not there to write to', async () => {
		// no such form, and one that has been retired. both are a tab that was open when the form
		// stopped being editable, and both are one sentence on the screen: the write hands back the
		// same `false` for each because there is nothing an operator could do differently about them.
		const made = await created(submitted());

		expect(await updateFormOrigins(db, 'frm_nosuchformatall', submitted())).toBe(false);

		await archiveForm(db, made.id);
		// the `where` is what keeps an archived row out of reach, so the list it still holds is the
		// list it was retired with.
		expect(await updateFormOrigins(db, made.id, submitted())).toBe(false);
		expect((await readForm(db, made.id))?.allowedOrigins).toEqual(made.allowedOrigins);
	});
});

describe('archiveForm', () => {
	it('sets the status and the timestamp together, in one statement', async () => {
		// `FORM_STATUSES` and `archived_at` are two representations of one fact. a write that
		// moved one without the other leaves a form that reads archived on a screen and live to
		// `readForms`, and D1 has no interactive transaction to put two statements inside.
		const made = await created(submitted());
		expect(await archiveForm(db, made.id)).toBe(true);

		expect(await rawColumn(made.id, 'status')).toBe('archived');
		expect(await rawColumn(made.id, 'archived_at')).toBeTypeOf('number');
	});

	it('takes the form out of the list without deleting it', async () => {
		// a pasted snippet outlives the form it points at — it sits in someone else's HTML on a
		// site we cannot reach — so a form is retired and never deleted.
		const made = await created(submitted());
		await archiveForm(db, made.id);
		expect((await readForms(db)).map((f) => f.id)).toEqual([PRIMARY_FORM_ID]);
		expect(await readForm(db, made.id)).not.toBeNull();
	});

	it('answers false for a form there is nothing to archive about', async () => {
		// an unknown id and an already-archived form are the same answer to the screen that
		// asked — the list no longer shows it either way — and refusing the second is what keeps
		// a double-click from moving the timestamp that records when it happened.
		const made = await created(submitted());
		await archiveForm(db, made.id);
		const stamped = await rawColumn(made.id, 'archived_at');

		expect(await archiveForm(db, made.id)).toBe(false);
		expect(await archiveForm(db, 'frm_nosuchformatall')).toBe(false);
		expect(await rawColumn(made.id, 'archived_at')).toBe(stamped);
	});
});

describe('the checks under a form, which no parse stands in for', () => {
	it('refuses an inverted amount pair even when nothing in TypeScript is looking', async () => {
		// `parseFormInput` refuses this in front of the operator; this is the floor under a
		// hand-run `wrangler d1 execute`, which predates every line of that parser.
		await expect(
			env.DB.prepare(
				`insert into form
				   (id, name, status, revenue_account_id, currency, min_minor, max_minor,
				    created_at, updated_at)
				 values ('frm_invertedboundstest', 'Inverted', 'draft', ?, 'USD', 5000, 1000, 0, 0)`
			)
				.bind(revenueAccountId)
				.run()
		).rejects.toThrowError(/SQLITE_CONSTRAINT_CHECK/);
	});
});

// ---------------------------------------------------------------------------
// the cause a form's gifts are recorded against.
//
// the rule both writes below keep is one rule: nothing newly pins to a cause this deployment has
// retired. what happens after a form is pinned is the opposite — the pin stays, because the gifts
// already recorded against it still name it.
// ---------------------------------------------------------------------------

const WATER = 'prg_cleanwatertest01';
const GALA = 'prg_galatest000001';

describe('a form pinned to a cause', () => {
	it('stores the mode and the cause together', async () => {
		await insertProgram(WATER, 'Clean Water');
		const made = await created(submitted({ program_mode: 'pinned', program_id: WATER }));
		expect(made).toMatchObject({ programMode: 'pinned', programId: WATER });
		// past drizzle as well, because what a gift is credited to is the column.
		expect(await rawColumn(made.id, 'program_mode')).toBe('pinned');
		expect(await rawColumn(made.id, 'program_id')).toBe(WATER);
	});

	it('refuses a cause that has been retired, and writes nothing', async () => {
		// a retired cause is not offered to a form that is not already on one, and the screen draws
		// it out of the active list — so a body naming one is a stale tab. the foreign key cannot
		// answer it: the row is there, which is the whole reason a cause is archived rather than
		// deleted.
		await insertProgram(GALA, 'Gala 2024', true);
		expect(
			await createForm(db, submitted({ program_mode: 'pinned', program_id: GALA }))
		).toBeNull();
		expect((await readForms(db)).map((f) => f.name)).toEqual(['General Fund']);
	});

	it('refuses an id no cause answers to, rather than failing on the foreign key', async () => {
		// the key would refuse it too, as a constraint error and a 500. the answer is the same one
		// the archived case gets, because the screen can say one sentence about both.
		expect(
			await createForm(
				db,
				submitted({ program_mode: 'pinned', program_id: '019fb100-0000-7000-8000-00000000dead' })
			)
		).toBeNull();
	});

	it('keeps the pin when the cause is retired afterwards', async () => {
		// the asymmetry is the rule: nothing newly pins to a retired cause, and a form already on
		// one stays on it. the gifts it has taken name that cause, and a form silently unpinned is a
		// report that stops saying where the money went.
		await insertProgram(WATER, 'Clean Water');
		const made = await created(submitted({ program_mode: 'pinned', program_id: WATER }));
		await env.DB.prepare(`update program set status = 'archived', archived_at = 1 where id = ?`)
			.bind(WATER)
			.run();

		expect(await readForm(db, made.id)).toMatchObject({ programMode: 'pinned', programId: WATER });
	});
});

describe('updateFormProgram', () => {
	it('saves the pair, and clears the cause when the mode stops naming one', async () => {
		await insertProgram(WATER, 'Clean Water');
		expect(
			await updateFormProgram(
				db,
				PRIMARY_FORM_ID,
				programOf({ program_mode: 'pinned', program_id: WATER })
			)
		).toBe('saved');
		expect(await readForm(db, PRIMARY_FORM_ID)).toMatchObject({
			programMode: 'pinned',
			programId: WATER
		});

		expect(
			await updateFormProgram(
				db,
				PRIMARY_FORM_ID,
				programOf({ program_mode: 'choice', program_id: WATER })
			)
		).toBe('saved');
		// the id the hidden box still carried is dropped by the parse, so the column pair agrees —
		// `form_program_pinned_check` would refuse the row otherwise.
		expect(await readForm(db, PRIMARY_FORM_ID)).toMatchObject({
			programMode: 'choice',
			programId: null
		});
	});

	it('answers `unknown_program` for a cause that is retired or is not there', async () => {
		await insertProgram(GALA, 'Gala 2024', true);
		expect(
			await updateFormProgram(
				db,
				PRIMARY_FORM_ID,
				programOf({ program_mode: 'pinned', program_id: GALA })
			)
		).toBe('unknown_program');
		expect(
			await updateFormProgram(
				db,
				PRIMARY_FORM_ID,
				programOf({
					program_mode: 'pinned',
					program_id: '019fb100-0000-7000-8000-00000000dead'
				})
			)
		).toBe('unknown_program');
		expect(await readForm(db, PRIMARY_FORM_ID)).toMatchObject({ programMode: 'none' });
	});

	it('answers `gone` for a form that is missing or archived', async () => {
		// both are a tab that was open when somebody else retired the form, which is a sentence an
		// operator can act on rather than a 500.
		expect(await updateFormProgram(db, 'frm_nosuchformtest', programOf())).toBe('gone');

		await archiveForm(db, PRIMARY_FORM_ID);
		expect(await updateFormProgram(db, PRIMARY_FORM_ID, programOf())).toBe('gone');
	});

	it('touches no column outside its own group', async () => {
		await insertProgram(WATER, 'Clean Water');
		const before = await readForm(db, PRIMARY_FORM_ID);
		await updateFormProgram(
			db,
			PRIMARY_FORM_ID,
			programOf({ program_mode: 'pinned', program_id: WATER })
		);
		const after = await readForm(db, PRIMARY_FORM_ID);
		expect(after).toMatchObject({
			name: before?.name,
			status: before?.status,
			revenueAccountId: before?.revenueAccountId,
			minMinor: before?.minMinor,
			maxMinor: before?.maxMinor,
			allowedOrigins: before?.allowedOrigins
		});
	});
});
