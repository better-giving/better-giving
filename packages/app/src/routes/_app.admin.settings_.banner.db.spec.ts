import type { Client, InStatement } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { IMAGE_BYTES_MAX, image } from '$lib/server/db/schema';
import { pngHeader } from '$lib/server/images/headers.testing';
import { putBanner, putLogo } from '$lib/server/org/logo.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import { deployedBindings, signInAsDeployer, signInAsMember } from '../staff-session.testing';
import * as layout from './_app';
import * as banner from './_app.admin.settings_.banner';
import { client, first, run, stmt } from '$lib/server/db/database.testing';

// the donation page's banner at its own address under Settings, against a real database, through
// the protected layout: an upload writes an image and its bytes, the banner it replaces is freed,
// and a photo no banner can be is refused before anything is stored.
//
// the two cases no single request provokes are provoked on the database itself: a write landing
// between the banner's read and the request's own write (`racedBy`), and the database refusing that
// write (a trigger).

const ORIGIN = 'https://give.example';
const ADDRESS = '/admin/settings/banner';
const PASSWORD = 'a-very-long-random-staff-password';
const DEPLOYMENT = { env: deployedBindings(PASSWORD), password: PASSWORD, origin: ORIGIN };

let db: Db;
let request: RouteRequester;
let deployer: string;

