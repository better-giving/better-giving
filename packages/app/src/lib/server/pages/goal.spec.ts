import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on "a campaign's raised figure is a `SUM` at read time, never stored and never cached"
// (./goal.ts's header, CLAUDE.md → Bans → the ledger and → Storage). a source scan over the read and
// the module that hands it to the page: a cache or a stored total added to either would still pass
// every case in ./goal.workers.spec.ts, because a fresh isolate reads through any cache the first
// time.

const GOAL = readFileSync(resolve(import.meta.dirname, 'goal.ts'), 'utf8');
const LEDGER = readFileSync(resolve(import.meta.dirname, '../ledger/queries.ts'), 'utf8');

/** `readRaisedThroughForm`'s own text, from its signature to its closing brace. */
function readerBody(): string {
	const start = LEDGER.indexOf('export async function readRaisedThroughForm(');
	const end = LEDGER.indexOf('\n}\n', start);
	if (start < 0 || end < 0) throw new Error('readRaisedThroughForm is not in ../ledger/queries.ts');
	return LEDGER.slice(start, end);
}

/** the specifiers a module's `import`s name. */
function importsOf(source: string): string[] {
	return [...source.matchAll(/^import[^;]*?from '([^']+)';/gms)].map((match) => match[1] ?? '');
}

/** a cache, a KV namespace, or a write of any row: what would make the figure outlive the read. */
const OUTLIVES_THE_READ =
	/\bcaches\b|\bcache\.|edgeCache|KVNamespace|\.put\(|\binsert\b|\bupdate\b|\.batch\(/i;

describe("a campaign's raised figure", () => {
	it('reaches for no cache module', () => {
		const imported = importsOf(GOAL);
		expect(imported).toContain('../ledger/queries');
		expect(imported.filter((specifier) => /cache/i.test(specifier))).toEqual([]);
	});

	it('is read with nothing that would keep it past the read', () => {
		expect(
			GOAL.split('\n').filter((line) => !line.startsWith('//') && OUTLIVES_THE_READ.test(line))
		).toEqual([]);
		expect(readerBody()).toContain('sum(');
		expect(
			readerBody()
				.split('\n')
				.filter((line) => OUTLIVES_THE_READ.test(line))
		).toEqual([]);
	});
});
