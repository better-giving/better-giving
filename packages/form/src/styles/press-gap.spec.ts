import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// node pool: the sheets read as text, as ./font-mono.spec.ts reads them. a mark beside a press's
// words is spaced by the registry's flex gap, on the md tier and on each tier that restates it
// (../registry/styles/button-css.usage.md → Markup contract). a gap from the form's own sheets as
// well would outrank the registry's by order and put a second measure between the two, and none at
// all leaves the mark touching the words. modelled on "the space between a mark and its words" in
// packages/operator/src/styles/closed-press.spec.ts, which the form may not import (AGENTS.md →
// Workspace).

type Rule = { readonly selector: string; readonly stated: ReadonlyMap<string, string> };

const read = (path: string): string =>
	readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** every rule holding declarations, an at-rule's block read through to the rules inside it. */
function rulesIn(css: string): Rule[] {
	return [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)].map(([, selector = '', body = '']) => ({
		selector: selector.trim().replace(/\s+/g, ' '),
		stated: new Map(
			body
				.split(';')
				.map((declaration) => declaration.split(/:(.*)/s).map((side) => side.trim()))
				.filter((pair): pair is [string, string] => pair.length >= 2 && pair[0] !== '')
				.map(([property, value]) => [property, value.replace(/\s+/g, ' ')])
		)
	}));
}

const registry = rulesIn(read('../registry/styles/button-css.css'));
const form = ['./tokens.css', './parts.css', './layout.css', './motion.css'].flatMap((path) =>
	rulesIn(read(path)).map((rule) => ({ ...rule, path }))
);

/** a selector branch that reaches the registry's press: its class, or the action, which carries it. */
const reachesThePress = (branch: string): boolean =>
	/\.ds-btn\b/.test(branch) ||
	(/\[part~='action'\]/.test(branch) &&
		!/\[part~='action'\]:where\(:not\(\.ds-btn\)\)/.test(branch));

describe('the space between a mark and its words', () => {
	const TIERS = ['.ds-btn', '.ds-btn-sm', '.ds-btn-md', '.ds-btn-lg', '.ds-btn-field'];

	it('is drawn by the registry on every tier', () => {
		const gaps = TIERS.map(
			(tier) => registry.find(({ selector }) => selector === tier)?.stated.get('gap') ?? ''
		);
		expect(gaps.filter((gap) => !/^calc\(var\(--ds-spacing\) \* [\d.]+\)$/.test(gap))).toEqual([]);
	});

	it('is not restated on a press by the form’s sheets', () => {
		const restated = form
			.filter(({ selector }) => selector.split(',').some(reachesThePress))
			.filter(({ selector }) => !selector.includes('::'))
			.filter(({ stated }) => stated.has('gap') || stated.has('column-gap'))
			.map(({ path, selector }) => `${path} ${selector}`);
		expect(restated).toEqual([]);
	});
});
