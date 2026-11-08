import { readFileSync } from 'node:fs';
import { stripComments } from '@better-giving/operator/styles/raw-values';
import { describe, expect, it } from 'vitest';
import { type Block, blocks, type Scope, substitute } from './page-colour.testing';

// red hat mono is declared at the weights ../../../../operator/src/styles/fonts.css gives it files
// for. a rule that sets the mono family at another weight is matched to a neighbour or synthesised
// without a word, so no sheet may ask for one. this reads the declared set off that sheet, then
// every rule that draws something in the mono face: /admin's operator styles, the hosted donor
// page (./page.css) and the form rules that page inherits for a mono element (the `.value` figures).
//
// a weight is rarely written on the rule that names the family: `.value` sets the family and
// `.entry.total .value.amount` sets the weight. so a rule is on a mono element when its last
// compound carries a class some single-class rule gives the mono family, or is an element some
// element-only rule gives it (`pre` in `.adm-slab pre`), unless another rule gives that very
// compound a different family (`.value.name`).
//
// a weight is asked inside a mono element too. ../../../../operator/src/styles/base.css sets `b`
// and `strong` to `bolder`, which computes from the parent's weight by css's table
// (https://drafts.csswg.org/css-fonts/#relative-weights), so an emphasis inside a mono element
// asks for a weight its own rule never wrote. each mono selector's own weight is run through that
// table, and the result has to be a shipped weight unless a rule pins `b` and `strong` inside that
// selector to one.

const read = (url: string) => readFileSync(new URL(url, import.meta.url), 'utf8');
const operator = (file: string) => read(`../../../../operator/src/styles/${file}`);
const form = (file: string) => read(`../../../../form/src/styles/${file}`);

const MONO_FAMILY = /Red Hat Mono|--admin-font-mono|--font-mono|--_font-mono|--page-font-mono/;

