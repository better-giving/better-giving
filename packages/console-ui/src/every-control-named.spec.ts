import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// every press DEPLOY.md sends an operator to is named in that document, spelled exactly as the fold
// draws it.
//
// **it exists because a control's name is stated twice and nothing compared the two.** the document
// sends an operator to a press by name, the component decides what that name is, and a rename in one
// of them leaves the other pointing at a word that is nowhere on the screen. nothing fails when that
// happens and no reading goes wrong: the operator simply hunts for a control that does not exist,
// which is a defect only somebody holding both files at once can see.
//
// **one press is sent to, and it is the whole of this.** {@link PRESSES} is the list, one entry per
// press, each carrying the pattern that reads its word off the fold that draws it. every other box
// and press on the folds is described in that document without anybody being told to go and press it
// by name, and a name nobody is sent to has no second spelling to come apart from.
//
// **it reads the presses one at a time rather than sweeping a fold whole.** a fold draws several
// presses and the document sends an operator to one of them, so a rule over everything the file
// draws would be a rule over words the document never undertook to spell.
//
// **it sweeps from the components and never from the document.** DEPLOY.md bolds well over a hundred
// runs and most of them are emphasis rather than a name — `pnpm`, `console`, whole sentences — so a
// rule holding every bolded run to a component label would be an allowlist of exceptions, which
// packages/operator/src/styles/raw-values.ts's header argues against in its own terms.
//
// **so it catches a control renamed in a component and does not catch one the document invented.** a
// name the document states for a press no fold draws is never read here, because nothing tells it
// apart from the emphasis around it. the prose still has to be walked against the screens; what this
// holds is that a name already walked stays true afterwards.
//
// **what counts is the word a press carries at rest.** the word it says while it waits is not the
// word anybody is told to look for, and neither is a heading over a reading — ./every-fold-named.spec.ts
// holds the fold names, and says in its own header why the two are apart.
//
// **each pattern has to match its file exactly once.** one that stops matching reads as a gate that
// passes forever, and one that starts matching a second press beside the one it is about is a gate
// holding the document to a word nobody was sent to.
//
// it reads source text, for ./every-group-drawn.spec.ts's reason: what a component draws is not
// observable from a value, and this package has no DOM pool to render it in (../vite.config.ts is
// `node`).

/** the document, from this directory: `packages/console-ui/src` to the repository root. */
const DOCUMENT = '../../../DEPLOY.md';

/** one press the document sends an operator to, and where its word is drawn. */
type Press = { readonly where: string; readonly pattern: RegExp };

const PRESSES: readonly Press[] = [
	// the donation processor's save, whose word is a prop on the shared press.
	{ where: 'lib/stripe-section.tsx', pattern: /<SaveButton\s[^<]*?\blabel="([^"]+)"/ }
];

/** one drawn press: the word on it, and the line it is drawn at so a failure names where to go. */
type Control = { readonly where: string; readonly label: string };

const at = (relative: string, text: string, index: number): string =>
	`${relative}:${text.slice(0, index).split('\n').length}`;

function control(press: Press): Control[] {
	const text = readFileSync(join(import.meta.dirname, press.where), 'utf8');
	const found = [...text.matchAll(new RegExp(press.pattern, 'g'))];
	return found.flatMap((match) => {
		const label = match[1];
		if (label === undefined) return [];
		return [{ where: at(press.where, text, match.index), label }];
	});
}

describe('every press DEPLOY.md sends an operator to', () => {
	const document = readFileSync(join(import.meta.dirname, DOCUMENT), 'utf8');
	const drawn = PRESSES.map((press) => ({ press, found: control(press) }));

	it('reads one press out of every file it is guarding', () => {
		const counted = drawn.map(({ press, found }) => `${press.where}: ${found.length}`);
		expect(counted).toEqual(PRESSES.map((press) => `${press.where}: 1`));
	});

	it('reads a document that names controls at all', () => {
		// the other half of the same guard: a path that resolved to something without bold runs in it
		// would fail every case below rather than reporting that it read the wrong file.
		expect(document).toMatch(/\*\*[^*\n]+\*\*/);
	});

	it('names every one of them, spelled as the fold draws it', () => {
		// stated in bold, because that is how this document names a control and nothing else — a bare
		// substring would find `Save` inside `Save sites` and read a control it never mentions as
		// mentioned.
		const unnamed = drawn
			.flatMap(({ found }) => found)
			.filter((one) => !document.includes(`**${one.label}**`));
		expect(unnamed).toEqual([]);
	});
});
