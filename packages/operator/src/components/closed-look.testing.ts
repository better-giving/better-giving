import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from '../styles/raw-values';

// which rung of ../styles/adm.css draws a rendered control closed, read out of the sheet and
// matched against the element rather than spelled again here: a spec holding its own copy of the
// selector proves two strings match and nothing about what the browser is handed. the dom pool lays
// nothing out and computes no style, so the rule a control matches is the claim a case can make.
//
// a closed rung is found by what it draws — one of the two disabled inks — and a rung for a press
// in flight is not one: it holds the rank's active look, which is working rather than closed.
//
// the `.testing` suffix matches no pool's include glob, as ./render.testing.tsx's does.

// resolved through `fileURLToPath`, which ../styles/field-on-a-tight-stack.dom.spec.tsx argues.
const here = dirname(fileURLToPath(import.meta.url));
const sheet = stripComments(readFileSync(join(here, '../styles/adm.css'), 'utf8'));

const CLOSED_INK = /color:\s*var\(--admin-(?:control|primary)-ink-disabled\)/;

const closedRungs = [...sheet.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
	.filter(([, , body]) => CLOSED_INK.test(body ?? ''))
	.map(([, head]) => (head ?? '').trim())
	.filter((head) => !head.includes('aria-busy'));

/** a selector the dom pool cannot parse matches nothing rather than failing the case. */
function matches(element: Element, selector: string): boolean {
	try {
		return element.matches(selector);
	} catch {
		return false;
	}
}

/**
 * the last closed rung `element` matches, as the sheet spells its selector list, or null where
 * none does. the last, because rungs of equal weight are settled by order and a rank's own rung
 * stands after the base one it answers.
 */
export function closedRungOf(element: Element): string | null {
	const matched = closedRungs.filter((head) =>
		head.split(',').some((one) => matches(element, one.trim()))
	);
	return matched.at(-1) ?? null;
}
