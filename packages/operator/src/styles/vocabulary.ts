import { readFileSync } from 'node:fs';
import { stripComments } from './raw-values';

// what the sheets beside this file draw, as findings a caller hands a file list.
//
// it exists for the half a class-name sweep cannot read. a component assembles most of its class
// list — `` `adm-btn--${variant}` `` — so the name never appears in the source as a literal, and
// the only thing standing between the stem and the sheet is the union the prop takes. a member of
// that union with no rule behind it is a control that type-checks, renders, and paints nothing.
// ../components/closed-sets.spec.ts is where the two are put beside each other.
//
// it returns findings rather than asserting them, the way ./raw-values.ts does and for the same
// reason: the caller is the one that knows which sheets it meant to read, and a finding already
// carries the name its `expect(...).toEqual(...)` prints.
//
// comments are blanked by ./raw-values.ts's `stripComments` rather than by a second stripper of
// this file's own, for the reason that file's header gives: two answers to what counts as a
// comment here is how a hatch comes to be documented and dead. it is load bearing either way —
// the sheets in this repository carry long comments, and a comment names rules it does not draw.

/**
 * every `--modifier` the given sheets draw under one stem, as the suffixes alone.
 *
 * the stem is matched up to its own `--`, so a nested element's modifier is not one of the parent's:
 * `.adm-status__step--done` answers `adm-status__step` and never `adm-status`.
 */
export function modifiersDefinedIn(files: readonly string[], stem: string): ReadonlySet<string> {
	const found = new Set<string>();
	const pattern = new RegExp(`\\.${stem}--([\\w-]+)`, 'g');
	for (const file of files) {
		for (const [, name] of stripComments(readFileSync(file, 'utf8')).matchAll(pattern)) {
			if (name !== undefined) found.add(name);
		}
	}
	return found;
}

/**
 * every `is-*` state class the given sheets draw, as the names alone.
 *
 * read as a bare name rather than as the compound it sits in, which is the right reading for the
 * question the caller asks: which states exist at all in this vocabulary. whether a component's own
 * classes are in the compound beside one is ../components/pinned-states.spec.ts's question, and it
 * reads the same sheets the other way round to answer it.
 */
export function statesDefinedIn(files: readonly string[]): ReadonlySet<string> {
	const found = new Set<string>();
	for (const file of files) {
		for (const [, name] of stripComments(readFileSync(file, 'utf8')).matchAll(/\.is-([\w-]+)/g)) {
			if (name !== undefined) found.add(name);
		}
	}
	return found;
}
