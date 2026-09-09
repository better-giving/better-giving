import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { parseProgramInput, type ParsedProgram } from './program-input';
import {
	archiveProgram,
	createProgram,
	readActivePrograms,
	readProgram,
	readPrograms,
	updateProgram
} from './queries';

// real D1 inside workerd, over the committed migrations — so the unique index on `name`, the
// not-blank check and `STRICT` are the deployed ones rather than a schema rebuilt from a
// snapshot.
//
// the `program` table object is not imported here. every read and write of it lives in
// ./queries.ts, and the two probes that reach past drizzle do it through `env.DB` on purpose: a
// unique index is a property of the database, and a timestamp backdated for a test is a write no
// query in this module offers.

let db: Db;

/**
 * a submission that parses, which is the only thing the writes below take.
 *
 * the brand is what makes them hard to skip — a hand-built literal of the same shape does not
 * compile — so a fixture goes through the parser the actions go through.
 */
function input(name: string, description: string | null = null): ParsedProgram {
	const result = parseProgramInput({ name, description: description ?? '' });
	if (!result.ok) throw new Error(`fixture did not parse: ${JSON.stringify(result.errors)}`);
	return result.value;
}

/**
 * a create that must have landed, so a case about anything else is not also asserting that.
 *
 * `createProgram` answers `null` for a name another cause already carries, which is its one
 * refusal — every case that is not about that one goes through here.
 */
async function made(name: string, description: string | null = null) {
	const row = await createProgram(db, input(name, description));
	if (row === null) throw new Error(`the fixture cause \`${name}\` was refused as a repeat`);
	return row;
}

/**
 * how many programs the committed `migrations/` leave behind, read before any test writes one.
 *
 * a program is an organisation's own cause and no fork shares one, so the migrations seed none —
 * the same reason `migrations/` seeds no form. captured rather than assumed, because a seeded row
 * would silently change what every ordering assertion below is reading.
 */
let programsAfterMigrating: number;

beforeAll(async () => {
	// the request-path constructor, not a fixture: what these tests exercise is what `requestDb`
	// builds for every request (src/request-context.ts).
	db = createDb(env.DB);
	const count = await env.DB.prepare('select count(*) as n from program').first<{ n: number }>();
	programsAfterMigrating = count?.n ?? -1;
});

// storage is isolated per file rather than per test, so a program written by one `it` is visible
// to the next. every case starts from an empty table.
beforeEach(async () => {
	await env.DB.prepare('delete from program').run();
});

it('the migrations seed no program, so a deployment starts with none', () => {
	expect(programsAfterMigrating).toBe(0);
});

describe('createProgram', () => {
	it('stores the two values it is given and opens the program active', async () => {
		const created = await made('Clean Water', 'Wells in the eastern districts.');
		expect(created).toMatchObject({
			name: 'Clean Water',
			description: 'Wells in the eastern districts.',
			status: 'active',
			archivedAt: null
		});
		expect(created.id).not.toBe('');
	});

	it('accepts no description, which is the normal state', async () => {
		const created = await made('General');
		expect(created.description).toBeNull();
	});

	it('refuses a second program with a name one already carries', async () => {
		// the index is what makes a program list something staff can read: two rows called
		// "Clean Water" are two funds nobody can tell apart on a form's picker or in a report,
		// and the pair is only ever distinguishable by an id no screen shows.
		await made('Clean Water');
		// `null` and no row, read off the index rather than off a read in front of the insert: D1
		// has no transaction, so a check-then-write would be two commits with a race between them.
		expect(await createProgram(db, input('Clean Water', 'a second one'))).toBeNull();
		expect(await readPrograms(db)).toHaveLength(1);
	});

	it('refuses a name that differs from a stored one only in its capitals', async () => {
		// the index compares `collate nocase`, so "Clean water" and "Clean Water" are one name. a
		// picker, the gifts table and a receipt render nothing but the name, so the pair would be
		// two causes a reader has no way to tell apart — which is the failure a byte-for-byte index
		// leaves open.
		await made('Clean water');
		expect(await createProgram(db, input('Clean Water'))).toBeNull();
		expect(await readPrograms(db)).toHaveLength(1);
	});
});

describe('readProgram', () => {
	it('hands back the program that was stored', async () => {
		const created = await made('Clean Water', 'wells');
		expect(await readProgram(db, created.id)).toEqual(created);
	});

	it('answers null for an id no program carries', async () => {
		expect(await readProgram(db, '019fb100-0000-7000-8000-00000000dead')).toBeNull();
	});

	it('still finds an archived program, unlike the active list', async () => {
		// the same split `readForm` and `readForms` draw: "that cause was retired" and "there is
		// no such cause" are different sentences, and a gift already recorded against an archived
		// program still has to render its name.
		const created = await made('Gala 2024');
		await archiveProgram(db, created.id);
		expect(await readProgram(db, created.id)).toMatchObject({ status: 'archived' });
	});
});

