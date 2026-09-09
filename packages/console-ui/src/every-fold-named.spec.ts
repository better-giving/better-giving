import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SectionId } from './lib/home-sections';
import { FOLD_LABELS } from './lib/home-sections';

// every fold DEPLOY.md sends an operator to is named in that document, spelled exactly as the page
// spells it.
//
// **it exists because a fold's name is stated twice and nothing compared the two.** the document
// sends an operator to a fold by name, ./lib/home-sections.ts decides what that name is, and a
// rename in one of them leaves the other sending somebody to a row that is nowhere on the page.
// nothing fails when that happens: the operator hunts for a row that does not exist, which is a
// defect only somebody holding both files at once can see.
//
// **four of the six are sent to, and those four are the whole of this.** {@link WALKED} is the list.
// the other two are explained there without anybody being told to go and open them by their label,
// and a fold's name in passing prose is not a place somebody is sent — so there is no second
// spelling of it to come apart from. a fold renamed away or dropped from the record fails the type
// check against that list rather than passing quietly.
//
// **the names are read off the record that decides them and never off any file's text.** two of the
// four reach that record as constants stated in packages/operator/src/setup-folds.ts, so a sweep
// over source would hold the document to the spelling of an identifier instead of the word an
// operator reads.
//
// **it sweeps from the console and never from the document**, for ./every-control-named.spec.ts's
// reason: DEPLOY.md bolds well over a hundred runs and most of them are emphasis rather than a
// name, so a rule running the other way would be an allowlist of exceptions — which
// packages/operator/src/styles/raw-values.ts's header argues against in its own terms. so it
// catches a fold renamed on the page and does not catch a fold the document invented.
//
// **a fold label is a heading, which is why it is here and not beside the controls.**
// ./every-control-named.spec.ts holds the word a press carries and says in its own header that a
// heading over a reading is not one; folding these in would contradict it.

/** the document, from this directory: `packages/console-ui/src` to the repository root. */
const DOCUMENT = '../../../DEPLOY.md';

/**
 * the folds that document sends an operator to, under the id each is drawn as.
 *
 * stated rather than derived: which folds are walked to is the document's decision, and nothing on
 * this side of the wire knows it — which is the whole reason the two spellings can drift.
 */
const WALKED = [
	'password',
	'organisation',
	'payments',
	'sites'
] as const satisfies readonly SectionId[];

/** one fold's name, carrying the slot it is drawn in so a failure names which row to go and read. */
type Fold = { readonly id: SectionId; readonly label: string };

const folds: Fold[] = WALKED.map((id) => ({ id, label: FOLD_LABELS[id] }));

describe('every fold DEPLOY.md sends an operator to', () => {
	const document = readFileSync(join(import.meta.dirname, DOCUMENT), 'utf8');

	it('reads a name for every fold it is guarding', () => {
		// the non-empty assertion every source-reading gate in this repo makes first. what is swept
		// here is one record rather than a file per pattern, so this is the whole of it: a slot holding
		// nothing would satisfy the case below by having nothing to look for.
		expect(folds.filter((fold) => fold.label.trim() === '')).toEqual([]);
	});

	it('reads a document that names folds at all', () => {
		// the other half of the same guard: a path that resolved to something without bold runs in it
		// would fail every case below rather than reporting that it read the wrong file.
		expect(document).toMatch(/\*\*[^*\n]+\*\*/);
	});

	it('names every one of them, spelled as the console draws it', () => {
		// stated in bold, because that is how this document names a fold — a bare substring would find
		// `Organisation` inside an ordinary sentence and read a fold it never sends anyone to as sent
		// to.
		const unnamed = folds.filter((fold) => !document.includes(`**${fold.label}**`));
		expect(unnamed).toEqual([]);
	});
});