beforeAll(() => {
	db = createDb(client);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/settings/banner', module: banner }
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
 * the client with `competing` run just before the request's write: after the banner's read and
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

/** another writer putting a banner of its own on, stored outside the request under test. */
function anotherBanner(): Promise<string> {
	return putBanner(
		createDb(client),
		{ contentType: 'image/png', width: 1600, height: 400 },
		pngHeader(1600, 400)
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

const png = (width = 1600, height = 400) =>
	new Blob([pngHeader(width, height)], { type: 'image/png' });

type Answer = { banner?: { id: string; src: string } | null; error?: string; reason?: string };

async function answerOf(response: Response): Promise<Answer> {
	return (await response.json()) as Answer;
}

/** whether an image row with `id` is still stored. */
async function kept(id: string): Promise<boolean> {
	return (await db.$count(image, eq(image.id, id))) > 0;
}

/** the banner the profile names now. */
async function profileBanner(): Promise<string | null | undefined> {
	return (
		await first<{ banner_image_id: string | null }>(stmt('select banner_image_id from org_profile'))
	)?.banner_image_id;
}

describe('a banner posted from Settings', () => {
	it('is stored, put on the profile and answered at the address it is served from', async () => {
		const response = await upload(png());

		expect(response.status).toBe(200);
		const { banner: answered } = await answerOf(response);
		expect(answered).toEqual({ id: expect.any(String), src: `/image/${answered?.id}` });
		expect(await profileBanner()).toBe(answered?.id);
		const [row] = await db
			.select()
			.from(image)
			.where(eq(image.id, answered?.id ?? ''));
		expect(row).toMatchObject({ kind: 'photo', width: 1600, height: 400 });
	});
});

describe('a member’s session', () => {
	it('gets not-found for an upload and a removal, and neither changes the banner', async () => {
		const member = await signInAsMember(db, DEPLOYMENT);
		const before = await db.$count(image);

		expect((await upload(png(), client, member)).status).toBe(404);
		expect((await remove(client, member)).status).toBe(404);

		expect(await db.$count(image)).toBe(before);
		expect(await profileBanner()).toBeNull();
	});
});

describe('a banner replaced or taken off', () => {
	it('frees the banner it replaces', async () => {
		const replaced = (await answerOf(await upload(png()))).banner?.id ?? '';

		const second = (await answerOf(await upload(png(1200, 300)))).banner;

		expect(second?.id).not.toBe(replaced);
		expect(await kept(replaced)).toBe(false);
	});

	it('is cleared by DELETE, which frees it', async () => {
		const id = (await answerOf(await upload(png()))).banner?.id ?? '';

		const response = await remove();

		expect(response.status).toBe(200);
		expect((await answerOf(response)).banner).toBeNull();
		expect(await profileBanner()).toBeNull();
		expect(await kept(id)).toBe(false);
	});

	it('leaves the logo where it is', async () => {
		const logo = await putLogo(db, { contentType: 'image/png', width: 400, height: 400 });

		await upload(png());
		await remove();

		expect(await kept(logo)).toBe(true);
	});

	it('refuses a DELETE that lost a race, and frees nothing of the winner’s', async () => {
		await upload(png());
		let theirs = '';

		const response = await remove(
			racedBy(async () => {
				theirs = await anotherBanner();
			})
		);

		expect(response.status).toBe(409);
		expect((await answerOf(response)).error).toBe(
			'The banner changed while this was sent. Send it again.'
		);
		expect(await kept(theirs)).toBe(true);
	});
});

describe('a photo that is no banner', () => {
	it('names the width of one narrower than 1200, and stores nothing', async () => {
		const before = await db.$count(image);

		const response = await upload(png(900, 225));

		expect(response.status).toBe(400);
		expect((await answerOf(response)).error).toBe(
			'That image is only 900 pixels wide. A banner needs at least 1200. Choose a larger one.'
		);
		expect(await db.$count(image)).toBe(before);
		expect(await profileBanner()).toBeNull();
	});

	it('is refused off 4:1, and stores nothing', async () => {
		const before = await db.$count(image);

		const response = await upload(png(1600, 900));

		expect(response.status).toBe(400);
		expect((await answerOf(response)).error).toBe(
			'That image is not the banner’s shape. Crop it to 4 to 1 and save it again.'
		);
		expect(await db.$count(image)).toBe(before);
	});

	it('is refused wider than 1600', async () => {
		const response = await upload(png(2000, 500));

		expect(response.status).toBe(400);
		expect((await answerOf(response)).error).toContain('at most 1600 wide');
	});

	it('is refused as an SVG: the bytes are none of the three types', async () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400"/>';

		const response = await upload(new Blob([svg], { type: 'image/svg+xml' }));

		expect(response.status).toBe(400);
		expect((await answerOf(response)).error).toBe(
			'file is not a WebP, JPEG or PNG image: its first bytes are none of the three'
		);
	});

	it('names the cap when the photo is over it', async () => {
		const over = new Uint8Array(IMAGE_BYTES_MAX + 1);
		over.set(pngHeader(1600, 400));

		const response = await upload(new Blob([over], { type: 'image/png' }));

		expect(response.status).toBe(413);
	});
});

describe('a banner refused at the profile', () => {
	it('asks for the organisation’s details first where none are saved, and keeps no image', async () => {
		await run(stmt('delete from org_profile'));
		const before = await db.$count(image);

		const response = await upload(png());

		expect(response.status).toBe(409);
		expect((await answerOf(response)).error).toBe(
			'Save the organisation details first, then add the banner.'
		);
		expect(await db.$count(image)).toBe(before);
	});

	it('asks for it again when the banner changed while it was sent, and frees only its own upload', async () => {
		const replaced = (await answerOf(await upload(png()))).banner?.id ?? '';
		const before = await db.$count(image);
		let theirs = '';

		const response = await upload(
			png(1200, 300),
			racedBy(async () => {
				theirs = await anotherBanner();
			})
		);

		expect(response.status).toBe(409);
		expect((await answerOf(response)).error).toBe(
			'The banner changed while this was sent. Send it again.'
		);
		expect(await kept(theirs)).toBe(true);
		expect(await kept(replaced)).toBe(false);
		expect(await db.$count(image)).toBe(before);
	});

	it('leaves no image row behind where the database refuses the write, and answers a refusal', async () => {
		await run(
			stmt(`create trigger refuse_banner before update on org_profile
			 when new.banner_image_id is not null
			 begin select raise(abort, 'banner refused'); end`)
		);
		const before = await db.$count(image);
		try {
			const response = await upload(png());

			expect(response.status).toBe(500);
			expect(await answerOf(response)).toEqual({
				error: 'the banner was not stored; send it again',
				reason: 'failed'
			});
			expect(await db.$count(image)).toBe(before);
		} finally {
			await run(stmt('drop trigger refuse_banner'));
		}
	});
});
