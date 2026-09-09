import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WHICH_FORM } from '$lib/forms/definition';
import { createDb, type Db } from '$lib/server/db/client';
import { CREATED_FLASH, takeFlash } from '$lib/server/flash';
import { readPrograms } from '$lib/server/programs/queries';
import { insertProgram, ORIGIN, signIn } from '../program-routes.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as create from './_app.admin.programs.new';

// a workers spec because making a cause writes a row. the chain is mounted rather than the action
// called, because reading the body exactly once is one of the things this route owes CLAUDE.md and
// a direct call would run it with the gate above it never run.

const NEW = '/admin/programs/new';
const LIST = '/admin/programs';

let db: Db;
let request: RouteRequester;
let session: string;

beforeAll(async () => {
	db = createDb(env.DB);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/programs/new', module: create }
	]);
	session = await signIn(db);
});

beforeEach(async () => {
	await env.DB.prepare('delete from form').run();
	await env.DB.prepare('delete from program').run();
});

/** what a rejected save hands back, off the response the deployment would send. */
type Failure = {
	status: number;
	valid: boolean;
	errors: Record<string, string[]>;
	message?: string;
};

/** what a save that went through hands back: a redirect and the marker riding on it. */
type Redirected = { status: number; location: string | null; cookie: string | null };

/** a body as this screen's markup writes it, naming the form it was submitted from. */
async function save(
	fields: Record<string, string> = { name: 'Clean Water', description: 'Wells in the east.' }
): Promise<{ redirect?: Redirected; failure?: Failure }> {
	const body = new FormData();
	body.set(WHICH_FORM, 'program-create');
	for (const [field, value] of Object.entries(fields)) body.set(field, value);

	const response = await request(
		new Request(`${ORIGIN}${NEW}`, { method: 'POST', headers: { cookie: session }, body }),
		{ env }
	);

	if (response.status === 303) {
		return {
			redirect: {
				status: response.status,
				location: response.headers.get('Location'),
				cookie: response.headers.get('Set-Cookie')
			}
		};
	}

	const answered = (await response.json()) as {
		form: { result: { status?: string; error?: Record<string, string[]> } };
	};
	const keyed = answered.form.result.error ?? {};
	const banner = keyed['']?.at(-1);
	return {
		failure: {
			status: response.status,
			valid: answered.form.result.status !== 'error',
			errors: Object.fromEntries(Object.entries(keyed).filter(([field]) => field !== '')),
			...(banner === undefined ? {} : { message: banner })
		}
	};
}

describe('/admin/programs/new save', () => {
	it('stores the cause as it was typed, and opens it active', async () => {
		await save();
		expect(await readPrograms(db)).toMatchObject([
			{ name: 'Clean Water', description: 'Wells in the east.', status: 'active' }
		]);
	});

	it('stores a cause with no description as none, which is what the column holds', async () => {
		// `program_description_not_blank_check` refuses `''`, so a box left empty has to reach the
		// column as null rather than as the empty string it submitted.
		await save({ name: 'General', description: '' });
		expect((await readPrograms(db))[0]?.description).toBeNull();
	});

	it('redirects to the list, so a reload does not make a second cause', async () => {
		// POST-redirect-GET: a re-post of a create is not an overwrite, it is another row.
		const { redirect } = await save();
		expect(redirect?.status).toBe(303);
		// the address carries nothing: the id that names the row travels in a one-shot cookie.
		expect(redirect?.location).toBe(LIST);
	});

	it('leaves the new cause’s id for the list, at the list’s own address', async () => {
		const { redirect } = await save();
		const [stored] = await readPrograms(db);

		const held = redirect?.cookie?.split(';')[0] ?? '';
		const taken = await takeFlash(
			new Request(`${ORIGIN}${LIST}`, { headers: { cookie: held } }),
			CREATED_FLASH
		);
		expect(taken?.marker).toBe(stored?.id);
		// and the header that came back with it is what burns it.
		expect(taken?.clear).toMatch(/max-age=0\b/i);
	});

	it('refuses a name another cause already carries, under the box holding it', async () => {
		// no schema can say it: what names are taken is a table, and the schema runs in a browser
		// too. the index answers it rather than a read in front of the insert.
		await insertProgram({ id: 'prg_water00000001', name: 'Clean Water' });
		const { failure } = await save({ name: 'Clean Water', description: 'a second one' });
		expect(failure?.status).toBe(400);
		expect(failure?.errors.name?.at(-1)).toBe('A program with this name already exists.');
		expect(await readPrograms(db)).toHaveLength(1);
	});

	it('refuses the name a retired cause still carries, because the index keeps it', async () => {
		// a retired cause keeps its name: the gifts recorded against it still render it, so letting
		// a new one take the name would make one word mean two causes inside one report.
		await insertProgram({ id: 'prg_gala0000000001', name: 'Gala', archived: true });
		const { failure } = await save({ name: 'Gala', description: '' });
		expect(failure?.errors.name?.at(-1)).toBe('A program with this name already exists.');
	});

	it('refuses a blank name and leaves nothing behind', async () => {
		const { failure } = await save({ name: '  ', description: '' });
		expect(failure?.status).toBe(400);
		expect(failure?.errors.name).toHaveLength(1);
		expect(await readPrograms(db)).toEqual([]);
	});

	it('refuses a body that never carried the name box at all', async () => {
		// every stated box must arrive (`$lib/server/conform.ts`), so a hand-built body missing one
		// is turned down before the schema fills anything in.
		const { failure } = await save({ description: 'wells' });
		expect(failure?.status).toBe(400);
		expect(failure?.valid).toBe(false);
		expect(await readPrograms(db)).toEqual([]);
	});
});