/** the weights fonts.css declares a file for in the Red Hat Mono family. */
function declaredMonoWeights(css: string): number[] {
	const weights = [...stripComments(css).matchAll(/@font-face\s*\{([^}]*)\}/g)]
		.filter(([, body = '']) => /font-family:\s*['"]Red Hat Mono['"]/.test(body))
		.map(([, body = '']) => Number(/font-weight:\s*(\d+)/.exec(body)?.[1]));
	return weights.sort((a, b) => a - b);
}

/** a selector list split at its top-level commas, so a comma inside `:is(…)` splits nothing. */
function splitList(list: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let from = 0;
	for (let i = 0; i < list.length; i++) {
		if (list[i] === '(') depth++;
		else if (list[i] === ')') depth--;
		else if (list[i] === ',' && depth === 0) {
			parts.push(list.slice(from, i));
			from = i + 1;
		}
	}
	parts.push(list.slice(from));
	return parts.map((s) => s.trim()).filter(Boolean);
}

/** a selector with each `:is(…)` in it replaced by every argument it lists, one selector each. */
function expandIs(selector: string): string[] {
	const at = selector.indexOf(':is(');
	if (at === -1) return [selector];
	let depth = 1;
	let end = at + ':is('.length;
	for (; depth > 0; end++) {
		if (end >= selector.length) throw new Error(`unbalanced :is() in ${selector}`);
		if (selector[end] === '(') depth++;
		else if (selector[end] === ')') depth--;
	}
	const inside = selector.slice(at + ':is('.length, end - 1);
	return splitList(inside).flatMap((one) =>
		expandIs(`${selector.slice(0, at)}${one}${selector.slice(end)}`)
	);
}

const selectors = (block: Block) => splitList(block.at.at(-1) ?? '').flatMap(expandIs);

const lastCompound = (selector: string) => selector.split(/\s*[\s>+~]\s*/).at(-1) ?? '';

/** a rule's font-weight as a number, with `var()`s followed through `scope`; undefined if it states none. */
function weightOf(block: Block, scope: Scope): number | undefined {
	const raw = block.decls['font-weight'];
	if (raw === undefined) return undefined;
	const value = substitute(scope, raw);
	const keyword = { normal: 400, bold: 700, bolder: 700, lighter: 100 }[value];
	return keyword ?? Number(value);
}

type Ask = { selector: string; weight: number };

/** every lone class or lone element a rule in these blocks sets the mono family on. */
function monoSelectors(all: readonly Block[]): string[] {
	return [
		...new Set(
			all
				.filter((b) => MONO_FAMILY.test(b.decls['font-family'] ?? ''))
				.flatMap(selectors)
				.filter((s) => /^(?:\.[\w-]+|[a-z][\w-]*)$/.test(s))
		)
	];
}

/** the weight `bolder` computes from a parent's, by the table in the header above. */
function bolder(parent: number): number {
	if (parent < 350) return 400;
	if (parent < 550) return 700;
	if (parent < 900) return 900;
	return parent;
}

/**
 * every `b` and `strong` inside a mono selector that lands on a weight `shipped` has no file for:
 * the weight a rule pins it to, or else `bolder` from the selector's own weight — the last one a
 * rule on that very selector states, and `normal` where none does.
 */
function syntheticBolds(sheets: readonly Block[][], scope: Scope, shipped: number[]): string[] {
	const all = sheets.flat();
	const stated = (selector: string) =>
		all
			.filter((b) => selectors(b).includes(selector))
			.map((b) => weightOf(b, scope))
			.filter((w): w is number => w !== undefined)
			.at(-1);
	return monoSelectors(all).flatMap((selector) =>
		['b', 'strong'].flatMap((tag) => {
			const weight = stated(`${selector} ${tag}`) ?? bolder(stated(selector) ?? 400);
			return shipped.includes(weight) ? [] : [`${selector} ${tag}: ${weight}`];
		})
	);
}

/** every (selector, weight) a rule in these sheets asks of an element drawn in the mono face. */
function monoAsks(sheets: readonly Block[][], scope: Scope, pageSheet: readonly Block[]): Ask[] {
	const all = sheets.flat();
	const own = (block: Block) => block.decls['font-family'];
	const mono = monoSelectors(all);
	const monoClasses = new Set(mono.filter((s) => s.startsWith('.')).map((s) => s.slice(1)));
	const monoElements = new Set(mono.filter((s) => !s.startsWith('.')));
	const resets = new Set(
		all
			.filter((b) => own(b) !== undefined && !MONO_FAMILY.test(own(b) ?? ''))
			.flatMap(selectors)
			.map(lastCompound)
	);
	// the hosted page restates a form rule under `.page`, and the restatement is what applies there.
	const restated = new Set(
		pageSheet
			.filter((b) => b.decls['font-weight'] !== undefined)
			.flatMap(selectors)
			.filter((s) => s.startsWith('.page '))
			.map((s) => s.slice('.page '.length))
	);
	const asks: Ask[] = [];
	for (const block of all) {
		const weight = weightOf(block, scope);
		if (weight === undefined) continue;
		for (const selector of selectors(block)) {
			const compound = lastCompound(selector);
			const classes = [...compound.matchAll(/\.([\w-]+)/g)].map((m) => m[1] ?? '');
			const element = /^[a-z][\w-]*/.exec(compound)?.[0];
			const onMono =
				MONO_FAMILY.test(own(block) ?? '') ||
				(!resets.has(compound) &&
					(classes.some((c) => monoClasses.has(c)) ||
						(element !== undefined && monoElements.has(element))));
			if (onMono && !restated.has(selector)) asks.push({ selector, weight });
		}
	}
	return asks;
}

const tokens = blocks(operator('tokens.css'));
const formTokens = blocks(form('tokens.css'));
const pageSheet = blocks(read('./page.css'));
const formSheets = [blocks(form('parts.css')), blocks(form('coins.css'))];
const operatorSheets = [blocks(operator('base.css')), blocks(operator('adm.css'))];

// custom properties only, in source order: the operator's weight ladder, the form's, and the weight
// the hosted page sets for a figure it sends (`--_w-sent`, on `.page div`).
const scope: Scope = Object.assign(
	{},
	...[...tokens, ...formTokens, ...pageSheet].map((b) =>
		Object.fromEntries(Object.entries(b.decls).filter(([name]) => name.startsWith('--')))
	)
);

const shipped = declaredMonoWeights(operator('fonts.css'));

describe('the weights asked of the mono face', () => {
	it('are the ones fonts.css declares a file for', () => {
		expect(shipped.length).toBeGreaterThan(0);
		expect(
			declaredMonoWeights(`@font-face { font-family: "Red Hat Mono"; font-weight: 500; }
			@font-face { font-family: "Red Hat Text"; font-weight: 700; }`)
		).toEqual([500]);
	});

	it('are found on the rules that draw a mono element', () => {
		const asks = monoAsks([...operatorSheets, pageSheet], scope, pageSheet);
		expect(asks.map((a) => a.selector)).toContain('.adm-code');
		// the live read: the donor page's total is restated at the medium weight, so it is found
		// when the page restatement is withheld and the form's own 600 stands.
		const unrestated = monoAsks([...formSheets], scope, []);
		expect(unrestated).toContainEqual({ selector: '.entry.total .value.amount', weight: 600 });
	});

	it('reads an element-only rule and a selector inside `:is()` into the mono set', () => {
		const sheet = blocks(`code, kbd { font-family: var(--admin-font-mono); }
			:is(.adm-code, .adm-url) { font-family: var(--admin-font-mono); }
			.adm-slab pre { font-family: var(--admin-font-mono); }`);
		expect(monoSelectors(sheet).sort()).toEqual(['.adm-code', '.adm-url', 'code', 'kbd']);
		expect(monoSelectors(operatorSheets.flat())).toEqual(
			expect.arrayContaining(['code', 'kbd', 'samp', 'pre', '.adm-code', '.adm-chip'])
		);
	});

	it('reports a bold inside a mono element with no file at the weight it computes', () => {
		expect([349, 350, 549, 550, 899, 900].map(bolder)).toEqual([400, 700, 700, 900, 900, 900]);
		const bare = blocks(`code { font-family: var(--admin-font-mono); }
			b, strong { font-weight: bolder; }`);
		expect(syntheticBolds([bare], {}, [400, 500])).toEqual(['code b: 700', 'code strong: 700']);
		const pinned = blocks(`code { font-family: var(--admin-font-mono); }
			b, strong { font-weight: bolder; }
			code :is(b, strong) { font-weight: 500; }`);
		expect(syntheticBolds([pinned], {}, [400, 500])).toEqual([]);
	});

	it('land on a file for every bold inside a mono element in /admin', () => {
		// the hosted donor page draws its mono figures as text the card sets, never markup a `b`
		// could stand in, so the operator sheets are the whole of where one can.
		expect(syntheticBolds(operatorSheets, scope, shipped)).toEqual([]);
	});

	it('are all declared, in /admin and on the hosted donor page', () => {
		const asks = monoAsks([...operatorSheets, pageSheet, ...formSheets], scope, pageSheet);
		const undeclared = asks.filter((ask) => !shipped.includes(ask.weight));
		expect(undeclared).toEqual([]);
	});
});
