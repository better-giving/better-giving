import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { rawColourViolations, rawLengthViolations } from './raw-values';

// the escape hatches, opened against a fixture rather than against this repository's own css.
//
// the reason this file is not simply another caller's case. a surface's gate — the dashboard's two
// in packages/app/src/lib/admin/styles/, the console's in packages/console-ui/src/ — can assert only
// that its own files come back clean, and a clean answer is what a working sweep and a blind one
// both give. `raw-colour-ok:` and `raw-length-ok:` are the half of the bargain nothing else
// exercises: no caller hands ./tokens.css to the colour sweep and none hands ./adm.css to the
// length sweep, which are the two files the notes in this repository are actually written in. so
// every note in the tree today is excusing a value that is never swept, and the hatch itself has no
// call site at all. a value written into a screen with a note on it would be the first, and finding
// out then whether the note works is finding out at the wrong moment.
//
// the fixture is a real file in a temp directory because the sweeps read from disk — they take
// paths so that a caller can glob its own tree, and a fake in memory would be proving something
// about a different function.
//
// each pair below is the same declaration twice: once as the gate must refuse it, once with the
// note. the refusal is asserted first and is not decoration — without it the case that follows
// passes just as well against a sweep that reads nothing at all.

const dir = mkdtempSync(join(tmpdir(), 'raw-values-'));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** a css fixture on disk, named after the case, and the path the sweeps are handed. */
function fixture(name: string, css: string) {
	const file = join(dir, `${name}.css`);
	writeFileSync(file, css);
	return [file];
}

describe('raw-colour-ok:', () => {
	it('is refused without the note', () => {
		const files = fixture('colour-bare', 'a { color: #ff0000; }');
		expect(rawColourViolations(files)).toHaveLength(1);
	});

	it('excuses the value on its own line', () => {
		const files = fixture(
			'colour-noted',
			'a {\n\tcolor: #ff0000; /* raw-colour-ok: the fixture says why. */\n}'
		);
		expect(rawColourViolations(files)).toEqual([]);
	});

	it('excuses that line and no other', () => {
		// the bargain is struck one line at a time. a note above a block would be a file-wide
		// switch written as a comment, which is the thing a gate cannot come back from.
		const files = fixture(
			'colour-above',
			'/* raw-colour-ok: the fixture says why. */\na {\n\tcolor: #ff0000;\n}'
		);
		expect(rawColourViolations(files)).toHaveLength(1);
	});
});

describe('raw-length-ok:', () => {
	it('is refused without the note', () => {
		const files = fixture('length-bare', 'a { padding: 7px; }');
		expect(rawLengthViolations(files)).toHaveLength(1);
	});

	it('excuses the value on its own line', () => {
		const files = fixture(
			'length-noted',
			'a {\n\tpadding: 7px; /* raw-length-ok: the fixture says why. */\n}'
		);
		expect(rawLengthViolations(files)).toEqual([]);
	});

	it('excuses that line and no other', () => {
		const files = fixture(
			'length-above',
			'/* raw-length-ok: the fixture says why. */\na {\n\tpadding: 7px;\n}'
		);
		expect(rawLengthViolations(files)).toHaveLength(1);
	});
});

describe('a face name is not a colour', () => {
	it('passes a family whose name carries a colour word', () => {
		// ./fonts.css declares ten faces of the red hat family, so `red` stands inside a proper
		// noun on every one of those lines.
		const files = fixture('family', "@font-face {\n\tfont-family: 'Red Hat Text';\n}");
		expect(rawColourViolations(files)).toEqual([]);
	});

	it('refuses a colour on any other property', () => {
		// the exemption is the property and not the quotes: without this case it would pass
		// against a sweep that had stopped reading a quoted value anywhere.
		const files = fixture('family-adjacent', "a {\n\tcontent: 'Red Hat Text';\n\tcolor: red;\n}");
		expect(rawColourViolations(files)).toHaveLength(2);
	});
});
