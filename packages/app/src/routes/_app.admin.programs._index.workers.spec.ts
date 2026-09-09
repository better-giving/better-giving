import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { CREATED_FLASH, redirectWithFlash } from '$lib/server/flash';
import { insertProgram, ORIGIN, signIn } from '../program-routes.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as list from './_app.admin.programs._index';

// a workers spec because every case here reads a row. the chain is mounted rather than the loader
// called, which is ../route-request.testing.ts's pattern: the session gate is a `middleware` on
// ./_app.tsx, so a loader called on its own is a loader with the gate above it never run.

const LIST = '/admin/programs';

let db: Db;
let request: RouteRequester;
let session: string;

beforeAll(async () => {
	db = createDb(env.DB);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/programs', module: list }
	]);
	session = await signIn(db);
});

beforeEach(async () => {
	await env.DB.prepare('delete from form').run();
	await env.DB.prepare('delete from program').run();
});

/** what the screen is handed, off one request through the chain the deployment serves it under. */
type Loaded = {
	created: { id: string; name: string } | null;
	programs: { id: string; name: string; description: string | null; status: string }[];
};

async function load(flash = ''): Promise<Loaded> {
	const cookie = [session, flash].filter((value) => value !== '').join('; ');
	const response = await request(new Request(`${ORIGIN}${LIST}`, { headers: { cookie } }), { env });
	expect(response.status).toBe(200);
	return (await response.json()) as Loaded;
}

/** a marker left for this address, as the pair a browser sends back. */
async function markerFor(marker: string): Promise<string> {
	const sent = await redirectWithFlash(
		new Request(`${ORIGIN}${LIST}`),
		CREATED_FLASH,
		LIST,
		marker
	);
	const header = sent.headers.get('Set-Cookie');
	if (header === null) throw new Error('the redirect wrote no cookie');
	return header.split(';')[0] ?? '';
}

describe('/admin/programs load', () => {
	it('has nothing on a deployment that has named no cause', async () => {
		expect((await load()).programs).toEqual([]);
	});

	it('lists the active causes first, each set by name', async () => {
		// an operator reading the causes they can still pin should not have to skip past the ones
		// they cannot. written out of alphabetical order and with the archived one first, so neither
		// insertion order nor `created_at` could produce this list by accident.
		await insertProgram({ id: 'prg_gala0000000001', name: 'Gala', archived: true });
		await insertProgram({ id: 'prg_shelter000001', name: 'Shelter' });
		await insertProgram({ id: 'prg_water00000001', name: 'Clean Water' });

		expect((await load()).programs.map((p) => p.name)).toEqual(['Clean Water', 'Shelter', 'Gala']);
	});

	it('publishes the status as the value rather than as a word', async () => {
		// `PROGRAM_STATUS_LABELS` is importable by a component, so the page puts words to it and
		// there is one copy of them.
		await insertProgram({ id: 'prg_gala0000000001', name: 'Gala', archived: true });
		expect((await load()).programs[0]?.status).toBe('archived');
	});

	it('names the cause a create just made, once, and never its id', async () => {
		// taking the marker is what clears it: a second GET of the list announces nothing. matched
		// against the rows rather than rendered, so an id nothing answers to puts no text on screen.
		const id = await insertProgram({ id: 'prg_water00000001', name: 'Clean Water' });
		expect((await load(await markerFor(id))).created).toEqual({ id, name: 'Clean Water' });
		expect((await load()).created).toBeNull();
	});

	it('reports nothing for a marker no row answers to', async () => {
		expect((await load(await markerFor('prg_nosuchcause01'))).created).toBeNull();
	});
});
