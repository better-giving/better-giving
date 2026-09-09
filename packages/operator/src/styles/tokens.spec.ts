import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from './raw-values';
import { ADMIN_TOKENS } from './tokens';

// what holds ./tokens.ts to ./tokens.css. the mirror is a second statement of values the css
// already decides, and a second statement with nothing reading both is one that goes wrong in
// silence: the css moves, every screen moves with it, and the mail keeps sending last month's
// colour with no test failing and nothing on the page to say so.
//
// the css is the source in both directions here. a copy of a name the css does not define fails,
// and so does a copy whose value the css disagrees with, so the only way to change a value a mail
// reads is to change ./tokens.css and bring the copy after it.
//
// this reads the file on disk rather than importing it, for the reason ./raw-values.ts states about
// its own sweeps: what is asserted is what is in the file, not what a build step made of it.

const CSS = new URL('./tokens.css', import.meta.url).pathname;

// a custom property declaration. the value runs to the `;`, which is what lets a multi-line one
// through: `--admin-transition-state` is three declarations' worth of text with commas in it.
const DECLARATION = /(--admin-[\w-]+)\s*:\s*([^;]+);/g;

/** a `var(--admin-x)` that is the whole value, which is the only reference shape this file uses. */
const REFERENCE = /^var\((--admin-[\w-]+)\)$/;

/**
 * every `--admin-*` declaration in the sheet, by name, in the order it was written.
 *
 * a name can hold more than one: `--admin-field-size` and the durations are declared again inside a
 * media block, and a copy of one of those would be a copy of whichever branch this parser happened
 * to keep. so they are collected rather than overwritten, and the case below refuses to mirror a
 * name that has two.
 */
function declarations() {
	const found = new Map<string, string[]>();
	for (const [, name = '', value = ''] of stripComments(readFileSync(CSS, 'utf8')).matchAll(
		DECLARATION
	)) {
		found.set(name, [...(found.get(name) ?? []), value.trim().replace(/\s+/g, ' ')]);
	}
	return found;
}

const css = declarations();

/** a declared value with its `var()` chain followed to the literal the browser would resolve to. */
function resolve(name: string, seen: string[] = []): string {
	const value = css.get(name)?.[0];
	if (value === undefined) return `<undeclared: ${name}>`;
	if (seen.includes(name)) return `<circular: ${[...seen, name].join(' -> ')}>`;
	const reference = REFERENCE.exec(value);
	return reference?.[1] ? resolve(reference[1], [...seen, name]) : value;
}

describe('the mail token mirror still says what tokens.css says', () => {
	it('finds the file it is meant to be reading', () => {
		// a tokens.css this file failed to parse would declare nothing, and "every copy matches
		// nothing" is a sentence that passes. both floors are floors rather than the number today.
		expect(css.size).toBeGreaterThan(150);
		expect(Object.keys(ADMIN_TOKENS).length).toBeGreaterThan(20);
	});

	it('copies only names tokens.css declares, and declares once', () => {
		// a name declared twice is declared under a condition, and a copy of it is a copy of one
		// branch — which reads as the value on every mail regardless of the branch.
		const wrong = Object.keys(ADMIN_TOKENS).filter((name) => css.get(name)?.length !== 1);
		expect(wrong).toEqual([]);
	});

	it('copies the value tokens.css resolves to', () => {
		const drifted = Object.entries(ADMIN_TOKENS)
			.filter(([name, copy]) => resolve(name) !== copy)
			.map(([name, copy]) => `${name}: ${copy} — tokens.css resolves it to ${resolve(name)}`);
		expect(drifted).toEqual([]);
	});
});
