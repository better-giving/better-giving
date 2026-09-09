import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// every `pnpm run …` this repository writes down names a script the root package.json actually has.
//
// the failure it refuses is one this repository has already shipped: a refusal body naming a script
// the root manifest did not have, for as long as the surface answering it existed — so the one
// sentence an operator had to go on sent them to a command their terminal answered with
// `ERR_PNPM_NO_SCRIPT`. nothing said so, because a command in a string is prose to every compiler
// and every linter in this tree.
//
// the root manifest is the only place looked up, and that is the rule rather than a simplification:
// operator commands run at the repo root (CLAUDE.md), so `pnpm run x` written anywhere here means
// the root's `x` — a script of that name in a package manifest is not what an operator standing in
// the repository would reach, and pnpm does not fall back to the root for them either. the two
// forms without `run` — `pnpm dev`, `pnpm wrangler` — resolve the same way and are matched here too.
//
// the sweep reaches out of this package to the root documents, which is where the other half of
// these sentences are written: DEPLOY.md is read by an operator with a terminal open, and a command
// that has been renamed there fails exactly as loudly as one in a refusal body.

const ROOT = '../..';

// two spellings, and the second one is closed at both ends for a reason. `pnpm run x` needs no
// delimiter — the word `run` and the space after it are enough. the two-word form does: `pnpm run`
// is itself a noun in this repository's prose ("operator commands are `pnpm run` scripts"), and a
// pattern that let the word after it count would read the next English word as a command name. so
// the bare form is matched only inside its own backticks, which is how every mention of one is
// written here anyway.
const COMMANDS = [/\bpnpm run ([a-z][\w:-]*)/g, /`pnpm ([a-z][\w:-]*)`/g];

// what pnpm answers itself rather than a script it looks up. two, and the list is meant to stay
// about that size: it is the vocabulary of the package manager and not an allowlist of names this
// repository has decided to stop checking.
const SUBCOMMANDS = new Set(['install', 'run']);

const files = [
	...globSync('src/**/*.{ts,tsx}'),
	...globSync('scripts/**/*.js'),
	...globSync('migrations/*.sql'),
	'.dev.vars.example',
	...globSync(`${ROOT}/*.md`)
].filter((file) => !file.endsWith('commands.spec.ts'));

const scripts = new Set(
	Object.keys(
		(
			JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8')) as {
				scripts: Record<string, string>;
			}
		).scripts
	)
);

/** every command named in the tree, as `file:line pnpm run x`. */
function mentions() {
	const found: { at: string; name: string }[] = [];
	for (const file of files) {
		readFileSync(file, 'utf8')
			.split('\n')
			.forEach((line, i) => {
				for (const pattern of COMMANDS) {
					for (const [, name] of line.matchAll(pattern)) {
						if (name && !SUBCOMMANDS.has(name)) found.push({ at: `${file}:${i + 1}`, name });
					}
				}
			});
	}
	return found;
}

describe('every command this repository names is one the root can run', () => {
	const named = mentions();

	it('finds the sentences it is meant to be reading', () => {
		// without this the suite passes loudest when a glob is wrong and nothing is read. the
		// numbers are floors well under what the tree holds, so they say "the sweep is reaching
		// the tree" rather than "the tree has not changed".
		expect(named.length).toBeGreaterThan(50);
		expect(new Set(named.map((m) => m.name)).size).toBeGreaterThan(10);
		// the two halves the sweep exists to cover at once: a refusal body under src/, and the
		// operator document at the repository root.
		expect(named.some((m) => m.at.startsWith('src/lib/server/payments/'))).toBe(true);
		expect(named.some((m) => m.at.includes('DEPLOY.md'))).toBe(true);
	});

	it('names none the root package.json does not declare', () => {
		expect(
			named.filter((m) => !scripts.has(m.name)).map((m) => `${m.at} pnpm run ${m.name}`)
		).toEqual([]);
	});
});
