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

const manifest = JSON.parse(readFileSync(join(ROOT, 'bg-design.json'), 'utf8')) as Manifest;

function mismatches(manifestRoot: string, dir: string, files: Record<string, string>) {
	return Object.entries(files).flatMap(([file, recorded]) => {
		const path = join(manifestRoot, dir, file);
		if (!existsSync(path)) return [`${file}: listed in bg-design.json but missing`];
		const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
		return actual === recorded ? [] : [`${file}: edited (sha256 ${actual}, recorded ${recorded})`];
	});
}

// the reverse of mismatches: a file on disk the manifest does not list is a hand-added file that
// reads as registry truth, and an empty manifest would hash nothing and pass.
function unlisted(manifestRoot: string, dir: string, files: Record<string, string>) {
	const base = join(manifestRoot, dir);
	const onDisk = globSync('**/*', { cwd: base, exclude: () => false })
		.filter((f) => statSync(join(base, f)).isFile())
		.map((f) => f.split(sep).join('/'));
	return [
		...onDisk
			.filter((f) => !(f in files))
			.map((f) => `${f}: on disk but not listed in bg-design.json`),
		...Object.keys(files)
			.filter((f) => !onDisk.includes(f))
			.map((f) => `${f}: listed in bg-design.json but missing`)
	].sort();
}

describe('the files copied from the design registry', () => {
	const files = Object.assign({}, ...Object.values(manifest.items).map((item) => item.files));

	it('are the whole tree under the manifest dir, no more and no fewer', () => {
		expect(unlisted(ROOT, manifest.dir, files)).toEqual([]);
	});

	it('are byte for byte what bg-design.json recorded', () => {
		expect(mismatches(ROOT, manifest.dir, files)).toEqual([]);
	});

	it('names a listed file that is not on disk', () => {
		expect(mismatches(ROOT, manifest.dir, { 'styles/no-such-file.css': '0'.repeat(64) })).toEqual([
			'styles/no-such-file.css: listed in bg-design.json but missing'
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
			expect(unlisted(dir, '.', {})).toHaveLength(2);
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
