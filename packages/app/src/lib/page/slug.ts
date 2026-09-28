// the address rule: which slugs a campaign may be served at, checked on every write of one.
//
// a campaign's address is a top-level segment (`/winter-coat-drive`) beside every address the app
// already answers, so a slug equal to one of those would shadow a screen, an endpoint or a file the
// build serves. the refused set is read off the route files themselves: a route file added later is
// refused here with nothing in this module edited.
//
// the rule names a clash and holds nothing. uniqueness between campaigns is the table's, and so is
// an ended campaign's hold on its address.
//
// not under `$lib/server/**`: a form validates with the same schema in the browser
// (`$lib/admin/use-admin-form.ts`), and a component cannot import from there.

import { RUNTIME_PATH_PREFIX } from '@better-giving/form/embed/stamp';
import routeFiles from 'virtual:route-files';

/**
 * one dot-separated piece of a route file's name: `text` is what it matches, with `:` for a leading
 * `$` and `?` for a closing `)`, and `raw` is how it was spelled, brackets kept, which is what tells
 * an escaped `[_]` from a pathless `_`.
 */
interface RouteSegment {
	text: string;
	raw: string;
}

// the tokenizer `@react-router/fs-routes` runs over a file name (`getRouteSegments` in its
// dist/index.js), which the package does not export and which reads the disk besides.
function routeSegments(name: string): RouteSegment[] {
	const segments: RouteSegment[] = [];
	let text = '';
	let raw = '';
	let escaped = false;
	let optional = false;
	for (const char of name) {
		if (escaped) {
			raw += char;
			if (char === ']') escaped = false;
			else text += char;
			continue;
		}
		if (char === '.') {
			if (text) segments.push({ text, raw });
			text = '';
			raw = '';
			continue;
		}
		raw += char;
		if (char === '[') escaped = true;
		else if (char === '(') optional = true;
		else if (char === ')' && optional) {
			optional = false;
			text += '?';
		} else if (char === '$' && !text) text += ':';
		else text += char;
	}
	if (text) segments.push({ text, raw });
	return segments;
}

/**
 * the first URL segments a set of route files answers, lowercased because the router matches an
 * address in any case. `routeFiles` are paths under src/routes/: a file directly in it, or a
 * folder's `route`/`index` module, which is named by its folder.
 *
 * a pathless `_layout` is looked through, and an optional segment reserves the segment after it
 * too, since the address answers with it left out. a parameter reserves nothing: it answers any
 * segment, a campaign's included.
 */
export function reservedSegments(routeFiles: readonly string[]): ReadonlySet<string> {
	const reserved = new Set<string>();
	for (const file of routeFiles) {
		const folder = file.indexOf('/');
		const name = folder === -1 ? file.slice(0, file.lastIndexOf('.')) : file.slice(0, folder);
		for (const { text, raw } of routeSegments(name)) {
			if (text.startsWith('_') && raw.startsWith('_')) continue;
			const optional = text.endsWith('?');
			const path = optional ? text.slice(0, -1) : text;
			if (!path.startsWith(':')) {
				const segment = path.endsWith('_') && raw.endsWith('_') ? path.slice(0, -1) : path;
				reserved.add(segment.toLowerCase());
			}
			if (!optional) break;
		}
	}
	return reserved;
}

// `../../../vite/route-files.ts`'s plugin, read for the names alone: an `import.meta.glob` over
// ./src/routes/ has no names-only mode, so every key it returns is a lazy `import()` nothing here
// ever calls — a dynamic-import edge into every route module, and a build warning for each one.
// the negative pattern is the same one src/routes.ts hands `flatRoutes`, shared from that plugin
// module rather than restated: a spec is not an address, and one handed to the build would pull
// `cloudflare:test` into it.
const ROUTE_FILES: readonly string[] = routeFiles;

/**
 * every segment a campaign's address may not be. beside the route files: the two directories the
 * client build serves — `assets`, vite's `build.assetsDir`, which ./vite.config.ts
 * leaves at its default, and the embed runtime's. a file static/ serves at the top level carries a
 * `.`, which the character rule refuses before this set is read.
 */
export const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
	...reservedSegments(ROUTE_FILES),
	'assets',
	RUNTIME_PATH_PREFIX.replaceAll('/', '')
]);

/** a refusal names what to change: the character, the limit, or the address it would shadow. */
export type SlugCheck =
	| { ok: true; slug: string }
	| { ok: false; reason: 'empty' }
	| { ok: false; reason: 'length'; max: number }
	| { ok: false; reason: 'character'; character: string }
	| { ok: false; reason: 'reserved'; clashesWith: string };

// a hyphen is refused where it does not join two words: first, last, or beside another.
function firstRefusedCharacter(slug: string): string | null {
	const chars = [...slug];
	for (const [at, char] of chars.entries()) {
		if (/[a-z0-9]/.test(char)) continue;
		const joinsTwoWords = char === '-' && at > 0 && at < chars.length - 1 && chars[at - 1] !== '-';
		if (!joinsTwoWords) return char;
	}
	return null;
}

/** the longest address, a decision: room for a campaign's name, and short enough to read aloud. */
export const SLUG_MAX_LENGTH = 60;

export function checkSlug(slug: string): SlugCheck {
	if (slug === '') return { ok: false, reason: 'empty' };
	const character = firstRefusedCharacter(slug);
	if (character !== null) return { ok: false, reason: 'character', character };
	if (slug.length > SLUG_MAX_LENGTH) return { ok: false, reason: 'length', max: SLUG_MAX_LENGTH };
	if (RESERVED_SEGMENTS.has(slug))
		return { ok: false, reason: 'reserved', clashesWith: `/${slug}` };
	return { ok: true, slug };
}

/**
 * the address a campaign's name suggests, while its slug still follows the name: accents folded,
 * every run of anything else one hyphen, and cut on a word where `max` allows — shorter than the
 * limit where a suffix follows. it can come back empty or reserved, and `checkSlug` is still what
 * decides.
 */
export function slugFromTitle(title: string, max = SLUG_MAX_LENGTH): string {
	const slug = title
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	if (slug.length <= max) return slug;
	const cut = slug.slice(0, max + 1);
	const lastBreak = cut.lastIndexOf('-');
	return lastBreak > 0 ? cut.slice(0, lastBreak) : cut.slice(0, max);
}

/** what a name makes no address from, `!!!` or a title of emoji, is called instead. */
const UNNAMED = 'campaign';

/**
 * the address a campaign's name suggests, or its first `-2`, `-3` the address rule allows and no
 * campaign holds — an ended campaign's held address included. `held` is read by the caller, and
 * the table's unique index is what settles a race for the address it picks.
 */
export function freeSlug(name: string, held: ReadonlySet<string | null>): string {
	for (let n = 1; ; n += 1) {
		const suffix = n === 1 ? '' : `-${n}`;
		const slug = `${slugFromTitle(name, SLUG_MAX_LENGTH - suffix.length) || UNNAMED}${suffix}`;
		if (checkSlug(slug).ok && !held.has(slug)) return slug;
	}
}
