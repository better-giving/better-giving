import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOADER_PATH, RUNTIME_PATH_PREFIX } from '@better-giving/form/embed/stamp';

// the cache tiers the embed is served under, read off the committed `_headers` rather than off a
// deployment.
//
// why this file exists. `<script src="https://…/embed.js" async>` is pasted into sites this
// project cannot reach and is never edited again, so `/embed.js` is the only request an already
// pasted snippet is guaranteed to repeat. cache it long and an upgrade never arrives anywhere —
// there is no second channel, no version to bump on the org's page and nobody to ask. the runtime
// underneath it is named by the hash of its own contents, so a new build is a new URL and that one
// may be kept forever.
//
// how it is checked: every rule whose pattern matches `/embed.js` is collected, not just the rule
// that names it. `_headers` unions the headers of every matching rule, so a later `/*` or `/embed*`
// block would quietly add `immutable` to the loader with the rule below it still reading correctly.
//
// this is a scan of a committed file, not a probe of a running deployment, for the reason
// src/routes.spec.ts scans the route tree: `test` runs at commit time with no build
// ordered ahead of it, so there is nothing built and nothing served at the moment this runs.

const ROOT = resolve(import.meta.dirname, '..');

// the two served paths come from ./loader.ts rather than being spelled again here. `_headers` is a
// plain text file and cannot import anything, so this spec is the only place the rules it carries
// and the paths the code actually uses can be held to each other — writing the paths out a second
// time here would let the two drift with the file still passing.
const RUNTIME_ASSET = `${RUNTIME_PATH_PREFIX}9f2a1c4e.js`;

/** the loader tier's ceiling, in seconds. */
const SHORT_MAX_AGE = 300;

/** the hashed tier, in seconds — one year, which is the longest `max-age` worth writing. */
const IMMUTABLE_MAX_AGE = 31_536_000;

type Rule = { readonly pattern: string; readonly headers: ReadonlyMap<string, string> };

/**
 * `_headers` as rules: a pattern line, then indented `name: value` lines under it.
 *
 * enough of the format to answer what is asked here. names are lowercased because a header name is
 * case-insensitive and this file is hand-written.
 */
function parseHeaders(text: string): Rule[] {
	const rules: { pattern: string; headers: Map<string, string> }[] = [];
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (line.length === 0 || line.startsWith('#')) continue;
		const indented = raw !== raw.trimStart();
		const current = rules.at(-1);
		if (!indented || current === undefined) {
			rules.push({ pattern: line, headers: new Map() });
			continue;
		}
		const colon = line.indexOf(':');
		if (colon === -1) continue;
		current.headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
	}
	return rules;
}

/**
 * whether a rule's pattern covers a path.
 *
 * `*` matches greedily and `:name` matches one path segment, which is the pattern language
 * documented at https://developers.cloudflare.com/workers/static-assets/headers/. an absolute-URL
 * pattern is reduced to its path, since the host is not what is being asked about here.
 */
function matches(pattern: string, path: string): boolean {
	const withoutHost = pattern.startsWith('https://')
		? pattern.replace(/^https:\/\/[^/]*/, '') || '/'
		: pattern;
	const source = withoutHost
		.split('')
		.map((character) => {
			if (character === '*') return '.*';
			return /[a-zA-Z0-9/_-]/.test(character) ? character : `\\${character}`;
		})
		.join('')
		.replace(/\\:[a-zA-Z]\w*/g, '[^/]+');
	return new RegExp(`^${source}$`).test(path);
}

/** every header value a request for `path` would collect, joined the way `_headers` joins them. */
function cacheControlFor(rules: readonly Rule[], path: string): string[] {
	return rules
		.filter((rule) => matches(rule.pattern, path))
		.map((rule) => rule.headers.get('cache-control'))
		.filter((value): value is string => value !== undefined);
}

function maxAge(value: string): number | null {
	const found = /max-age=(\d+)/.exec(value);
	return found?.[1] === undefined ? null : Number(found[1]);
}

const HEADERS_PATH = resolve(ROOT, 'static/_headers');

describe('the embed cache tiers', () => {
	// the file is read from the public directory and from nowhere else. cloudflare reads `_headers`
	// at the root of the assets it serves, and static/ is what vite copies there whole
	// (../vite.config.ts) — a copy anywhere else is one the deployment never sees.
	it('is a committed file in the public directory', () => {
		expect(existsSync(resolve(ROOT, 'package.json'))).toBe(true);
		expect(existsSync(HEADERS_PATH)).toBe(true);
		expect(existsSync(resolve(ROOT, '_headers'))).toBe(false);
	});

	const rules = (): Rule[] => parseHeaders(readFileSync(HEADERS_PATH, 'utf8'));

	it('caches the loader briefly, so an upgrade reaches a snippet nobody will touch again', () => {
		const values = cacheControlFor(rules(), LOADER_PATH);
		expect(values.length).toBeGreaterThan(0);
		for (const value of values) {
			expect(value).not.toMatch(/immutable/);
			const seconds = maxAge(value);
			expect(seconds).not.toBeNull();
			expect(seconds).toBeLessThanOrEqual(SHORT_MAX_AGE);
		}
	});

	it('caches the hashed runtime forever', () => {
		const values = cacheControlFor(rules(), RUNTIME_ASSET);
		expect(values.length).toBe(1);
		expect(values[0]).toMatch(/immutable/);
		expect(maxAge(values[0] ?? '')).toBe(IMMUTABLE_MAX_AGE);
	});

	// both files are executed by a browser on somebody else's page, where a wrong content type
	// guessed from the bytes is a script running as something it is not.
	it('refuses content sniffing on both', () => {
		for (const path of [LOADER_PATH, RUNTIME_ASSET]) {
			const sniff = rules()
				.filter((rule) => matches(rule.pattern, path))
				.map((rule) => rule.headers.get('x-content-type-options'));
			expect(sniff).toContain('nosniff');
		}
	});

	// the pattern matcher above is what every assertion here rests on, so it is held to a case it
	// would be useless without: a rule that covers the loader without naming it.
	it('sees a rule that covers the loader without naming it', () => {
		expect(matches('/*', LOADER_PATH)).toBe(true);
		expect(matches('/embed*', LOADER_PATH)).toBe(true);
		expect(matches(`${RUNTIME_PATH_PREFIX}*`, LOADER_PATH)).toBe(false);
		expect(matches(LOADER_PATH, RUNTIME_ASSET)).toBe(false);
	});
});
