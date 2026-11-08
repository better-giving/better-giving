import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// node pool: the form's monospace stack against the registry's, both read as text. the form copies
// the list rather than reading `var(--font-mono)`, because the registry declares it on `:root` and a
// shadow tree has none (`--_font-mono` in ./tokens.css).

/** one declaration's family list, quotes dropped so the registry's `"` and the form's `'` agree. */
function families(sheet: string, name: string): string[] {
	const value = new RegExp(`${name}:\\s*([^;]+);`).exec(sheet)?.[1] ?? '';
	return value
		.split(',')
		.map((family) => family.trim().replace(/^['"]|['"]$/g, ''))
		.filter((family) => family !== '');
}

const registry = readFileSync(new URL('../registry/styles/variables.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

describe('the monospace stack', () => {
	it('takes the registry’s mono stack less its web face', () => {
		const theirs = families(registry, '--font-mono');

		expect(theirs[0]).toBe('Red Hat Round Mono');
		expect(families(tokens, '--_font-mono')).toEqual(theirs.slice(1));
	});
});
