/**
 * `pnpm run db:export --output ./backup.sql` — the books as one SQL file D1 can import again: the
 * whole schema, and every table's rows but the photos' bytes.
 *
 * the bytes are left out because a backup holding them cannot be restored. D1 refuses a statement
 * over 100,000 bytes, and an export writes each `image_bytes` row as one `INSERT` with the blob in
 * hex, twice its size — so any photo over about 50 KB is a `Statement too long` on the way back in,
 * with the books behind it in the same file
 * (https://developers.cloudflare.com/d1/best-practices/import-export-data/). photos have their own
 * export, ./db-photos.js, and DEPLOY.md → Backups names the pair. leaving them out also keeps the
 * export short: a running export blocks every other query on the database, gifts included.
 *
 * three wrangler calls, because no one export is this file. the table list is read off the live
 * database, so a table a migration adds is in the next backup with nothing here to change. the
 * schema is exported whole and on its own, because an export naming tables carries no index; the
 * rows are exported by name, every table but `image_bytes`. `composeBackup` below puts the
 * two in the order a restore can run.
 *
 * `image_bytes` keeps its table in the file, empty: `d1_migrations` records the migration that made
 * it, so a restore without it would be a database its own migrations believe is complete.
 *
 * no dependencies, on purpose: plain node.
 */

import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** the table the photos' bytes are in, exported by ./db-photos.js and never here. */
const PHOTO_TABLE = 'image_bytes';

/**
 * the tables whose rows the books carry, from every table the database has.
 *
 * `sqlite_*` are SQLite's own and `_cf_*` are D1's, and neither is a table a restore writes; the
 * rest is kept whatever its name, so a new table is backed up by default.
 *
 * @param {readonly string[]} names
 * @returns {string[]}
 */
export function booksTables(names) {
	return names.filter(
		(name) => name !== PHOTO_TABLE && !name.startsWith('sqlite_') && !name.startsWith('_cf_')
	);
}

/** the first statement of a schema export that would act on the restore's own inserts. */
const AFTER_ROWS = /^CREATE TRIGGER /;

/**
 * one importable file from a schema-only export and a rows-only one.
 *
 * the rows go after every table and index and before any trigger. an index goes first
 * because SQLite refuses a write to a parent table while a child's composite foreign key has no
 * unique index to point at (`line_item` into `account`); a trigger goes last because it would fire
 * on the restore's own inserts. refuses a schema with a table or an index after its first trigger,
 * since a row could then be written before what it needs exists.
 *
 * @param {string} schema
 * @param {string} rows
 * @returns {string}
 */
export function composeBackup(schema, rows) {
	const lines = schema.split('\n');
	const split = lines.findIndex((line) => AFTER_ROWS.test(line));
	const at = split === -1 ? lines.length : split;
	const tail = lines.slice(at);
	const late = tail.find((line) => /^CREATE (?:TABLE|UNIQUE INDEX|INDEX) /.test(line));
	if (late !== undefined) {
		throw new Error(`the schema export creates a table or an index after a trigger, at: ${late}`);
	}
	return `${[...lines.slice(0, at), rows.trimEnd(), ...tail].join('\n').trimEnd()}\n`;
}

/**
 * one `pnpm wrangler` call with the terminal attached, so wrangler's own prompt and progress reach
 * the operator; resolves on exit 0.
 *
 * @param {string[]} args
 * @returns {Promise<void>}
 */
function wrangler(args) {
	return new Promise((resolve, reject) => {
		const child = spawn('pnpm', ['wrangler', ...args], { stdio: 'inherit' });
		child.on('error', reject);
		child.on('exit', (code) =>
			code === 0 ? resolve() : reject(new Error(`wrangler ${args[0]} ${args[1]} exited ${code}`))
		);
	});
}

/**
 * every table the remote database has, by name.
 *
 * @param {string} database
 * @returns {Promise<string[]>}
 */
async function liveTables(database) {
	const { stdout } = await execFileAsync(
		'pnpm',
		[
			'--silent',
			'wrangler',
			'd1',
			'execute',
			database,
			'--remote',
			'--json',
			'--command',
			"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY rowid"
		],
		{ maxBuffer: 16 * 1024 * 1024 }
	);
	/** @type {[{ results: { name: string }[] }]} */
	const [answer] = JSON.parse(stdout);
	return answer.results.map((row) => row.name);
}

/** @param {string[]} argv */
async function main(argv) {
	const { positionals, values } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: { output: { type: 'string' } }
	});
	const [database] = positionals;
	if (database === undefined || values.output === undefined) {
		console.error('usage: node scripts/db-export.js <database> --output <file.sql>');
		return 1;
	}

	const tables = booksTables(await liveTables(database));
	const scratch = await mkdtemp(join(tmpdir(), 'better-giving-export-'));
	try {
		const schemaFile = join(scratch, 'schema.sql');
		const rowsFile = join(scratch, 'rows.sql');
		await wrangler(['d1', 'export', database, '--remote', '--no-data', '--output', schemaFile]);
		await wrangler([
			'd1',
			'export',
			database,
			'--remote',
			'--no-schema',
			...tables.flatMap((table) => ['--table', table]),
			'--output',
			rowsFile
		]);
		const [schema, rows] = await Promise.all([
			readFile(schemaFile, 'utf8'),
			readFile(rowsFile, 'utf8')
		]);
		await writeFile(values.output, composeBackup(schema, rows));
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
	console.error(`the books are in ${values.output}; the photos are \`pnpm run db:export:photos\`.`);
	return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
	process.exit(await main(process.argv.slice(2)));
