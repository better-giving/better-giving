import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// ../dev/ is downstream of this directory and never upstream of it, and this file is what makes
// that structural rather than promised.
//
// the dev page reaches ../src/element.ts, ../src/fee.ts and ../src/v1.ts by relative path, which is
// legal and is the whole way it works: it is inside this package, so no `exports` entry is widened
// for it and nothing about the published surface moves. what must never happen is the other
// direction, and the cost of it is not a lint complaint — `refuseUndeclaredImports` in
// ../vite.embed.config.ts refuses a *bare specifier* this package does not declare, and a relative
// path into a sibling directory is exactly what it is written to permit. so a single import from
// here into ../dev/ would put the fixtures, the fake ports and the panel's chrome into the runtime
// bundle every site that pasted the snippet downloads, with the build green and nothing else
// objecting. that is the same shape as the staging step CLAUDE.md records as load-bearing: quiet,
// and caught only by something that goes looking.
//
// specifiers are read as text rather than by importing anything: this is a sweep over files on
// disk, the way every gate across a directory line in this repository already is, and importing the
// modules to inspect them would be the very edge being asserted about.

/** where a spec runs from: `vitest` sets the cwd to the package root. */
const SRC = resolve('src');
const DEV = resolve('dev');

/** every `from '…'`, `import '…'` and `import('…')` in a file, the relative ones included. */
const SPECIFIERS = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g;

function modules(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return modules(path);
		return entry.name.endsWith('.ts') ? [path] : [];
	});
}

describe('the dev page is downstream of src/ and never upstream of it', () => {
	it('is imported by nothing the embed is built from', () => {
		const files = modules(SRC);
		// without this the case passes loudest when the sweep reads nothing at all. a floor well
		// under what this directory holds, so it says "the sweep is reaching the tree" rather than
		// "the tree has not changed".
		expect(files.length).toBeGreaterThan(20);

		const reaching: string[] = [];
		for (const file of files) {
			for (const [, from, dynamic] of readFileSync(file, 'utf8').matchAll(SPECIFIERS)) {
				const specifier = from ?? dynamic ?? '';
				if (!specifier.startsWith('.')) continue;
				const target = resolve(dirname(file), specifier);
				if (target === DEV || target.startsWith(DEV + sep)) {
					reaching.push(`${relative(resolve('.'), file)} imports ${specifier}`);
				}
			}
		}
		expect(reaching).toEqual([]);
	});
});
