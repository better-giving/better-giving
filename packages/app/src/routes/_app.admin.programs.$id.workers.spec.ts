import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WHICH_FORM } from '$lib/forms/definition';
import { createDb, type Db } from '$lib/server/db/client';
import { readProgram } from '$lib/server/programs/queries';
import { insertProgram, ORIGIN, signIn } from '../program-routes.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as editor from './_app.admin.programs.$id';

// a workers spec because every case here reads or writes a row. the chain is mounted rather than
// the loader or the action called, which is ../route-request.testing.ts's pattern: the session gate
// is a `middleware` on ./_app.tsx, so either called on its own runs with the gate above it never
// run.

/** the cause every case below is about. */
const PROGRAM_ID = 'prg_water00000001';
const SCREEN = `/admin/programs/${PROGRAM_ID}`;

const DETAILS_FORM = 'program-edit';
const ARCHIVE_FORM = 'program-archive';

let db: Db;
let request: RouteRequester;
let session: string;

beforeAll(async () => {
	db = createDb(env.DB);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/programs/:id', module: editor }
	]);
	session = await signIn(db);
});

beforeEach(async () => {
	await env.DB.prepare('delete from form').run();
	await env.DB.prepare('delete from program').run();
	await insertProgram({ id: PROGRAM_ID, name: 'Clean Water', description: 'Wells in the east.' });
});

/** what the screen is handed, off one request through the chain the deployment serves it under. */
type Loaded = {
	id: string;
	name: string;
	description: string | null;
	status: string;
	archived: boolean;
	editor: { name: string; description: string } | null;
	saved: 'details' | null;
	archivedJustNow: boolean;
	confirmArchive: boolean;
};

function visit(options: { id?: string; query?: string; flash?: string } = {}): Promise<Response> {
	const { id = PROGRAM_ID, query = '', flash = '' } = options;
	const cookie = [session, flash].filter((value) => value !== '').join('; ');
	return request(new Request(`${ORIGIN}/admin/programs/${id}${query}`, { headers: { cookie } }), {
		env
	});
}

async function load(options: Parameters<typeof visit>[0] = {}): Promise<Loaded> {
	const response = await visit(options);
	expect(response.status).toBe(200);
	return (await response.json()) as Loaded;
}

type Failure = {
	status: number;
	valid: boolean;
	errors: Record<string, string[]>;
	message?: string;
};
type Redirected = { status: number; location: string | null; cookie: string | null };

