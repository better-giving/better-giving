import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { CheckboxGroup, type CheckboxGroupProps } from './CheckboxGroup.jsx';

// what a picker is besides the boxes in it: a name and a value per box, so a form can submit it; a
// group that is a group only where it is not already one, and one whose name is in the tree without
// being on the screen; and a second line per choice that the box beside it points at rather than
// swallows into its own name.
//
// a component spec is `.tsx` and both pools collect either extension — ./Field.dom.spec.tsx says
// why.

/** the group inside a form, which is the only place the names and values it submits are readable. */
function Bound(props: CheckboxGroupProps) {
	return (
		<form>
			<CheckboxGroup {...props} />
		</form>
	);
}

/** what the browser would send, as `name=value` pairs in the order the boxes are drawn. */
function submitted(root: HTMLElement): string[] {
	const form = root.querySelector('form');
	if (form === null) throw new Error('the case drew no form to read');
	return [...new FormData(form)].map(([name, value]) => `${name}=${String(value)}`);
}

/** the boxes the group drew, so a case can ask one at a time. */
function boxes(root: HTMLElement): HTMLInputElement[] {
	return [...root.querySelectorAll('input')];
}

/** the element an id names, and what it says — `undefined` where nothing carries that id. */
function pointedAt(root: HTMLElement, id: string | null): string | undefined {
	return id === null ? undefined : (root.querySelector(`#${id}`)?.textContent ?? undefined);
}

describe('a checkbox group mounted into a document', () => {
	it('submits a name and the value each box carries', () => {
		// without both, the group renders and a form posts nothing: the ticked boxes are a picture
		// of a choice rather than the choice itself.
		const root = render(Bound, {
			id: 'cadences',
			name: 'cadences',
			legend: 'Cadences this form offers',
			items: [
				{ id: 'cadence-once', value: 'once', label: 'One-off', defaultChecked: true },
				{ id: 'cadence-monthly', value: 'monthly', label: 'Monthly' },
				{ id: 'cadence-yearly', value: 'yearly', label: 'Yearly', defaultChecked: true }
			]
		});

		expect(submitted(root)).toEqual(['cadences=once', 'cadences=yearly']);
	});

	it('is a set of radios where only one of the choices may be taken', () => {
		const root = render(CheckboxGroup, {
			id: 'account',
			name: 'account',
			type: 'radio',
			items: [
				{ id: 'account-a', value: 'a', label: 'Riverbank Trust' },
				{ id: 'account-b', value: 'b', label: 'Almshouses of St Mary' }
			]
		});

		expect(boxes(root).map((box) => box.type)).toEqual(['radio', 'radio']);
	});

	it('draws no group of its own where it is already inside one', () => {
		// a picker inside a section, or inside a fieldset the screen draws around more than this
		// group, is already named. a second fieldset around it tells a reader there are two groups
		// and gives the inner one no name at all.
		const root = render(CheckboxGroup, {
			id: 'account',
			name: 'account',
			items: [{ id: 'account-a', value: 'a', label: 'Riverbank Trust' }]
		});

		expect(root.querySelector('fieldset')).toBeNull();
	});

	it('draws a legend a reader can see where the screen states one', () => {
		const root = render(CheckboxGroup, {
			id: 'sites',
			name: 'allowed_origins',
			legend: 'Where this form may load',
			items: [{ id: 'site-a', value: 'riverbank.org', label: 'riverbank.org' }]
		});

		expect(root.querySelector('legend')?.className).toBe('adm-fieldset__legend');
	});

	it('keeps the name in the tree where the screen wants the legend off the screen', () => {
		// what a group already named by the heading over it takes: the word is not drawn twice and
		// the group is still named for a reader who cannot see the heading. `.adm-vh` is
		// ../../styles/base.css's, and ../../styles/adm.css is what takes the step off what follows a
		// legend nobody sees — so the class has to be that one and not a hidden of this file's own.
		const root = render(CheckboxGroup, {
			id: 'accounts',
			name: 'account',
			legend: 'Account',
			legendHidden: true,
			items: [{ id: 'account-a', value: 'a', label: 'Riverbank Trust' }]
		});
		const legend = root.querySelector('legend');

		expect(root.querySelector('fieldset')).not.toBeNull();
		expect(legend?.textContent).toBe('Account');
		expect(legend?.className).toBe('adm-vh');
	});

	it('draws the neutral second line for an identifier and the toned one for a warning', () => {
		// the two lines are different things and ../../styles/adm.css draws them differently: a
		// warning is read before the box is ticked, an identifier is what tells two choices with the
		// same name apart. toned like a warning, every row of a list where nothing is wrong carries a
		// colour.
		const root = render(CheckboxGroup, {
			id: 'account',
			name: 'account',
			items: [
				{ id: 'account-a', value: 'a', label: 'Riverbank Trust', sub: 'Account ID b4c1e29f' },
				{ id: 'account-b', value: 'b', label: 'Yearly', note: 'Needs a recurring-capable key' }
			]
		});

		expect(root.querySelector('#account-a-sub')?.getAttribute('class')).toBe('adm-check__sub');
		expect(root.querySelector('#account-b-note')?.getAttribute('class')).toBe('adm-check__note');
	});

	it('names a box by its choice alone and points it at the line beneath', () => {
		// wrapped in the label, the accessible name would be the choice followed by a sentence about
		// it, and a voice user cannot say a control whose name is a sentence.
		const root = render(CheckboxGroup, {
			id: 'account',
			name: 'account',
			items: [{ id: 'account-a', value: 'a', label: 'Riverbank Trust', sub: 'Account ID b4c1e29f' }]
		});
		const box = boxes(root)[0];

		expect(pointedAt(root, box?.getAttribute('aria-labelledby') ?? null)).toBe('Riverbank Trust');
		expect(pointedAt(root, box?.getAttribute('aria-describedby') ?? null)).toBe(
			'Account ID b4c1e29f'
		);
	});

	it('draws every box refused by the group’s message, and points each at a paragraph that exists', () => {
		// either box fixes the group and none of them is the wrong one, so the message is the
		// group's and every box wears it. it announces for ./Field.jsx's reason: a refusal is what a
		// press answered with.
		const root = render(CheckboxGroup, {
			id: 'sites',
			name: 'allowed_origins',
			legend: 'Where this form may load',
			error: 'Tick at least one site.',
			items: [
				{ id: 'site-a', value: 'riverbank.org', label: 'riverbank.org' },
				{ id: 'site-b', value: 'shop.riverbank.org', label: 'shop.riverbank.org' }
			]
		});

		expect(boxes(root).map((box) => box.getAttribute('aria-invalid'))).toEqual(['true', 'true']);
		expect(boxes(root).map((box) => pointedAt(root, box.getAttribute('aria-describedby')))).toEqual(
			['Tick at least one site.', 'Tick at least one site.']
		);
		expect(root.querySelector('.adm-field__error')?.getAttribute('role')).toBe('alert');
	});
});
