import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from '../styles/raw-values';

// which rung draws a rendered control closed, read out of the sheets and matched against the
// element rather than spelled again here: a spec holding its own copy of the selector proves two
// strings match and nothing about what the browser is handed. the dom pool lays nothing out and
// computes no style, so the rule a control matches is the claim a case can make. the sheets are
// ../styles/adm.css and the registry's button (../registry/styles/button-css.css), which draws a
// press closed by `disabled` or `aria-disabled`.
//
// a closed rung is found by what it draws — one of the disabled inks — and a rung for a press
// in flight is not one: it holds the rank's active look, which is working rather than closed.
//
// the `.testing` suffix matches no pool's include glob, as ./render.testing.tsx's does.

// resolved through `fileURLToPath`, which ../styles/field-on-a-tight-stack.dom.spec.tsx argues.
const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => stripComments(readFileSync(join(here, path), 'utf8'));

/** a sheet's rules, as the selector list it spells and the body it states. */
const rules = (css: string) =>
	[...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(([, head, body]) => ({
		head: (head ?? '').trim(),
		body: body ?? ''
	}));

const CLOSED_INK = /color:\s*var\(--admin-(?:control|primary|button)-ink-disabled\)/;
/** the registry's closed ink, on a rule keyed on a closed state. */
const REGISTRY_CLOSED_INK = /color:\s*var\(--gray-11\)/;
const CLOSED_STATE = /:disabled|\[aria-disabled/;

const closedRungs = [
	...rules(read('../registry/styles/button-css.css')).filter(
		({ head, body }) => CLOSED_STATE.test(head) && REGISTRY_CLOSED_INK.test(body)
	),
	...rules(read('../styles/adm.css')).filter(({ body }) => CLOSED_INK.test(body))
]
	.map(({ head }) => head)
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
 * the last closed rung `element` matches, as its sheet spells its selector list, or null where
 * none does. the last, because rungs of equal weight are settled by order and a rank's own rung
 * stands after the base one it answers, and ../styles/adm.css is read after the registry's sheet.
 */
export function closedRungOf(element: Element): string | null {
	const matched = closedRungs.filter((head) =>
		head.split(',').some((one) => matches(element, one.trim()))
	);
	return matched.at(-1) ?? null;
}
