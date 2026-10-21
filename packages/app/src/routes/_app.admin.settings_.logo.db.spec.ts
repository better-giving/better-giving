import type { Client, InStatement } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { IMAGE_BYTES_MAX, image } from '$lib/server/db/schema';
import { pngHeader } from '$lib/server/images/headers.testing';
import { putLogo } from '$lib/server/org/logo.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import { deployedBindings, signInAsDeployer, signInAsMember } from '../staff-session.testing';
import * as layout from './_app';
import * as logo from './_app.admin.settings_.logo';
import { client, first, run, stmt } from '$lib/server/db/database.testing';

// the logo's own address under Settings, against a real database, through the protected layout:
// an upload writes an image and its bytes, and the logo it replaces is freed.
//
// the two cases no single request provokes are provoked on the database itself: a write landing
// between the logo's read and the request's own write (`racedBy`), and the database refusing that
// write (a trigger).

const ORIGIN = 'https://give.example';
const ADDRESS = '/admin/settings/logo';
const PASSWORD = 'a-very-long-random-staff-password';
const DEPLOYMENT = { env: deployedBindings(PASSWORD), password: PASSWORD, origin: ORIGIN };

let db: Db;
let request: RouteRequester;
let deployer: string;

beforeAll(() => {
	db = createDb(client);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/settings/logo', module: logo }
	]);
});

beforeEach(async () => {
	for (const table of ['auth_member_invitation', 'auth_session', 'auth_user', 'org_profile']) {
		await run(stmt(`delete from ${table}`));
	}
	await run(
		stmt(`insert into org_profile (id, legal_name, tax_id, address_line1, city, country, created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789', '1 Main St', 'Springfield', 'US', 0, 0)`)
	);
	deployer = await signInAsDeployer(db, DEPLOYMENT);
});

/**
 * the client with `competing` run just before the request's write: after the logo's read and
 * before the request's own `batch()`, which is the one batch the write sends. the session gate in
 * front of it batches nothing.
 */
