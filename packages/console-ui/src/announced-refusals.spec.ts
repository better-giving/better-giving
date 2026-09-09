import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// the console's gate over a refusal that announces to nobody, and it holds it by refusing the
// hand-drawn row outright.
//
// a console screen puts its message where the control that earned it is, because the press is what
// the message is about and there is no box for
// packages/operator/src/components/forms/Field.jsx to hang one off. drawn by hand that row went
// wrong two ways at once: a paragraph carrying no `role="alert"` tells a screen reader nothing, and
// a sentence handed straight to the row comes apart across it — the row is a flex line, so every
// inline element in the message becomes a flex item and the row's gap is spent between the parts of
// one sentence rather than between the mark and the words.
//
// both are settled by the row being a part rather than a spelling.
// packages/operator/src/components/forms/FieldMessage.jsx draws the class, carries the role and
// wraps the sentence in one child, and packages/operator/src/components/forms/FieldMessage.dom.spec.tsx
// is what holds it to all three. so what is left for this surface to assert is that no screen here
// writes the row itself — which is stronger than reading the tag was, because a hand-drawn row that
// remembered the role still broke the sentence.
//
// it reads source because that is where the rule lives — a screen's own text, in every branch it
// draws, including the ones a render would have to be steered into. ./raw-values.spec.ts is this
// package's other sweep and the shape is its: findings come back as a list so one failure names
// every offender at once, and the case counting what the globs reached is here for the reason
// written beside that one — a sweep reaching nothing passes loudest.

const ROW = /\badm-field__(?:error|needed)\b/g;
const PART = /\bFieldMessage\b/g;

/** every place a screen spells the row's own class, with the line it is on. */
function handDrawnRows(files: readonly string[]): string[] {
	const found: string[] = [];
	for (const file of files) {
		const source = readFileSync(file, 'utf8');
		for (const match of source.matchAll(ROW)) {
			const line = source.slice(0, match.index).split('\n').length;
			found.push(`${file}:${line} ${match[0]}`);
		}
	}
	return found;
}

/** every mention of the part, which is what a screen writes instead. */
function partUses(files: readonly string[]): string[] {
	return files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(PART)].map(() => file));
}

describe('no console screen draws a message row by hand', () => {
	const screens = globSync('src/**/*.tsx');

	it('finds the files it is meant to be guarding', () => {
		expect(screens.length).toBeGreaterThan(0);
		// and the rows inside them. an empty finding is what this file wants from the sweep below, so
		// on its own it is also what a matcher that reads nothing returns — the floor is counted on
		// the part instead, which every one of those rows is now written as.
		expect(partUses(screens).length).toBeGreaterThan(20);
	});

	it('writes every message row as the shared part', () => {
		expect(handDrawnRows(screens)).toEqual([]);
	});
});
