import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { vi } from 'vitest';

// the spec pool processes no css, so a `?url` import reads as an empty string (../donate/plain-page.spec.ts).
// this answers each `?url` import the named sources make with the path of the file it names, so what
// a links function returns is the sheets it really emits and a spec can read them.

const URL_IMPORT = /from\s+'([^']+)\?url'/g;

/** the sheets `emit` returns, each as the path of the file the route would link. */
export async function linkedSheets(
	sources: readonly string[],
	emit: () => Promise<readonly { readonly href: string }[]>
): Promise<string[]> {
	for (const source of sources) {
		const require = createRequire(source);
		for (const [, specifier = ''] of readFileSync(source, 'utf8').matchAll(URL_IMPORT)) {
			const file = specifier.startsWith('.')
				? resolve(dirname(source), specifier)
				: require.resolve(specifier);
			// a relative key would resolve against this file, so a relative specifier is keyed by its path.
			vi.doMock(`${specifier.startsWith('.') ? file : specifier}?url`, () => ({ default: file }));
		}
	}
	vi.resetModules();
	return (await emit()).map((link) => link.href);
}
