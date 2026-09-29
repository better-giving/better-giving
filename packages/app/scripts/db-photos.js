/**
 * `pnpm run db:export:photos --output ./photos` and `pnpm run db:restore:photos --input ./photos` —
 * the photos' bytes, as one file per photo, and back.
 *
 * the books backup (./db-export.js) leaves `image_bytes` out, and this is the other half. no SQL file
 * can carry a photo back into D1: a statement is refused past 100,000 bytes, a blob written into one
 * as a literal is twice its size in hex, and a photo is up to `IMAGE_BYTES_MAX` in
 * ../src/lib/server/db/schema.ts. a bound parameter does not count toward that limit, so the
 * restore binds the bytes, and binding needs a D1 binding rather than a SQL file: this holds one on
 * the remote database through wrangler's own platform proxy, signed in as `pnpm run login` is.
 *
 * a file is named by its image's id, with the stored type's subtype as the extension so the folder
 * opens as pictures. the restore reads the id off the name and nothing else: the type is the one the
 * `image` row already holds.
 *
 * run the books restore first. a photo is written only under an `image` row with its id, the same
 * rule `putBytes` in ../src/lib/server/images/bytes.ts keeps, so a photo with no row is refused and
 * named rather than stored under nothing. a photo already stored is left as it is — the bytes under
 * an id never change — so a restore that stopped part way is finished by running it again.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { getPlatformProxy } from 'wrangler';

const execFileAsync = promisify(execFile);

/**
 * the part of a D1 binding this reads and writes through.
 *
 * @typedef {{
 *   bind(...values: unknown[]): PhotoStatement,
 *   first(): Promise<Record<string, unknown> | null>,
 *   run(): Promise<{ meta: { changes: number } }>,
 *   all(): Promise<{ results: Record<string, unknown>[] }>
 * }} PhotoStatement
 * @typedef {{ prepare(sql: string): PhotoStatement }} PhotoDb
 */

/**
 * writes every stored photo into `dir` as `<id>.<subtype>`, one read per photo so no answer holds
 * more than one photo's bytes.
 *
 * @param {PhotoDb} db
 * @param {string} dir
 * @returns {Promise<number>} how many photos were written
 */
export async function exportPhotos(db, dir) {
	await mkdir(dir, { recursive: true });
	const { results } = await db.prepare('SELECT image_id FROM image_bytes ORDER BY image_id').all();
	for (const { image_id: id } of results) {
		const row = await db
			.prepare(
				'SELECT b.bytes, i.content_type FROM image_bytes b JOIN image i ON i.id = b.image_id WHERE b.image_id = ?'
			)
			.bind(id)
			.first();
		if (row === null) throw new Error(`photo ${id} was listed and then not found`);
		const subtype = String(row.content_type).split('/')[1];
		await writeFile(
			join(dir, `${id}.${subtype}`),
			new Uint8Array(/** @type {ArrayBuffer} */ (row.bytes))
		);
	}
	return results.length;
}

/**
 * stores every photo file in `dir` under the image its name names.
 *
 * @param {PhotoDb} db
 * @param {string} dir
 * @returns {Promise<{ restored: string[], present: string[], refused: string[] }>} ids by outcome:
 *   stored now, stored already, and refused for having no `image` row
 */
export async function restorePhotos(db, dir) {
	/** @type {{ restored: string[], present: string[], refused: string[] }} */
	const report = { restored: [], present: [], refused: [] };
	const names = (await readdir(dir)).filter((name) => !name.startsWith('.')).sort();
	for (const name of names) {
		const id = name.slice(0, name.length - extname(name).length);
		const bytes = new Uint8Array(await readFile(join(dir, name)));
		const { meta } = await db
			.prepare(
				'INSERT INTO image_bytes (image_id, bytes) SELECT id, ? FROM image WHERE id = ? ON CONFLICT (image_id) DO NOTHING'
			)
			.bind(bytes, id)
			.run();
		if (meta.changes === 1) {
			report.restored.push(id);
			continue;
		}
		const stored = await db
			.prepare('SELECT 1 FROM image_bytes WHERE image_id = ?')
			.bind(id)
			.first();
		(stored === null ? report.refused : report.present).push(id);
	}
	return report;
}

/**
 * the remote database's binding, and how to let it go.
 *
 * the proxy is handed a config of its own naming the database by id, marked remote: the app's
 * wrangler.jsonc names it by name only and binds it locally in dev.
 *
 * @param {string} database
 * @returns {Promise<{ db: PhotoDb, dispose: () => Promise<void> }>}
 */
async function remoteDatabase(database) {
	const { stdout } = await execFileAsync('pnpm', [
		'--silent',
		'wrangler',
		'd1',
		'info',
		database,
		'--json'
	]);
	/** @type {{ uuid: string }} */
	const { uuid } = JSON.parse(stdout);
	const scratch = await mkdtemp(join(tmpdir(), 'better-giving-photos-'));
	const configPath = join(scratch, 'wrangler.json');
	await writeFile(
		configPath,
		JSON.stringify({
			name: 'better-giving-photos',
			d1_databases: [{ binding: 'DB', database_name: database, database_id: uuid, remote: true }]
		})
	);
	const proxy = await getPlatformProxy({ configPath, persist: false });
	return {
		db: /** @type {{ DB: PhotoDb }} */ (proxy.env).DB,
		dispose: async () => {
			await proxy.dispose();
			await rm(scratch, { recursive: true, force: true });
		}
	};
}

/** @param {string[]} argv */
async function main(argv) {
	const { positionals, values } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: { output: { type: 'string' }, input: { type: 'string' } }
	});
	const [command, database] = positionals;
	const dir = command === 'export' ? values.output : values.input;
	if (
		database === undefined ||
		dir === undefined ||
		(command !== 'export' && command !== 'restore')
	) {
		console.error('usage: node scripts/db-photos.js export <database> --output <dir>');
		console.error('       node scripts/db-photos.js restore <database> --input <dir>');
		return 1;
	}

	const { db, dispose } = await remoteDatabase(database);
	try {
		if (command === 'export') {
			console.error(`${await exportPhotos(db, dir)} photos written to ${dir}.`);
			return 0;
		}
		const { restored, present, refused } = await restorePhotos(db, dir);
		console.error(`${restored.length} photos restored, ${present.length} already there.`);
		if (refused.length === 0) return 0;
		console.error(
			`${refused.length} refused, because the database has no image with its id; restore the books backup first (DEPLOY.md → Backups):`
		);
		for (const id of refused) console.error(`  ${id}`);
		return 1;
	} finally {
		await dispose();
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url))
	process.exit(await main(process.argv.slice(2)));
