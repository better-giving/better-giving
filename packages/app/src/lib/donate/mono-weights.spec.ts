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
// compound carries a class some single-class rule gives the mono family, unless another rule
// gives that very compound a different family (`.value.name`).

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

const selectors = (block: Block) =>
	(block.at.at(-1) ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

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

/** every (selector, weight) a rule in these sheets asks of an element drawn in the mono face. */
function monoAsks(sheets: readonly Block[][], scope: Scope, pageSheet: readonly Block[]): Ask[] {
	const all = sheets.flat();
	const own = (block: Block) => block.decls['font-family'];
	const monoClasses = new Set(
		all
			.filter((b) => MONO_FAMILY.test(own(b) ?? ''))
			.flatMap(selectors)
			.filter((s) => /^\.[\w-]+$/.test(s))
			.map((s) => s.slice(1))
	);
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
			const onMono =
				MONO_FAMILY.test(own(block) ?? '') ||
				(!resets.has(compound) && classes.some((c) => monoClasses.has(c)));
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

	it('are all declared, in /admin and on the hosted donor page', () => {
		const asks = monoAsks([...operatorSheets, pageSheet, ...formSheets], scope, pageSheet);
		const undeclared = asks.filter((ask) => !shipped.includes(ask.weight));
		expect(undeclared).toEqual([]);
	});
});
