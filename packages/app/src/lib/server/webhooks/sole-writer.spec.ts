import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on "only ./events.ts inserts into `webhook_delivery`, and only ./deliver.ts writes its
// outcomes".
//
// written the way ../zapier/sole-writer.spec.ts is, and for the same kind of rule: a row an event
// owes a destination is minted by ./events.ts inside the batch of the change it reports, and moved
// along by ./deliver.ts. a third writer — a screen resending by hand, a correction announcing
// itself — is an event no catalog entry describes, or a row posted twice whose status nobody else
// moved. each is its own module's to add, out loud, with this list.
//
// ./deliver.ts writes a post's outcome through ../outbox/lease.ts, which names no table of its own
// and writes whichever one an outbox is defined over, so defining an outbox over
// `webhook_delivery` counts as writing it.
//
// a source scan rather than a runtime hook, so it catches the writer nobody wrote a test for, and
// it reads text, so a computed table name fools it; the failure it defends against is a shortcut,
// not an adversary. specs are out of scope: a fixture row is not an event.

const SRC = resolve(import.meta.dirname, '../../..');
const EVENTS = resolve(import.meta.dirname, 'events.ts');
const DELIVER = resolve(import.meta.dirname, 'deliver.ts');
const SELF = resolve(import.meta.filename);

const EXTENSIONS = ['.ts', '.tsx', '.js'];

/** a spec in any pool, plus the `.testing.ts` modules specs import. */
function isTest(name: string): boolean {
	return /\.(?:spec|test|testing)\.[jt]sx?$/.test(name);
}

/** every non-spec source file under `src/`, minus this spec. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			sourceFiles(path, out);
		} else if (
			EXTENSIONS.some((e) => entry.name.endsWith(e)) &&
			!isTest(entry.name) &&
			path !== SELF
		) {
			out.push(path);
		}
	}
	return out;
}

const INSERTS: { label: string; re: RegExp }[] = [
	{ label: 'drizzle insert', re: /\binsert\s*\(\s*(?:schema\.)?webhookDelivery\b/ },
	{
		label: 'raw SQL insert',
		re: /\binsert\s+(?:or\s+\w+\s+)?into\s+[`"']?webhook_delivery\b/i
	}
];

const OUTCOMES: { label: string; re: RegExp }[] = [
	{
		label: 'drizzle update or delete',
		re: /\b(?:update|delete)\s*\(\s*(?:schema\.)?webhookDelivery\b/
	},
	{ label: 'outbox over it', re: /\btable\s*:\s*(?:schema\.)?webhookDelivery\b/ },
	{
		label: 'raw SQL update or delete',
		re: /\b(?:update|delete\s+from)\s+[`"']?webhook_delivery\b/i
	}
];

/** each file under `src/` that matches one of `patterns`, but for `allowed`. */
function offenders(patterns: typeof INSERTS, allowed: string): string[] {
	return sourceFiles(SRC)
		.filter((file) => file !== allowed)
		.flatMap((file) => {
			const source = readFileSync(file, 'utf8');
			return patterns
				.filter(({ re }) => re.test(source))
				.map(({ label }) => `${relative(SRC, file)} (${label})`);
		});
}

describe('webhooks/ is the only writer of webhook_delivery', () => {
	it('finds source files to scan at all', () => {
		// an empty list would pass the assertions below vacuously, and a wrong `SRC` is how.
		const names = sourceFiles(SRC).map((f) => relative(SRC, f));
		expect(names).toContain('lib/server/books/writes.ts');
		expect(names).toContain('lib/server/webhooks/deliver.ts');
		expect(names.some((n) => /\.(?:spec|test)\./.test(n))).toBe(false);
	});

	it('finds no insert into webhook_delivery outside events.ts', () => {
		const found = offenders(INSERTS, EVENTS);
		expect(
			found,
			`these modules insert into webhook_delivery: ${found.join(', ')}. an event is owed to its destinations by webhookStatements() in src/lib/server/webhooks/events.ts, spliced into the batch of the change it reports, and by nothing else.`
		).toEqual([]);
	});

	it('finds no update or delete of webhook_delivery outside deliver.ts', () => {
		const found = offenders(OUTCOMES, DELIVER);
		expect(
			found,
			`these modules move webhook_delivery rows: ${found.join(', ')}. only src/lib/server/webhooks/deliver.ts writes where a post landed.`
		).toEqual([]);
	});

	it('matches each writer itself, so the patterns are known to work', () => {
		expect(INSERTS.some(({ re }) => re.test(readFileSync(EVENTS, 'utf8')))).toBe(true);
		const deliver = readFileSync(DELIVER, 'utf8');
		expect(OUTCOMES.find(({ label }) => label === 'outbox over it')?.re.test(deliver)).toBe(true);
	});
});
