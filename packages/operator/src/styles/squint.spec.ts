import { describe, expect, it } from 'vitest';
import { ruleOf, rulesIn, sheet } from './sheet-rule.testing';

// the squint test the head of the fields section in ./adm.css states: inside a field, between two
// fields, between two groups — three tiers, each wider than the one inside it. a label reads as its
// own box's only while the step down to that box is shorter than the step down to the next field's
// label, and a group reads as one only while the step out of it is longer than any step inside it.
// under the three is a fourth: the sentence under a label or a group's name stands closer to it than
// the box does, so the two read as one head.
//
// every step is read off the sheet as it is written and resolved through ./tokens.css, so a step
// moved in one rule and not in another fails here rather than on a screen nobody squinted at. the
// pool lays nothing out (../../vitest.config.ts), so what a case can claim is the arithmetic of the
// tokens a rule spends; whether that arithmetic reads is what packages/gallery is opened for.

const css = sheet('adm.css');
const tokens = sheet('tokens.css');

/** a step of the spacing scale, in rem, as ./tokens.css decides it. */
function step(token: string): number {
	const stated = tokens.match(new RegExp(`${token}:\\s*(0|[\\d.]+rem)\\s*;`))?.[1];
	if (stated === undefined) throw new Error(`${token} is not a length in ./tokens.css`);
	return Number.parseFloat(stated);
}

/** a length a rule spends — one step, or a sum of steps — in rem. */
function length(value: string | undefined): number {
	if (value === undefined) throw new Error('the rule states no such length');
	const terms = [...value.matchAll(/var\((--admin-space-\d+)\)/g)].map((m) => m[1] ?? '');
	if (terms.length === 0) throw new Error(`not a step of the spacing scale: ${value}`);
	return terms.reduce((sum, token) => sum + step(token), 0);
}

/** what a rule states, found by a selector anywhere in its list. */
function stated(selector: string, property: string): number {
	const rule = rulesIn(css).find((one) => one.selector.split(', ').includes(selector));
	return length(rule?.stated.get(property));
}

const hints = {
	'a field': length(
		ruleOf(css, '.adm-field > .adm-field__label + .adm-hint').get('margin-block-start')
	),
	'a group': length(
		ruleOf(css, '.adm-fieldset > .adm-fieldset__legend + .adm-hint').get('margin-block-start')
	)
};

const inside = [
	length(ruleOf(css, '.adm-field > * + *').get('margin-block-start')),
	length(ruleOf(css, '.adm-fieldset > .adm-fieldset__legend + *').get('margin-block-start')),
	length(
		ruleOf(css, '.adm-fieldset > .adm-fieldset__legend + .adm-hint + *').get('margin-block-start')
	)
];

const between = {
	'a stack': length(ruleOf(css, '.adm-stack').get('gap')),
	'a group': length(ruleOf(css, '.adm-fieldset > * + *').get('margin-block-start')),
	'a pair': length(ruleOf(css, '.adm-pair').get('gap')),
	'a tight stack':
		length(ruleOf(css, '.adm-stack--tight').get('gap')) +
		stated('.adm-stack--tight > * + .adm-field', 'margin-block-start')
};

const groups = {
	'groups side by side': length(ruleOf(css, '.adm-groups').get('gap')),
	'a group on a stack':
		length(ruleOf(css, '.adm-stack').get('gap')) +
		length(ruleOf(css, '.adm-stack > .adm-fieldset:not(:first-child)').get('margin-block-start')),
	'a group inside a group': stated(
		".adm-fieldset > .adm-fieldset + :not([type='hidden'])",
		'margin-block-start'
	)
};

describe('the squint test on every operator form', () => {
	it('stands a sentence nearer its label than the label stands to its box', () => {
		for (const [where, gap] of Object.entries(hints)) {
			expect(gap, `the sentence under ${where}'s name`).toBeLessThan(Math.min(...inside));
		}
	});

	it('stands a head one step off what it names, with a sentence under it or without', () => {
		expect(new Set(inside).size).toBe(1);
	});

	it('stands a label nearest its own box', () => {
		for (const [where, gap] of Object.entries(between)) {
			expect(gap, `two fields in ${where}`).toBeGreaterThan(Math.max(...inside));
		}
	});

	it('stands two fields one step apart, whatever holds them', () => {
		expect(new Set(Object.values(between)).size).toBe(1);
	});

	it('stands two fields at least twice as far apart as a label from its box', () => {
		// "clearly larger": a rung or two up the scale is a difference a squint loses.
		for (const gap of Object.values(between)) {
			expect(gap).toBeGreaterThanOrEqual(2 * Math.max(...inside));
		}
	});

	it('stands one group further from the next than two fields stand apart', () => {
		for (const [where, gap] of Object.entries(groups)) {
			expect(gap, where).toBeGreaterThan(Math.max(...Object.values(between)));
		}
	});
});