function racedBy(competing: () => Promise<unknown>): Client {
	let raced = false;
	return new Proxy(client, {
		get(target, property) {
			if (property === 'batch') {
				return async (statements: InStatement[], mode?: Parameters<Client['batch']>[1]) => {
					if (!raced) {
						raced = true;
						await competing();
					}
					return target.batch(statements, mode);
				};
			}
			const value = Reflect.get(target, property, target);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
}

/** another writer putting a logo of its own on, stored outside the request under test. */
function anotherLogo(): Promise<string> {
	return putLogo(
		createDb(client),
		{ contentType: 'image/png', width: 100, height: 100 },
		pngHeader(100, 100)
	);
}

function remove(on: Client = client, cookie: string = deployer): Promise<Response> {
	return request(
		new Request(`${ORIGIN}${ADDRESS}`, { method: 'DELETE', headers: { cookie, origin: ORIGIN } }),
		{ env: DEPLOYMENT.env, client: on }
	);
}

function upload(file: Blob | string, on: Client = client, cookie: string = deployer) {
	const body = new FormData();
	body.set('file', file);
	return request(
		new Request(`${ORIGIN}${ADDRESS}`, {
			method: 'POST',
			headers: { cookie, origin: ORIGIN },
			body
		}),
		{ env: DEPLOYMENT.env, client: on }
	);
}

const png = (width = 400, height = 200) =>
	new Blob([pngHeader(width, height)], { type: 'image/png' });

type Answer = { logo?: { id: string; src: string } | null; error?: string; reason?: string };

async function answerOf(response: Response): Promise<Answer> {
	return (await response.json()) as Answer;
}

/** whether an image row with `id` is still stored. */
async function kept(id: string): Promise<boolean> {
	return (await db.$count(image, eq(image.id, id))) > 0;
}

/** the logo the profile names now. */
async function profileLogo(): Promise<string | null | undefined> {
	return (
		await first<{ logo_image_id: string | null }>(stmt('select logo_image_id from org_profile'))
	)?.logo_image_id;
}

describe('a member’s session', () => {
	it('gets not-found for an upload and a removal, and neither changes the logo', async () => {
		const member = await signInAsMember(db, DEPLOYMENT);
		const before = await db.$count(image);

		expect((await upload(png(), client, member)).status).toBe(404);
		expect((await remove(client, member)).status).toBe(404);

		expect(await db.$count(image)).toBe(before);
		expect(await profileLogo()).toBeNull();
	});
});

describe('a logo posted from Settings', () => {
	it('is stored, put on the profile and answered at the address it is served from', async () => {
		const response = await upload(png());

		expect(response.status).toBe(200);
		const { logo: answered } = await answerOf(response);
		expect(answered).toEqual({ id: expect.any(String), src: `/image/${answered?.id}` });
		expect(await profileLogo()).toBe(answered?.id);
		const [row] = await db
			.select()
			.from(image)
			.where(eq(image.id, answered?.id ?? ''));
		expect(row).toMatchObject({ kind: 'photo', width: 400, height: 200 });
	});
});

describe('a logo replaced or taken off', () => {
	it('frees the logo it replaces', async () => {
		const replaced = (await answerOf(await upload(png()))).logo?.id ?? '';

		const second = (await answerOf(await upload(png(300, 300)))).logo;

		expect(second?.id).not.toBe(replaced);
		expect(await kept(replaced)).toBe(false);
	});

	it('is cleared by DELETE, which frees it', async () => {
		const id = (await answerOf(await upload(png()))).logo?.id ?? '';

		const response = await remove();

		expect(response.status).toBe(200);
		expect((await answerOf(response)).logo).toBeNull();
		expect(await profileLogo()).toBeNull();
		expect(await kept(id)).toBe(false);
	});

	it('refuses a DELETE that lost a race, and frees nothing of the winner’s', async () => {
		await upload(png());
		let theirs = '';

		const response = await remove(
			racedBy(async () => {
				theirs = await anotherLogo();
			})
		);

		expect(response.status).toBe(409);
		expect((await answerOf(response)).error).toBe(
			'The logo changed while this was sent. Send it again.'
		);
		expect(await kept(theirs)).toBe(true);
	});
});

describe('a logo refused at the logo', () => {
	it('names the cap when the photo is over it, and stores nothing', async () => {
		const before = await db.$count(image);
		const over = new Uint8Array(IMAGE_BYTES_MAX + 1);
		over.set(pngHeader(400, 200));

		const response = await upload(new Blob([over], { type: 'image/png' }));

		expect(response.status).toBe(413);
		expect((await answerOf(response)).error).toBe(
			`file is ${IMAGE_BYTES_MAX + 1} bytes; a photo is at most ${IMAGE_BYTES_MAX} bytes (1.9 MB) once resized`
		);
		expect(await db.$count(image)).toBe(before);
	});

	it('names the three types when the bytes are no image, and stores nothing', async () => {
		const before = await db.$count(image);

		const response = await upload(new Blob(['a logo'], { type: 'image/png' }));

		expect(response.status).toBe(400);
		expect((await answerOf(response)).error).toBe(
			'file is not a WebP, JPEG or PNG image: its first bytes are none of the three'
		);
		expect(await db.$count(image)).toBe(before);
	});

	it('names the pixel cap when the photo is past it', async () => {
		expect((await answerOf(await upload(png(4097, 100)))).error).toContain('4096 pixels');
	});

	it('asks for the organisation’s details first where none are saved, and keeps no image', async () => {
		await run(stmt('delete from org_profile'));
		const before = await db.$count(image);

		const response = await upload(png());

		expect(response.status).toBe(409);
		expect((await answerOf(response)).error).toBe(
			'Save the organisation details first, then add the logo.'
		);
		expect(await db.$count(image)).toBe(before);
	});

	it('asks for it again when the logo changed while it was sent, and frees only its own upload', async () => {
		const replaced = (await answerOf(await upload(png()))).logo?.id ?? '';
		const before = await db.$count(image);
		let theirs = '';

		const response = await upload(
			png(300, 300),
			racedBy(async () => {
				theirs = await anotherLogo();
			})
		);

		expect(response.status).toBe(409);
		expect((await answerOf(response)).error).toBe(
			'The logo changed while this was sent. Send it again.'
		);
		expect(await kept(theirs)).toBe(true);
		expect(await kept(replaced)).toBe(false);
		expect(await db.$count(image)).toBe(before);
	});
});

describe('a logo the database refuses mid-write', () => {
	/** runs `send` with every write putting a logo on refused, the image rows ahead of it included. */
	async function refusingTheLogo(send: () => Promise<Response>): Promise<Response> {
		await run(
			stmt(`create trigger refuse_logo before update on org_profile
			 when new.logo_image_id is not null
			 begin select raise(abort, 'logo refused'); end`)
		);
		try {
			return await send();
		} finally {
			await run(stmt('drop trigger refuse_logo'));
		}
	}

	it('leaves no image row behind, and answers a refusal rather than a thrown error', async () => {
		const before = await db.$count(image);

		const response = await refusingTheLogo(() => upload(png()));

		expect(response.status).toBe(500);
		expect(await answerOf(response)).toEqual({
			error: 'the logo was not stored; send it again',
			reason: 'failed'
		});
		expect(await db.$count(image)).toBe(before);
	});
});