async function post(
	form: string,
	fields: Record<string, string> = {},
	id = PROGRAM_ID
): Promise<{ redirect?: Redirected; failure?: Failure }> {
	const body = new FormData();
	body.set(WHICH_FORM, form);
	for (const [field, value] of Object.entries(fields)) body.set(field, value);

	const response = await request(
		new Request(`${ORIGIN}/admin/programs/${id}`, {
			method: 'POST',
			headers: { cookie: session },
			body
		}),
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

/** the cookie pair a redirect handed the browser, ready to send back on the next request. */
function held(cookie: string | null | undefined): string {
	return cookie?.split(';')[0] ?? '';
}

/** retires the cause past the queries, so the thing under test is not what set it up. */
async function archiveInPlace(): Promise<void> {
	await env.DB.prepare(`update program set archived_at = 1, status = 'archived' where id = ?`)
		.bind(PROGRAM_ID)
		.run();
}

describe('/admin/programs/[id] load', () => {
	it('seeds the boxes from the row, with the description as text rather than null', async () => {
		// `null` is the column and `''` is the box: a box seeded from `null` would show the word.
		const loaded = await load();
		expect(loaded.editor).toEqual({ name: 'Clean Water', description: 'Wells in the east.' });
	});

	it('opens with no message under any box, on a cause nobody has typed into', async () => {
		// a form seeded from a record reports no error until it is submitted: messages reach a form
		// only through the result an action returned (`$lib/admin/use-admin-form.ts`).
		const loaded = await load();
		expect(loaded.saved).toBeNull();
		expect(loaded.archivedJustNow).toBe(false);
	});

	it('draws a record rather than an editor once the cause is archived', async () => {
		// `updateProgram` refuses an archived row at its `where`, so a box here would be one whose
		// button never works — and there is no un-archive.
		await archiveInPlace();
		const loaded = await load();
		expect(loaded.archived).toBe(true);
		expect(loaded.editor).toBeNull();
		expect(loaded.status).toBe('archived');
	});

	it('answers a 404 naming the id for a cause that is not there', async () => {
		// a wrong id in the address bar is a typo or a stale bookmark rather than a broken
		// deployment, so the sentence names it and points at the list.
		const response = await visit({ id: 'prg_nosuchcause01' });
		expect(response.status).toBe(404);
		expect(await response.text()).toContain('/admin/programs');
	});

	it('offers the archive confirmation only from the address that asks for it', async () => {
		expect((await load()).confirmArchive).toBe(false);
		expect((await load({ query: '?confirm=archive' })).confirmArchive).toBe(true);
	});

	it('never offers it for a cause that is already archived', async () => {
		// the action would refuse it, so a panel asking about it is a question with one wrong answer.
		await archiveInPlace();
		expect((await load({ query: '?confirm=archive' })).confirmArchive).toBe(false);
	});
});

describe('/admin/programs/[id] save', () => {
	it('writes both values and redirects back naming its own section', async () => {
		const { redirect } = await post(DETAILS_FORM, { name: 'Water', description: 'wells' });
		expect(redirect?.status).toBe(303);
		expect(redirect?.location).toBe(SCREEN);
		expect(await readProgram(db, PROGRAM_ID)).toMatchObject({
			name: 'Water',
			description: 'wells'
		});

		// the marker is what lights the button that did the write, and it is read once.
		expect((await load({ flash: held(redirect?.cookie) })).saved).toBe('details');
		expect((await load()).saved).toBeNull();
	});

	it('refuses a name another cause already carries, under the box holding it', async () => {
		await insertProgram({ id: 'prg_gala0000000001', name: 'Gala' });
		const { failure } = await post(DETAILS_FORM, { name: 'Gala', description: '' });
		expect(failure?.status).toBe(400);
		expect(failure?.errors.name?.at(-1)).toBe('A program with this name already exists.');
		expect(await readProgram(db, PROGRAM_ID)).toMatchObject({ name: 'Clean Water' });
	});

	it('lets a cause keep its own name while its description changes', async () => {
		// the index is over one column, so a row rewriting its own name is not a repeat of itself.
		const { redirect } = await post(DETAILS_FORM, {
			name: 'Clean Water',
			description: 'wells in the east'
		});
		expect(redirect?.status).toBe(303);
		expect(await readProgram(db, PROGRAM_ID)).toMatchObject({ description: 'wells in the east' });
	});

	it('says the row has gone rather than writing an archived cause back into shape', async () => {
		// nothing in this app clears `archived_at`, so an update that landed on a retired cause
		// would leave one renamed by somebody who believed they had brought it back.
		await archiveInPlace();
		const { failure } = await post(DETAILS_FORM, { name: 'Water', description: '' });
		expect(failure?.status).toBe(400);
		expect(failure?.message).toContain('archived');
		expect(await readProgram(db, PROGRAM_ID)).toMatchObject({ name: 'Clean Water' });
	});
});

describe('/admin/programs/[id] archive', () => {
	it('sets the status and the timestamp together, and reports where it lands', async () => {
		const { redirect } = await post(ARCHIVE_FORM);
		expect(redirect?.status).toBe(303);
		expect(redirect?.location).toBe(SCREEN);

		const row = await readProgram(db, PROGRAM_ID);
		expect(row?.status).toBe('archived');
		expect(row?.archivedAt).not.toBeNull();

		const landed = await load({ flash: held(redirect?.cookie) });
		expect(landed.archivedJustNow).toBe(true);
		// the archive's marker is no section, so it lights no save button.
		expect(landed.saved).toBeNull();
	});

	it('refuses a second press rather than moving the timestamp', async () => {
		await post(ARCHIVE_FORM);
		const before = (await readProgram(db, PROGRAM_ID))?.archivedAt;

		const { failure } = await post(ARCHIVE_FORM);
		expect(failure?.status).toBe(400);
		expect(failure?.message).toContain('already archived');
		expect((await readProgram(db, PROGRAM_ID))?.archivedAt).toEqual(before);
	});

	it('does not delete the row, because a gift points at it forever', async () => {
		await post(ARCHIVE_FORM);
		expect(await readProgram(db, PROGRAM_ID)).not.toBeNull();
	});

	it('refuses a body naming no form on this screen', async () => {
		// the body has to say which of this screen's two submissions it is: picking one by guessing
		// is picking which columns to replace.
		const body = new FormData();
		body.set('name', 'Water');
		const response = await request(
			new Request(`${ORIGIN}${SCREEN}`, {
				method: 'POST',
				headers: { cookie: session },
				body
			}),
			{ env }
		);
		expect(response.status).toBe(400);
		expect(await response.text()).toContain(WHICH_FORM);
	});
});
