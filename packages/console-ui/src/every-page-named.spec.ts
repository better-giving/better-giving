import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITES_TITLE } from './lib/console-pages';
import { FOLD_LABELS } from './lib/home-sections';
import { processorLinks } from './lib/processor-links';

// every console page DEPLOY.md sends an operator to is named in that document, spelled exactly as
// the rail draws it.
//
// **it exists because a page's name is stated twice and nothing compared the two.** the document
// sends an operator to a page by name, the rail (`railGroups` in ./lib/console-pages.ts) decides
// what that name is, and a rename in one of them leaves the other sending somebody to a cell that is
// nowhere on the rail. nothing fails when that happens: the operator hunts for a page that does not
// exist, which is a defect only somebody holding both files at once can see.
//
// **the pages the document sends somebody to are the whole of this.** {@link WALKED} is the list. a
// page's name in passing prose is not a place somebody is sent, so there is no second spelling of it
// to come apart from.
//
// **the names are read off the records the rail draws from and never off any file's text.** two of
// them reach the rail as constants stated in packages/operator/src/setup-folds.ts, so a sweep over
// source would hold the document to the spelling of an identifier instead of the word an operator
// reads.
//
// **it sweeps from the console and never from the document**, for ./every-control-named.spec.ts's
// reason: DEPLOY.md bolds well over a hundred runs and most of them are emphasis rather than a
// name, so a rule running the other way would be an allowlist of exceptions — which
// packages/operator/src/styles/raw-values.ts's header argues against in its own terms. so it
// catches a page renamed on the rail and does not catch a page the document invented.
//
// **a page name is a heading, which is why it is here and not beside the controls.**
// ./every-control-named.spec.ts holds the word a press carries and says in its own header that a
// heading over a reading is not one; folding these in would contradict it.

/** the document, from this directory: `packages/console-ui/src` to the repository root. */
const DOCUMENT = '../../../DEPLOY.md';

/**
 * the names of the pages that document sends an operator to, as the rail draws them.
 *
 * stated rather than derived: which pages are walked to is the document's decision, and nothing on
 * this side of the wire knows it — which is the whole reason the two spellings can drift. the
 * processors' names do not turn on what the deployment holds, so an empty set reads them.
 */
const WALKED: readonly string[] = [
	FOLD_LABELS.password,
	FOLD_LABELS.organisation,
	...processorLinks(new Set()).map((link) => link.name),
	SITES_TITLE
];

describe('every page DEPLOY.md sends an operator to', () => {
	const document = readFileSync(join(import.meta.dirname, DOCUMENT), 'utf8');

	it('reads a name for every page it is guarding', () => {
		// the non-empty assertion every source-reading gate in this repo makes first. what is swept
		// here is a handful of records rather than a file per pattern, so this is the whole of it: a
		// name holding nothing would satisfy the case below by having nothing to look for.
		expect(WALKED.filter((name) => name.trim() === '')).toEqual([]);
	});

	it('reads a document that names pages at all', () => {
		// the other half of the same guard: a path that resolved to something without bold runs in it
		// would fail every case below rather than reporting that it read the wrong file.
		expect(document).toMatch(/\*\*[^*\n]+\*\*/);
	});

	it('names every one of them, spelled as the rail draws it', () => {
		// stated in bold, because that is how this document names a page — a bare substring would find
		// `Organisation` inside an ordinary sentence and read a page it never sends anyone to as sent
		// to.
		const unnamed = WALKED.filter((name) => !document.includes(`**${name}**`));
		expect(unnamed).toEqual([]);
	});
});
