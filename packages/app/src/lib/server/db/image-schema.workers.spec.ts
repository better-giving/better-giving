import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// the checks `image` carries, each a table rebuild to change once shipped, and the keys pointing at
// an image from `org_presentation` and `program`. `STRICT` and `NO ACTION` on every key are read off
// sqlite's catalogue by ./strict.workers.spec.ts, and the bytes' length check is held by
// ../images/bytes.workers.spec.ts.

type ImageRow = {
	kind: string;
	content_type: string;
	width: number;
	height: number;
	byte_size: number;
	alt: string | null;
};

const PHOTO: ImageRow = {
	kind: 'photo',
	content_type: 'image/webp',
	width: 1600,
	height: 900,
	byte_size: 120_000,
	alt: null
};

async function insertImage(row: ImageRow): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`insert into image (id, kind, content_type, width, height, byte_size, alt, created_at, updated_at)
		 values (?, ?, ?, ?, ?, ?, ?, 0, 0)`
	)
		.bind(id, row.kind, row.content_type, row.width, row.height, row.byte_size, row.alt)
		.run();
	return id;
}

/** the message D1 rejected `fn`'s statement with; throws when it was accepted. */
async function rejection(fn: () => Promise<unknown>): Promise<string> {
	try {
		await fn();
	} catch (e) {
		return String((e as Error).message);
	}
	throw new Error('expected D1 to reject this statement, but it succeeded');
}

describe('image', () => {
	it.each([
		['with no alt, as a decorative image', null],
		['with alt text', 'volunteers sorting coats']
	])('takes a photo %s', async (_, alt) => {
		await expect(insertImage({ ...PHOTO, alt })).resolves.toBeTypeOf('string');
	});

	it('takes an illustration', async () => {
		await expect(insertImage({ ...PHOTO, kind: 'illustration' })).resolves.toBeTypeOf('string');
	});

	it.each([
		['a kind outside the set', { kind: 'logo' }],
		['a content type outside the set', { content_type: 'image/gif' }],
		['a zero width', { width: 0 }],
		['a negative height', { height: -1 }],
		['a zero height', { height: 0 }],
		['a zero byte size', { byte_size: 0 }],
		['an empty alt', { alt: '' }],
		['a whitespace-only alt', { alt: ' \t\n' }]
	] satisfies [string, Partial<ImageRow>][])('refuses %s', async (_, change) => {
		expect(await rejection(() => insertImage({ ...PHOTO, ...change }))).toContain(
			'SQLITE_CONSTRAINT_CHECK'
		);
	});
});

const SQLITE_CONSTRAINT_FOREIGNKEY = 'SQLITE_CONSTRAINT_FOREIGNKEY';

const MISSING_IMAGE = '019fc700-0000-7000-8000-00000000dead';

let programSequence = 0;

/** a program pointing at `imageId`. */
async function insertProgram(imageId: string | null) {
	programSequence += 1;
	await env.DB.prepare(
		`insert into program (id, name, image_id, created_at, updated_at) values (?, ?, ?, 0, 0)`
	)
		.bind(crypto.randomUUID(), `cause ${programSequence}`, imageId)
		.run();
}

/** the one `org_presentation` row, with `column` set to `imageId`. */
async function setOrgImage(column: string, imageId: string | null) {
	await env.DB.prepare(
		`insert into org_presentation (id, ${column}, created_at, updated_at)
		 values ('default', ?, 0, 0)
		 on conflict (id) do update set ${column} = excluded.${column}`
	)
		.bind(imageId)
		.run();
}

// that each image is a `photo` is not a constraint here: a check reads only its own row, and the
// kind is on the image's. the write path holds it.
describe.each([
	['the logo', (id: string | null) => setOrgImage('logo_image_id', id)],
	['the logo kept for undo', (id: string | null) => setOrgImage('logo_image_id_previous', id)],
	["a program's photo", insertProgram]
])('%s', (_, point) => {
	it('takes an image that exists', async () => {
		await expect(point(await insertImage(PHOTO))).resolves.toBeUndefined();
	});

	it('takes none', async () => {
		await expect(point(null)).resolves.toBeUndefined();
	});

	it('refuses an image that does not exist', async () => {
		const message = await rejection(() => point(MISSING_IMAGE));
		expect(message).toContain(SQLITE_CONSTRAINT_FOREIGNKEY);
	});
});
