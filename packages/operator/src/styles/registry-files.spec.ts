import { createHash } from 'node:crypto';
import {
	existsSync,
	globSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// holds the files copied from the design registry to the sha256 each one has in bg-design.json, with
// no network. `pnpm design:check` (scripts/design-check.mjs) also compares with the registry
// itself, but it needs the network and is not part of `pnpm test`, so without this a hand edit of a
// copied file is read as truth by every other spec in this package.

const ROOT = new URL('../../../../', import.meta.url).pathname;

type Manifest = { dir: string; items: Record<string, { files: Record<string, string> }> };

// every lock the repo keeps: the root's, and each package's own (packages/form's holds the donation
// form's copies). each names its own `dir` from the repo root.
const lockPaths = [
	'bg-design.json',
	...globSync('packages/*/bg-design.json', { cwd: ROOT }).map((p) => p.split(sep).join('/'))
].sort();

const locks = lockPaths.map((lock) => {
	const manifest = JSON.parse(readFileSync(join(ROOT, lock), 'utf8')) as Manifest;
	const files = Object.assign({}, ...Object.values(manifest.items).map((item) => item.files));
	return { lock, dir: manifest.dir, files: files as Record<string, string> };
});

function mismatches(
	manifestRoot: string,
	dir: string,
	files: Record<string, string>,
	lock = 'bg-design.json'
) {
	return Object.entries(files).flatMap(([file, recorded]) => {
		const path = join(manifestRoot, dir, file);
		if (!existsSync(path)) return [`${file}: listed in ${lock} but missing`];
		const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
		return actual === recorded ? [] : [`${file}: edited (sha256 ${actual}, recorded ${recorded})`];
	});
}

// the reverse of mismatches: a file on disk the manifest does not list is a hand-added file that
// reads as registry truth, and an empty manifest would hash nothing and pass.
function unlisted(
	manifestRoot: string,
	dir: string,
	files: Record<string, string>,
	lock = 'bg-design.json'
) {
	const base = join(manifestRoot, dir);
	const onDisk = globSync('**/*', { cwd: base, exclude: () => false })
		.filter((f) => statSync(join(base, f)).isFile())
		.map((f) => f.split(sep).join('/'));
	return [
		...onDisk
			.filter((f) => !(f in files))
			.map((f) => `${f}: on disk but not listed in ${lock}`),
		...Object.keys(files)
			.filter((f) => !onDisk.includes(f))
			.map((f) => `${f}: listed in ${lock} but missing`)
	].sort();
}

describe('the files copied from the design registry', () => {
	// a lock the glob stops finding would leave its copies unchecked and every case below green.
	it('finds the root lock and at least one package lock', () => {
		expect(locks.length).toBeGreaterThanOrEqual(2);
		expect(locks.map(({ lock }) => lock)).toContain('bg-design.json');
		expect(locks.every(({ files }) => Object.keys(files).length > 0)).toBe(true);
	});

	it.each(locks)(
		'$lock: are the whole tree under its dir, no more and no fewer',
		({ lock, dir, files }) => {
			expect(unlisted(ROOT, dir, files, lock)).toEqual([]);
		}
	);

	it.each(locks)('$lock: are byte for byte what it recorded', ({ lock, dir, files }) => {
		expect(mismatches(ROOT, dir, files, lock)).toEqual([]);
	});

	it('names a listed file that is not on disk', () => {
		const root = locks.find(({ lock }) => lock === 'bg-design.json');
		if (!root) throw new Error('the root lock bg-design.json was not found');
		// the case only proves something if the lookup reached the root lock's real copy folder.
		expect(statSync(join(ROOT, root.dir)).isDirectory()).toBe(true);
		const missing = { 'styles/no-such-file.css': '0'.repeat(64) };
		expect(mismatches(ROOT, root.dir, missing)).toEqual([
			'styles/no-such-file.css: listed in bg-design.json but missing'
		]);
		// the message names the lock it was given, not a fixed one.
		expect(mismatches(ROOT, root.dir, missing, 'packages/form/bg-design.json')).toEqual([
			'styles/no-such-file.css: listed in packages/form/bg-design.json but missing'
		]);
	});

	it('names a file on disk the manifest does not list, and an empty manifest', () => {
		const dir = mkdtempSync(join(tmpdir(), 'registry-tree-'));
		try {
			mkdirSync(join(dir, 'sub'));
			writeFileSync(join(dir, 'a.css'), 'a');
			writeFileSync(join(dir, 'sub', 'b.css'), 'b');
			expect(unlisted(dir, '.', { 'a.css': '0', 'sub/b.css': '0' })).toEqual([]);
			expect(unlisted(dir, '.', { 'a.css': '0' })).toEqual([
				'sub/b.css: on disk but not listed in bg-design.json'
			]);
			expect(unlisted(dir, '.', {})).toEqual([
				'a.css: on disk but not listed in bg-design.json',
				'sub/b.css: on disk but not listed in bg-design.json'
			]);
			const formLock = 'packages/form/bg-design.json';
			expect(unlisted(dir, '.', { 'a.css': '0' }, formLock)).toEqual([
				'sub/b.css: on disk but not listed in packages/form/bg-design.json'
			]);
			const withGone = { 'a.css': '0', 'sub/b.css': '0', 'gone.css': '0' };
			expect(unlisted(dir, '.', withGone)).toEqual([
				'gone.css: listed in bg-design.json but missing'
			]);
			expect(unlisted(dir, '.', withGone, formLock)).toEqual([
				'gone.css: listed in packages/form/bg-design.json but missing'
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('names a file whose bytes differ from the recorded hash', () => {
		const dir = mkdtempSync(join(tmpdir(), 'registry-files-'));
		try {
			writeFileSync(join(dir, 'a.css'), 'a');
			const recorded = createHash('sha256').update('a').digest('hex');
			expect(mismatches(dir, '.', { 'a.css': recorded })).toEqual([]);
			writeFileSync(join(dir, 'a.css'), 'a ');
			expect(mismatches(dir, '.', { 'a.css': recorded })).toEqual([
				expect.stringContaining('a.css: edited')
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