describe('readPrograms', () => {
	it('lists the active ones first, each set by name', async () => {
		// written out of alphabetical order and with the archived one made first, so neither
		// insertion order nor `created_at` could produce this list by accident.
		const gala = await made('Gala');
		await made('Shelter');
		await made('Clean Water');
		await archiveProgram(db, gala.id);

		expect((await readPrograms(db)).map((p) => p.name)).toEqual(['Clean Water', 'Shelter', 'Gala']);
	});

	it('carries the archived ones with their status and timestamp, not merely their names', async () => {
		const gala = await made('Gala');
		await archiveProgram(db, gala.id);
		const [row] = await readPrograms(db);
		expect(row).toMatchObject({ name: 'Gala', status: 'archived' });
		expect(row?.archivedAt).toBeInstanceOf(Date);
	});
});

describe('readActivePrograms', () => {
	it('leaves an archived program out, and names only what a picker renders', async () => {
		const gala = await made('Gala', 'not for donors');
		const water = await made('Clean Water', 'wells');
		await archiveProgram(db, gala.id);

		// the whole row is not returned and that is the claim: this list is served to a donor,
		// and a description staff wrote for themselves is not a donor-facing string.
		expect(await readActivePrograms(db)).toEqual([{ id: water.id, name: 'Clean Water' }]);
	});

	it('is empty on a deployment whose causes are all retired', async () => {
		const gala = await made('Gala');
		await archiveProgram(db, gala.id);
		expect(await readActivePrograms(db)).toEqual([]);
	});
});

describe('updateProgram', () => {
	it('writes both values and moves `updated_at`', async () => {
		// `updated_at` is unix ms, so a create and an update inside one millisecond carry one
		// value and a plain `>` would be flaky. the row is backdated first, which makes the
		// assertion about `$onUpdateFn` firing rather than about how fast the test ran.
		const created = await made('Clean Water');
		await env.DB.prepare('update program set updated_at = 0 where id = ?').bind(created.id).run();

		expect(await updateProgram(db, created.id, input('Water', 'wells'))).toBe('saved');

		const after = await readProgram(db, created.id);
		expect(after).toMatchObject({ name: 'Water', description: 'wells' });
		expect(after?.updatedAt.getTime()).toBeGreaterThan(0);
	});

	it('refuses a name another cause already carries, and writes nothing', async () => {
		// the same index `createProgram` answers off, read the same way: two rows called "Clean
		// Water" are two funds nobody can tell apart on a form's picker or in a report.
		await made('Clean Water');
		const gala = await made('Gala');

		expect(await updateProgram(db, gala.id, input('Clean Water'))).toBe('duplicate_name');
		expect(await readProgram(db, gala.id)).toMatchObject({ name: 'Gala' });
	});

	it('refuses a rename that differs from another cause only in its capitals', async () => {
		await made('Clean water');
		const gala = await made('Gala');

		expect(await updateProgram(db, gala.id, input('Clean Water'))).toBe('duplicate_name');
		expect(await readProgram(db, gala.id)).toMatchObject({ name: 'Gala' });
	});

	it('lets a cause keep its own name while its description changes', async () => {
		// the index is over one column, so a row rewriting its own name is not a repeat of itself —
		// worth pinning, because a guard written as a read in front of the write would say it is.
		const water = await made('Clean Water', 'wells');
		expect(await updateProgram(db, water.id, input('Clean Water', 'wells in the east'))).toBe(
			'saved'
		);
	});

	it('reports an unknown id instead of writing anything', async () => {
		expect(await updateProgram(db, '019fb100-0000-7000-8000-00000000dead', input('Water'))).toBe(
			'gone'
		);
	});

	it('refuses an archived program, which no write here can bring back', async () => {
		// `archived_at` is cleared by nothing in this module, so an update that landed on a
		// retired row would leave a program `readActivePrograms` hides and `archiveProgram`
		// answers `false` about, renamed by somebody who thought they had restored it.
		const created = await made('Gala');
		await archiveProgram(db, created.id);

		expect(await updateProgram(db, created.id, input('Gala 2025'))).toBe('gone');
		expect(await readProgram(db, created.id)).toMatchObject({ name: 'Gala' });
	});
});

describe('archiveProgram', () => {
	it('sets the status and the timestamp together, in one statement', async () => {
		// two representations of one fact, and D1 has no interactive transaction to put two
		// statements inside: a program holding one without the other reads retired on a screen
		// and active to `readActivePrograms`.
		const created = await made('Gala');
		expect(await archiveProgram(db, created.id)).toBe(true);

		const row = await readProgram(db, created.id);
		expect(row?.status).toBe('archived');
		expect(row?.archivedAt).toBeInstanceOf(Date);
	});

	it('answers false for an id no program carries, and writes nothing', async () => {
		await made('Clean Water');
		expect(await archiveProgram(db, '019fb100-0000-7000-8000-00000000dead')).toBe(false);
		expect(await readActivePrograms(db)).toHaveLength(1);
	});

	it('answers false the second time, so a double press cannot move the timestamp', async () => {
		const created = await made('Gala');
		await archiveProgram(db, created.id);
		const first = (await readProgram(db, created.id))?.archivedAt;

		expect(await archiveProgram(db, created.id)).toBe(false);
		expect((await readProgram(db, created.id))?.archivedAt).toEqual(first);
	});

	it('does not delete the row, because a gift points at it forever', async () => {
		// the reason there is no `deleteProgram` at all: `donation.program_id` and
		// `form.program_id` both name this table, so a hard delete is either a broken pointer or
		// a gift that stops saying where it went.
		const created = await made('Gala');
		await archiveProgram(db, created.id);
		expect(await readPrograms(db)).toHaveLength(1);
	});
});
