import { DEPLOY_VARS, setCommand } from '@better-giving/operator/deploy-split';
import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTH_VAR_NAMES } from '../auth/env';
import { CONFIG_VAR_NAMES } from './env';

// the gate on "the app tells an operator to set a value the way DEPLOY.md says it is set".
//
// nothing at runtime can tell a var from a secret. both arrive on `platform.env`, so a deployment
// whose `MAIL_FROM` was stored either way reads the same: no screen goes red and no request fails.
// that is what makes a wrong command a defect rather than a typo — the operator follows it, the
// deployment keeps working, and the value they went looking for is not where the console reads it.
// so it is asserted instead of reviewed.
//
// every one of the seventeen is a plain var, and `packages/operator/src/deploy-split.ts` argues why.
// what is left to hold is that nothing anywhere still tells an operator to store one as a secret: a
// value written that way is a value the console cannot read back, which is the whole of what that
// module's rule exists to prevent.
//
// two halves, and neither covers the other. the first holds
// `packages/operator/src/deploy-split.ts`, which is where every instruction either surface builds
// comes from. the second reads the files on disk, because a sentence can always spell a command
// out by hand — a fix line, a log line's `operatorFix`, a paragraph on a screen, a heading in
// DEPLOY.md — and the module cannot see one that never called it.
//
// the first half is also where the list is held to the names this app actually reads, in both
// directions. it is a case here rather than a `satisfies` on the list because the leaf the list
// lives in may name no application, so it cannot see `ConfigEnv` or `AuthEnv` — and the case is
// the stronger form of that check anyway, since it catches a name on the list that nothing reads as
// well as a name read that the list does not hold.
//
// `secret:delete` and `secret:list` are deliberately not swept for. `CONSOLE_TOKEN` is a Worker
// secret and is not a configuration value — the console mints it for its own session — so those two
// commands, and prose about the `wrangler secret put` prompt it can be typed at, stay true.

/**
 * everything that could hold an instruction, plus the two documents beside it.
 *
 * three packages rather than this one, because an instruction is spelled wherever an operator is
 * read to. the list itself lives in packages/operator now, and packages/console-ui is the surface
 * an operator reads while looking at a deployment from outside — a sweep of this package alone
 * would pass over both. read by path and never imported: biome.jsonc refuses a *module* from here into
 * packages/console-ui, and reading a file the way a sweep does is what every gate across package
 * lines in this repository already does.
 */
const SOURCES = [
	...globSync('src/**/*.ts'),
	...globSync('src/**/*.tsx'),
	...globSync('scripts/*.js'),
	...globSync('../operator/src/**/*.ts'),
	...globSync('../console-ui/src/**/*.ts'),
	...globSync('../console-ui/src/**/*.tsx'),
	'../../README.md',
	'../../DEPLOY.md'
];

/**
 * a break in a string literal, which is where half these sentences put the variable name.
 *
 * an operator message long enough to wrap is written as concatenated literals, so the command and
 * the name it names sit on two lines with `' +` between them. reading a line at a time would find
 * every short instruction and miss exactly the long ones.
 */
const SEAM = String.raw`(?:['"\`]\s*\+\s*['"\`])?`;

/**
 * the word itself, held apart from the patterns below.
 *
 * this file is inside its own sweep, and a pattern spelled as one literal would match the line that
 * declares it — a gate that fails on nothing but itself and can never be made green. composed from
 * a fragment, the text on disk here is `:(?:set|bulk)` and matches nothing.
 */
const SECRET_WORD = 'secret';

/** the `pnpm run` script form, which is how a sentence on a screen or in a document spells one. */
const SCRIPT_FORM = `${SECRET_WORD}:(?:set|bulk)`;

/** a name written into a command that would store it as a secret. */
function setAsSecret(name: string): RegExp {
	return new RegExp(
		String.raw`(?:${SCRIPT_FORM}|${SECRET_WORD}\s+(?:put|bulk))\s+${SEAM}${name}\b`,
		'g'
	);
}

/**
 * the two scripts themselves, whether or not a name follows.
 *
 * both are gone from package.json, so a mention left behind points an operator at a command that no
 * longer exists — which is how a deleted rule outlives its own deletion. the pattern above cannot
 * see one, because half of these never name a value at all.
 *
 * the bare wrangler form is deliberately not swept for here: `wrangler secret put` is still the way
 * `CONSOLE_TOKEN` is set by hand, and prose about that prompt is true. what would be wrong is one of
 * the seventeen names after it, which the pattern above does catch.
 */
const SECRET_COMMANDS = new RegExp(SCRIPT_FORM, 'g');

/** every match in the swept files, as `path:line`, so a failure names where to go. */
function sites(pattern: RegExp): string[] {
	const found: string[] = [];
	for (const path of SOURCES) {
		const text = readFileSync(path, 'utf8');
		for (const match of text.matchAll(pattern)) {
			found.push(`${path}:${text.slice(0, match.index).split('\n').length}`);
		}
	}
	return found;
}

describe('the command an operator is told to set a value with', () => {
	/**
	 * without this the sweep below passes loudest when it reads nothing at all, which is the one
	 * failure a file-reading gate cannot report on its own.
	 */
	it('reads the files it is guarding', () => {
		expect(SOURCES.length).toBeGreaterThan(100);
		expect(SOURCES).toContain('../../DEPLOY.md');
		// the two packages the sweep was widened to. a glob that stopped matching would otherwise
		// only ever show as a sweep that got quieter.
		expect(SOURCES).toContain('../operator/src/deploy-split.ts');
		expect(SOURCES).toContain('../console-ui/src/lib/secret-groups.ts');
		expect(sites(/pnpm run deploy --var/g).length).toBeGreaterThan(0);
	});

	/**
	 * the list covers every name and invents none. a name this app reads that the list does not
	 * hold has no command at all, and a name on the list that nothing reads is an instruction to
	 * set a variable this deployment never looks at.
	 */
	it('holds every variable this app reads, and nothing else', () => {
		const read = [...CONFIG_VAR_NAMES, ...AUTH_VAR_NAMES];
		const listed: readonly string[] = DEPLOY_VARS;
		expect(read.filter((name) => !listed.includes(name))).toEqual([]);
		expect(listed.filter((name) => !(read as readonly string[]).includes(name))).toEqual([]);
		expect(new Set(listed).size).toBe(listed.length);
	});

	it.each(DEPLOY_VARS)('sets %s with a deploy flag', (name) => {
		expect(setCommand(name)).toBe(`pnpm run deploy --var ${name}:<value>`);
	});

	/**
	 * and the same thing for a sentence that never called `setCommand`: a name printed by hand
	 * beside the box an operator is looking at, telling them to store it where nothing reads it
	 * back.
	 */
	it.each(DEPLOY_VARS)('never tells an operator to store %s as a secret', (name) => {
		expect(sites(setAsSecret(name))).toEqual([]);
	});

	it('points at no command that sets a secret from a checkout', () => {
		expect(sites(SECRET_COMMANDS)).toEqual([]);
	});
});
