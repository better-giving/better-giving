import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as groups from './lib/secret-groups';

// every group of credentials the enumeration declares is drawn somewhere, or is named below as one
// nobody types, and this is what makes that structural rather than remembered.
//
// **it exists because the absence of one was invisible.** ./lib/secret-groups.ts declares four
// groups and ./lib/secret-groups.spec.ts holds the covering that files every one of the seventeen in
// a group or on the list of those that have none — so a name added to `DEPLOY_VARS` with neither is
// a case that fails. what neither of those can see is a group with no block on the page: the
// enumeration still covers every name, the covering still passes, and the value simply has nowhere
// to be typed. that is what
// happened to `sign-in` when the console's six screens became one page. the group kept its entry,
// its comment kept claiming a screen drew it, and the only way to change the staff password was a
// terminal. a group moving between modules is exactly what this gate is blind to unless the module
// holding it is listed below.
//
// **the identifier is read out of the source and resolved against the module**, rather than this
// file holding its own list of which constant names which group. a second list here would be the
// same failure one level up: it would agree with the enumeration on the day it was written and drift
// afterwards, and nothing would say so.
//
// it reads source text and imports one module for its values. the source read is the point — what a
// module *draws* is not observable from a value, and this package has no DOM pool to render it in
// (../vite.config.ts is `node`), so the file is the only place the property is visible.

/** the shape every drawing site takes, and the identifier naming which group it draws. */
const DRAWS = /SECRET_GROUPS\.filter\(\(group\) => group\.id === (\w+)\)/g;

/* the modules that may draw a group. every one is a file this package owns, so a path that stops
   resolving is a rename rather than a missing gate — `readFileSync` throws and names it. */
const SOURCES = [
	'routes/_index.tsx',
	'lib/stripe-section.tsx',
	'lib/paypal-section.tsx',
	'lib/sites-fold.tsx',
	'lib/smtp-fold.tsx',
	'lib/password-fold.tsx'
];

/* the groups nobody types, which are the ones a page is allowed to draw no block for.
   `TURNSTILE_SECRET_KEY` is the whole of the spam group and the first deploy mints it with the
   widget it belongs to (`packages/console/internal/first`), so there is no value for an operator to paste
   and a block over it would be boxes for a credential already set. it stays in the enumeration
   because lib/secret-groups.spec.ts's covering has to file every one of the seventeen somewhere.

   an id here is an exemption and not a skip: the case below asserts each one is drawn by nothing,
   so a block added back for it fails this file rather than passing under it. */
const NOBODY_TYPES: readonly string[] = [groups.SPAM_GROUP];

describe('every group of credentials is drawn', () => {
	const drawn = new Set<string>();
	const identifiers: string[] = [];

	for (const relative of SOURCES) {
		const source = readFileSync(join(import.meta.dirname, relative), 'utf8');
		for (const [, identifier] of source.matchAll(DRAWS)) {
			if (identifier === undefined) continue;
			identifiers.push(identifier);
			const id = (groups as Record<string, unknown>)[identifier];
			if (typeof id === 'string') drawn.add(id);
		}
	}

	it('reads a drawing site at all', () => {
		// the non-empty assertion every source-reading gate in this repo makes first: a regex that
		// quietly stops matching reads as a passing gate forever.
		expect(identifiers.length).toBeGreaterThanOrEqual(3);
	});

	it('resolves every identifier it read against the enumeration', () => {
		// an identifier the module does not export is a constant that was renamed, which would
		// otherwise leave this gate passing over a group it could no longer see.
		const unresolved = identifiers.filter(
			(identifier) => typeof (groups as Record<string, unknown>)[identifier] !== 'string'
		);
		expect(unresolved).toEqual([]);
	});

	it('draws every group an operator types a value into', () => {
		const declared = groups.SECRET_GROUPS.map((group) => group.id).filter(
			(id) => !NOBODY_TYPES.includes(id)
		);
		expect([...drawn].sort()).toEqual([...declared].sort());
	});

	it('draws no block for a group nobody types, so the exemption cannot go stale', () => {
		expect([...drawn].filter((id) => NOBODY_TYPES.includes(id))).toEqual([]);
	});
});
