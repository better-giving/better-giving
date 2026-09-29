import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { exportPhotos, restorePhotos } from './db-photos.js';

// the photo backup against a local D1 with every migration applied, through the same binding
// shape the script holds on a deployment's database: wrangler's platform proxy.

const APP = join(import.meta.dirname, '..');

/** @type {string} */
let scratch;
/** @type {import('./db-photos.js').PhotoDb} */
let db;
/** @type {() => Promise<void>} */
let dispose;

beforeAll(async () => {
	scratch = await mkdtemp(join(tmpdir(), 'better-giving-photos-'));
	const state = join(scratch, 'state');
	await promisify(execFile)(
		'pnpm',
		['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state],
		{ cwd: APP }
	);
	const config = join(scratch, 'wrangler.json');
	await writeFile(
		config,
		JSON.stringify({
			name: 'photo-backup-spec',
			d1_databases: [{ binding: 'DB', database_name: 'better-giving' }]
		})
	);
	const proxy = await getPlatformProxy({
		configPath: config,
		persist: { path: join(state, 'v3') },
		remoteBindings: false
	});
	db = /** @type {{ DB: import('./db-photos.js').PhotoDb }} */ (proxy.env).DB;
	dispose = proxy.dispose;
}, 60_000);

afterAll(async () => {
	await dispose?.();
	await rm(scratch, { recursive: true, force: true });
});

/**
 * a stored photo of `size` random bytes, as `createImage` would leave it.
 *
 * @param {string} id
 * @param {number} size
 */
async function storedPhoto(id, size) {
	const bytes = new Uint8Array(randomBytes(size));
	const now = Date.now();
	await db
		.prepare(
			'INSERT INTO image (id, kind, content_type, width, height, byte_size, created_at, updated_at) VALUES (?, ?, ?, 4, 3, ?, ?, ?)'
		)
		.bind(id, 'photo', 'image/webp', size, now, now)
		.run();
	await db.prepare('INSERT INTO image_bytes (image_id, bytes) VALUES (?, ?)').bind(id, bytes).run();
	return bytes;
}

describe('the photo backup', () => {
	it('restores a photo past the statement limit, byte for byte, from the files it wrote', async () => {
		const id = '01890000-0000-7000-8000-0000000000b1';
		const original = await storedPhoto(id, 150_000);
		const out = join(scratch, 'photos');

		await exportPhotos(db, out);
		await db.prepare('DELETE FROM image_bytes WHERE image_id = ?').bind(id).run();
		const report = await restorePhotos(db, out);

		expect(await readdir(out)).toContain(`${id}.webp`);
		expect(new Uint8Array(await readFile(join(out, `${id}.webp`)))).toEqual(original);
		const row = await db
			.prepare('SELECT bytes FROM image_bytes WHERE image_id = ?')
			.bind(id)
			.first();
		expect(new Uint8Array(/** @type {ArrayBuffer} */ (row?.bytes))).toEqual(original);
		expect(report.restored).toEqual([id]);
		expect(report.refused).toEqual([]);
	});

	it('leaves a photo already stored as it is, so a restore that stopped can be run again', async () => {
		const id = '01890000-0000-7000-8000-0000000000b2';
		const original = await storedPhoto(id, 60_000);
		const out = join(scratch, 'again');
		await exportPhotos(db, out);

		const report = await restorePhotos(db, out);

		expect(report.present).toContain(id);
		expect(report.restored).toEqual([]);
		const row = await db
			.prepare('SELECT bytes FROM image_bytes WHERE image_id = ?')
			.bind(id)
			.first();
		expect(new Uint8Array(/** @type {ArrayBuffer} */ (row?.bytes))).toEqual(original);
	});

	it('refuses and names a photo whose image the database does not have', async () => {
		const id = '01890000-0000-7000-8000-0000000000b3';
		const out = join(scratch, 'orphan');
		await mkdir(out);
		await writeFile(join(out, `${id}.png`), randomBytes(64));

		const report = await restorePhotos(db, out);

		expect(report).toEqual({ restored: [], present: [], refused: [id] });
		expect(
			await db.prepare('SELECT 1 FROM image_bytes WHERE image_id = ?').bind(id).first()
		).toBeNull();
	});
});
