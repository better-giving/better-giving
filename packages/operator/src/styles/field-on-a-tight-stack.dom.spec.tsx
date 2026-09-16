import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Button } from '../components/controls/Button.jsx';
import { Field } from '../components/forms/Field.jsx';
import { render } from '../components/render.testing';
import { Stack } from '../components/shell/Layout.jsx';
import { stripComments } from './raw-values';

// ./adm.css steps a labelled box standing on a tight stack, and the step is keyed on position:
// nothing in the markup asks for it, no component writes a class for it and no screen passes a
// prop. that is the decision — a gate screen added later cannot forget a rule it never states —
// and the cost is that the sheet is the only statement of it, so a selector re-keyed on a class no
// component wears goes on passing every gate in this repository. a dead selector draws nothing,
// errors nowhere and reads as fixed.
//
// so the selector list is read out of the sheet and matched against markup the real components
// rendered. what the browser is handed is what the cases below ask, and a field root that stopped
// wearing `.adm-field` fails here rather than on somebody's screen.
//
// the distances are read rather than laid out. ../../vitest.config.ts renders the dom pool into
// happy-dom, which lays nothing out, and no /admin screen gets a `*.browser.spec.ts` (CLAUDE.md) —
// so the claim a case can make about a step is the arithmetic of the tokens the sheet spends, and
// what a look at packages/gallery is for is whether that arithmetic reads.

// the two sheets, resolved off this module rather than off the working directory — and through
// `fileURLToPath` rather than `new URL().pathname`, because the dom pool's `URL` is happy-dom's and
// hands back a path with no directory in front of it.
const here = dirname(fileURLToPath(import.meta.url));
const css = stripComments(readFileSync(join(here, 'adm.css'), 'utf8'));
const tokens = stripComments(readFileSync(join(here, 'tokens.css'), 'utf8'));

/** the declarations one rule states, by property, matched from the start of its own line. */
function ruleOf(selector: string): Map<string, string> {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const found = css.match(new RegExp(`(?:^|\\n)[ \\t]*${escaped}\\s*\\{([^}]*)\\}`));
	const stated = new Map<string, string>();
	for (const declaration of (found?.[1] ?? '').split(';')) {
		const colon = declaration.indexOf(':');
		if (colon === -1) continue;
		stated.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
	}
	return stated;
}

/** a step of the scale as a number of rem, resolved in ./tokens.css where it is decided. */
function lengthIn(value: string | undefined): number {
	const token = value?.match(/^var\((--admin-space-\d+)\)$/)?.[1];
	if (token === undefined) throw new Error(`not a step of the spacing scale: ${value}`);
	const stated = tokens.match(new RegExp(`${token}:\\s*(0|[\\d.]+rem)\\s*;`))?.[1];
	if (stated === undefined) throw new Error(`${token} is not a length in ./tokens.css`);
	return Number.parseFloat(stated);
}

// the rule itself, found by what it does rather than by its selector spelled out again here: a
// spec holding its own copy of the selector proves the two strings match and nothing about the
// sheet. the tight stack states one margin and this is it.
const found = css.match(/\}([^{}]*\.adm-stack--tight[^{}]*)\{([^{}]*margin-block-start[^{}]*)\}/);
if (found?.[1] === undefined || found[2] === undefined)
	throw new Error('./adm.css steps nothing on a tight stack');

const SELECTORS = found[1]
	.split(',')
	.map((one) => one.trim())
	.filter(Boolean);
const DECLARATIONS = found[2]
	.split(';')
	.map((one) => one.trim())
	.filter(Boolean);
/** the one length the rule spends, as the sheet spells it. */
const STEP = DECLARATIONS[0]?.slice(DECLARATIONS[0].indexOf(':') + 1).trim();

/** the children of the stack a case rendered, in the order it wrote them. */
function itemsOf(root: HTMLElement): HTMLElement[] {
	const stack = root.firstElementChild;
	if (stack === null) throw new Error('nothing was mounted');
	return Array.from(stack.children) as HTMLElement[];
}

/** which of them the sheet's rule steps, named by the class each one wears. */
function stepped(root: HTMLElement): string[] {
	return itemsOf(root)
		.filter((item) => SELECTORS.some((selector) => item.matches(selector)))
		.map((item) => item.className);
}

/**
 * the sign-in screen's own shape, which is the one that was reported: two boxes, the way out for
 * somebody who cannot get in, and the press. the caption between the last box and the press is why
 * the rule steps whatever stands next to a field rather than the controls row by name — on this
 * screen the row is not what follows the box.
 */
const signIn = (
	<>
		<Field id="identifier" label="Username or email address" />
		<Field id="password" label="Password" type="password" />
		<p className="adm-caption">
			<a href="/forgot">Forgot your password?</a>
		</p>
		<div className="adm-actions">
			<Button variant="primary">Sign in</Button>
		</div>
	</>
);

describe('a field standing on a tight stack', () => {
	it('leaves an ordinary stack alone', () => {
		// the regression the rule is written to avoid: `.adm-stack--tight` carries `.adm-stack` too
		// (../components/shell/Layout.jsx), so a rule keyed one class too shallow moves every screen
		// in both surfaces and the diff is three lines.
		expect(stepped(render(Stack, { children: signIn }))).toEqual([]);
	});

	it('leaves a tight stack holding no field alone', () => {
		// what the tight stack is for and what it stays: a run of short blocks on a gate panel. the
		// step is a field's and a stack with none of them keeps the gap it had.
		const root = render(Stack, {
			tight: true,
			children: (
				<>
					<p>The closer run.</p>
					<p>Never the default.</p>
					<div className="adm-actions">
						<Button variant="primary">Continue</Button>
					</div>
				</>
			)
		});

		expect(stepped(root)).toEqual([]);
	});

	it('steps the box under a box, and whatever stands under the last one', () => {
		expect(stepped(render(Stack, { tight: true, children: signIn }))).toEqual([
			'adm-field',
			'adm-caption'
		]);
	});

	it('steps a row of controls standing directly under a box', () => {
		const root = render(Stack, {
			tight: true,
			children: (
				<>
					<Field id="staff-password" label="New password" type="password" />
					<div className="adm-actions">
						<Button variant="primary">Change it</Button>
					</div>
				</>
			)
		});

		expect(stepped(root)).toEqual(['adm-actions']);
	});

	it('gives the first box no space against the panel edge', () => {
		// the step is between siblings, so the box that opens the stack takes none — and the rule
		// states a start margin only, which is what leaves the box that closes it none either.
		const items = itemsOf(render(Stack, { tight: true, children: signIn }));
		const first = items[0];
		if (first === undefined) throw new Error('the stack drew nothing');

		expect(SELECTORS.some((selector) => first.matches(selector))).toBe(false);
		expect(DECLARATIONS.map((one) => one.split(':')[0]?.trim())).toEqual(['margin-block-start']);
	});

	it('stands two boxes further apart than a label stands from its own box', () => {
		// the whole of the defect, as the only arithmetic a pool that lays nothing out can do: the
		// boundary between two fields against the widest step a field spends inside itself.
		const boundary = lengthIn(ruleOf('.adm-stack--tight').get('gap')) + lengthIn(STEP);
		const inside = lengthIn(ruleOf('.adm-field > * + *').get('margin-block-start'));

		expect(boundary).toBeGreaterThan(inside);
		// and it is the step a fieldset already puts between one of its children and the next, so
		// two boxes stand the same distance apart whether or not a group is drawn around them.
		expect(boundary).toBe(lengthIn(ruleOf('.adm-fieldset > * + *').get('margin-block-start')));
	});
});
