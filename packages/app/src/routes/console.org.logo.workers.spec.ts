import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgReading } from '@better-giving/operator/console/org';
import {
	CONSOLE_SESSION_SECONDS,
	CONSOLE_TOKEN_MIN_RANDOM,
	formatConsoleToken
} from '@better-giving/operator/console/token';
import { createDb, type Db } from '$lib/server/db/client';
import { IMAGE_BYTES_MAX, image } from '$lib/server/db/schema';
import { pngHeader } from '$lib/server/images/headers.testing';
import { mountRoutes } from '../route-request.testing';
import * as org from './console.org';
import * as logo from './console.org.logo';
import * as surface from './console';

// the console's logo address, against a real D1: an upload writes an image and its bytes, and the
// logo it replaces is freed. mounted through the surface's own layout, which is what puts the
// credential check in front of it (../route-request.testing.ts).
//
// the logo write is stood in for in the cases no single request can provoke: a write landing
// between its read and its own, and D1 failing under it.

const race = vi.hoisted(() => ({ stale: false, throws: false }));

vi.mock('$lib/server/org/queries', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/org/queries')>();
	return {
		...actual,
		setOrgProfileLogo: async (...args: Parameters<typeof actual.setOrgProfileLogo>) => {
			if (race.throws) throw new Error('D1 is unreachable');
			return race.stale ? 'stale' : actual.setOrgProfileLogo(...args);
		},
		removeOrgProfileLogo: async (...args: Parameters<typeof actual.removeOrgProfileLogo>) =>
			race.stale ? 'stale' : actual.removeOrgProfileLogo(...args)
	};
});

const OWN = 'https://give.example.workers.dev';
const TOKEN = formatConsoleToken(
	new Date(Math.floor((Date.now() + CONSOLE_SESSION_SECONDS * 1000) / 1000) * 1000),
	'z'.repeat(CONSOLE_TOKEN_MIN_RANDOM)
);

const routes = mountRoutes([
	{ path: 'console', module: surface },
	{ path: 'org', module: org },
	{ path: 'logo', module: logo }
]);

/** the pool's env with this deployment's console session on it, as a proxy for the reason ./console.workers.spec.ts's `envWith` gives. */
const bindings = new Proxy(env, {
	get: (target, property) => (property === 'CONSOLE_TOKEN' ? TOKEN : Reflect.get(target, property))
}) as Env;

function remove(): Promise<Response> {
	return routes(
		new Request(`${OWN}/console/org/logo`, {
			method: 'DELETE',
			headers: { authorization: `Bearer ${TOKEN}` }
		}),
		{ env: bindings }
	);
}

function upload(file: Blob | string): Promise<Response> {
	const body = new FormData();
	body.set('file', file);
	return routes(
		new Request(`${OWN}/console/org/logo`, {
			method: 'POST',
			headers: { authorization: `Bearer ${TOKEN}` },
			body
		}),
		{ env: bindings }
	);
}

const png = (width = 400, height = 200) =>
	new Blob([pngHeader(width, height)], { type: 'image/png' });

async function orgOf(response: Response): Promise<OrgReading> {
	return ((await response.json()) as { org: OrgReading }).org;
}

let db: Db;

/** whether an image row with `id` is still stored. */
async function kept(id: string): Promise<boolean> {
	return (await db.$count(image, eq(image.id, id))) > 0;
}

/** the 422 the console draws, read down to the sentence under the logo box. */
async function logoRefusal(response: Response): Promise<string | undefined> {
	expect(response.status).toBe(422);
	return ((await response.json()) as { errors: { logo?: string } }).errors.logo;
}

beforeEach(async () => {
	race.stale = false;
	race.throws = false;
	db = createDb(env.DB);
	await env.DB.prepare('delete from org_profile').run();
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, address_line1, city, country, created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789', '1 Main St', 'Springfield', 'US', 0, 0)`
	).run();
});

describe('a logo posted to the console', () => {
	it('is stored, put on the profile and answered in the report at its absolute address', async () => {
		const response = await upload(png());

		expect(response.status).toBe(200);
		const { logo: answered } = await orgOf(response);
		expect(answered).toEqual({ id: expect.any(String), url: `${OWN}/image/${answered?.id}` });
		const [row] = await db
			.select()
			.from(image)
			.where(eq(image.id, answered?.id ?? ''));
		expect(row).toMatchObject({ kind: 'photo', width: 400, height: 200 });
	});
});

describe('a logo replaced or taken off', () => {
	it('frees the logo it replaces', async () => {
		const first = (await orgOf(await upload(png()))).logo?.id ?? '';

		const second = (await orgOf(await upload(png(300, 300)))).logo;

		expect(second?.id).not.toBe(first);
		expect(await kept(first)).toBe(false);
	});

	it('is cleared by DELETE, which frees it', async () => {
		const id = (await orgOf(await upload(png()))).logo?.id ?? '';

		const response = await remove();

		expect(response.status).toBe(200);
		expect((await orgOf(response)).logo).toBeNull();
		expect(await kept(id)).toBe(false);
	});

	it('refuses a DELETE that lost a race, keyed at the logo', async () => {
		race.stale = true;
		expect(await logoRefusal(await remove())).toBe(
			'The logo changed while this was sent. Send it again.'
		);
	});
});

describe('a logo the console refuses at the logo box', () => {
	it('names the cap when the photo is over it, and stores nothing', async () => {
		const before = await db.$count(image);
		const over = new Uint8Array(IMAGE_BYTES_MAX + 1);
		over.set(pngHeader(400, 200));

		expect(await logoRefusal(await upload(new Blob([over], { type: 'image/png' })))).toBe(
			`file is ${IMAGE_BYTES_MAX + 1} bytes; a photo is at most ${IMAGE_BYTES_MAX} bytes (1.9 MB) once resized`
		);
		expect(await db.$count(image)).toBe(before);
	});

	it('names the three types when the bytes are no image, and stores nothing', async () => {
		const before = await db.$count(image);

		expect(await logoRefusal(await upload(new Blob(['a logo'], { type: 'image/png' })))).toBe(
			'file is not a WebP, JPEG or PNG image: its first bytes are none of the three'
		);
		expect(await db.$count(image)).toBe(before);
	});

	it('names the pixel cap when the photo is past it', async () => {
		expect(await logoRefusal(await upload(png(4097, 100)))).toContain('4096 pixels');
	});

	it('asks for the legal name first where no profile is saved, and keeps no image', async () => {
		await env.DB.prepare('delete from org_profile').run();
		const before = await db.$count(image);

		expect(await logoRefusal(await upload(png()))).toBe(
			'Save the organisation’s legal name first, then add the logo.'
		);
		expect(await db.$count(image)).toBe(before);
	});

	it('asks for it again when the logo changed while it was sent, and keeps no image', async () => {
		const before = await db.$count(image);
		race.stale = true;

		expect(await logoRefusal(await upload(png()))).toBe(
			'The logo changed while this was sent. Send it again.'
		);
		expect(await db.$count(image)).toBe(before);
	});
});

it('keeps no image when putting the logo on throws', async () => {
	const before = await db.$count(image);
	race.throws = true;

	await upload(png()).catch(() => undefined);

	expect(await db.$count(image)).toBe(before);
});
