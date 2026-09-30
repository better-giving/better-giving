import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './raw-values';

// what a sheet in this directory states, read as text by the specs beside it: the dom pool lays
// nothing out and computes no style (../../vitest.config.ts), and no /admin screen gets a
// `*.browser.spec.ts` (CLAUDE.md), so the rule a sheet writes is the claim a case can make about
// where something is drawn.
//
// the `.testing` suffix matches no pool's include glob, as ../components/render.testing.tsx's does.

// resolved through `fileURLToPath`, which ./field-on-a-tight-stack.dom.spec.tsx argues.
const here = dirname(fileURLToPath(import.meta.url));

/** a sheet in this directory with its comments blanked, as ./raw-values.ts blanks them. */
export function sheet(name: 'adm.css' | 'base.css' | 'tokens.css'): string {
	return stripComments(readFileSync(join(here, name), 'utf8'));
}

function declarations(body: string): Map<string, string> {
	const stated = new Map<string, string>();
	for (const declaration of body.split(';')) {
		const colon = declaration.indexOf(':');
		if (colon === -1) continue;
		stated.set(
			declaration.slice(0, colon).trim(),
			declaration
				.slice(colon + 1)
				.trim()
				.replace(/\s+/g, ' ')
		);
	}
	return stated;
}

/**
 * the declarations one rule states, by property, last one wins as css itself resolves them.
 *
 * the selector is matched from the start of its own line up to the rule's brace, which is what
 * keeps `.adm-state` from also matching the `.adm-table .adm-state` further down the sheet — and
 * what makes the first rule it matches the one read. a selector standing first in a list is on no
 * line of its own that ends in the brace, and is not found; an absent rule is an empty map.
 */
export function ruleOf(css: string, selector: string): Map<string, string> {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const found = css.match(new RegExp(`(?:^|\\n)[ \\t]*${escaped}\\s*\\{([^}]*)\\}`));
	return declarations(found?.[1] ?? '');
}

/** every innermost rule in a sheet: its selector list as written, and what it states. */
export function rulesIn(css: string): { selector: string; stated: Map<string, string> }[] {
	return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(([, head, body]) => ({
		selector: (head ?? '').trim().replace(/\s+/g, ' '),
		stated: declarations(body ?? '')
	}));
}
