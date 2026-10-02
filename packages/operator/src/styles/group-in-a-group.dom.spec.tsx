import { describe, expect, it } from 'vitest';
import { Field } from '../components/forms/Field.jsx';
import { PairedFieldset } from '../components/forms/PairedFieldset.jsx';
import { render } from '../components/render.testing';
import { ruleOf, rulesIn, sheet } from './sheet-rule.testing';

// ./adm.css moats a group standing inside another group, keyed on position as the stack's moat is:
// no component writes a class for it, so the sheet is the only statement of it and a selector that
// stopped matching the markup would go on passing every other gate. so the rule is found in the
// sheet by what it spends, and its selectors are matched against markup the real components drew —
// ./field-on-a-tight-stack.dom.spec.tsx argues the arrangement.

const css = sheet('adm.css');
const tokens = sheet('tokens.css');

/** a step of the spacing scale as a number of rem, resolved in ./tokens.css where it is decided. */
function rem(token: string): number {
	const stated = tokens.match(new RegExp(`${token}:\\s*(0|[\\d.]+rem)\\s*;`))?.[1];
	if (stated === undefined) throw new Error(`${token} is not a length in ./tokens.css`);
	return Number.parseFloat(stated);
}

/** the spacing tokens a value spends, summed: one `var()`, or a `calc()` adding several. */
function lengthIn(value: string | undefined): number {
	const spent = [...(value ?? '').matchAll(/var\((--admin-space-\d+)\)/g)].map(([, name]) => name);
	if (spent.length === 0) throw new Error(`not a step of the spacing scale: ${value}`);
	return spent.reduce((sum, name) => sum + rem(name as string), 0);
}

// the moat a stack gives a group, which is the token the group inside a group is moated by too.
const STACK_MOAT = ruleOf(css, '.adm-stack > .adm-fieldset:not(:first-child)').get(
	'margin-block-start'
);

const moat = rulesIn(css).find(
	({ selector, stated }) =>
		selector.startsWith('.adm-fieldset >') &&
		STACK_MOAT !== undefined &&
		(stated.get('margin-block-start') ?? '').includes(STACK_MOAT)
);
if (moat === undefined) throw new Error('./adm.css moats no group standing inside a group');

const SELECTORS = moat.selector.split(',').map((one) => one.trim());
const MOATED = moat.stated.get('margin-block-start');

/**
 * the add-a-gift screen's donor group, which is the one that was reported
 * (packages/app/src/routes/_app.admin.donations.new.tsx): a box, the name as a pair of its own,
 * then the email and phone pair the group draws without one.
 */
function DonorGroup() {
	return (
		<fieldset className="adm-fieldset">
			<legend className="adm-fieldset__legend">Donor</legend>
			<Field id="kind" label="Kind" />
			<PairedFieldset id="donation-add-name" legend="Name" side>
				<Field id="first_name" label="First name" />
				<Field id="last_name" label="Last name" />
			</PairedFieldset>
			<div className="adm-pair adm-pair--side">
				<Field id="primary_email" label="Email" optional />
				<Field id="primary_phone" label="Phone" optional />
			</div>
		</fieldset>
	);
}

/** the same group opening on its inner one, with nothing between the two names. */
function NameUnderTheLegend() {
	return (
		<fieldset className="adm-fieldset">
			<legend className="adm-fieldset__legend">Donor</legend>
			<PairedFieldset id="donation-add-name" legend="Name">
				<Field id="first_name" label="First name" />
				<Field id="last_name" label="Last name" />
			</PairedFieldset>
		</fieldset>
	);
}

/** the outer group's own items, in the order the screen writes them, named by the class each wears. */
function moated(root: HTMLElement): string[] {
	const group = root.firstElementChild;
	if (group === null) throw new Error('nothing was mounted');
	return Array.from(group.children)
		.filter((item) => SELECTORS.some((selector) => item.matches(selector)))
		.map((item) => item.className);
}

describe('a group standing inside a group', () => {
	it('is moated on both sides, and nothing else in the outer group is', () => {
		expect(moated(render(DonorGroup, {}))).toEqual(['adm-fieldset', 'adm-pair adm-pair--side']);
	});

	it('takes no moat directly under the name of the group around it', () => {
		expect(moated(render(NameUnderTheLegend, {}))).toEqual([]);
	});

	it('stands the box after it further off than a stacked pair stands its own two boxes', () => {
		// the whole of the defect, as the arithmetic a pool that lays nothing out can do: the step
		// across the inner group's edge against the step between the two boxes of a pair inside it.
		const inside = lengthIn(ruleOf(css, '.adm-pair').get('gap'));
		const step = lengthIn(ruleOf(css, '.adm-fieldset > * + *').get('margin-block-start'));

		expect(lengthIn(MOATED)).toBeGreaterThan(inside);
		// and the moat is added to the group's step rather than replacing it, as the stack's is
		// added to its gap.
		expect(lengthIn(MOATED)).toBe(step + lengthIn(STACK_MOAT));
	});
});
