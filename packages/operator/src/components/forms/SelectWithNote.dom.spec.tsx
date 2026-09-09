import { act, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { type Option, SelectWithNote } from './SelectWithNote.jsx';

// a list of choices a form submits. what a case here is about is the two things that make it one:
// a name, and a value that is not the words shown for it — a fund is chosen by name and recorded by
// id.
//
// a component spec is `.tsx` and both pools collect either extension — ./Field.dom.spec.tsx says
// why.

/** two funds, whose stored values are nothing an operator would recognise. */
const FUNDS: readonly Option[] = [
	{ value: 'acct_4417', label: 'General fund' },
	{ value: 'acct_9002', label: 'Building appeal' }
];

/** the control inside a form, which is the only place the name and value it submits are readable. */
function Bound() {
	return (
		<form>
			<SelectWithNote
				id="fund"
				label="Fund"
				name="revenue_account_id"
				options={FUNDS}
				defaultValue="acct_9002"
			/>
		</form>
	);
}

/** the control as a screen that keeps the choice draws it: the value is state and only state. */
function Held() {
	const [fund, setFund] = useState('acct_4417');
	return (
		<>
			<button type="button" onClick={() => setFund('acct_9002')}>
				pick the appeal
			</button>
			<SelectWithNote
				id="fund"
				label="Fund"
				name="revenue_account_id"
				options={FUNDS}
				value={fund}
				onChange={() => {}}
			/>
		</>
	);
}

function select(root: HTMLElement): HTMLSelectElement {
	const found = root.querySelector('select');
	if (found === null) throw new Error('the case drew no select to read');
	return found;
}

/** what the browser would send, as the pairs a form posts. */
function submitted(root: HTMLElement): [string, string][] {
	const form = root.querySelector('form');
	if (form === null) throw new Error('the case drew no form to read');
	return [...new FormData(form)].map(([name, value]) => [name, String(value)]);
}

describe('a select with a note mounted into a document', () => {
	it('submits a name, and the value an option carries rather than the words shown for it', () => {
		const root = render(Bound, {});

		expect(submitted(root)).toEqual([['revenue_account_id', 'acct_9002']]);
		expect([...select(root).options].map((o) => o.textContent)).toEqual([
			'General fund',
			'Building appeal'
		]);
	});

	it('holds the choice its caller states, and takes no other', () => {
		// a `value` mapped onto `defaultValue` is a control that ignores every change its caller then
		// makes to it, which is the defect ./Field.jsx carried until it took the attributes as
		// written. what proves it is the pointer moving the choice and the caller putting it back.
		const root = render(Held, {});

		act(() => {
			select(root).value = 'acct_9002';
			select(root).dispatchEvent(new Event('change', { bubbles: true }));
		});
		expect(select(root).value).toBe('acct_4417');

		act(() =>
			root.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		);
		expect(select(root).value).toBe('acct_9002');
	});

	it('announces the refusal, marks the control, and points it at a paragraph that exists', () => {
		// for ./Field.jsx's reason: a refusal is what a press answered with, and a message drawn
		// where the field is but never announced is one nobody using a reader is told about.
		// no options, so that this case is about the message and nothing else: the list is what
		// ./SelectWithNote.jsx's other cases are for.
		const root = render(SelectWithNote, {
			id: 'kind',
			label: 'Kind',
			name: 'kind',
			error: 'Choose a kind.'
		});

		expect(select(root).getAttribute('aria-invalid')).toBe('true');
		expect(select(root).getAttribute('class')).toContain('adm-select--invalid');
		expect(
			root.querySelector(`#${select(root).getAttribute('aria-describedby')}`)?.textContent
		).toBe('Choose a kind.');
		expect(root.querySelector('.adm-field__error')?.getAttribute('role')).toBe('alert');
	});

	it('draws a hint over the box, in the quiet register, and points the control at it', () => {
		// the hint is read before choosing, so it is above the box like ./Field.jsx's and is neither
		// a refusal nor the standing note: no live region, no marking.
		const root = render(SelectWithNote, {
			id: 'region',
			label: 'Region',
			name: 'region',
			options: FUNDS,
			hint: 'Choose the one closest to your donors.'
		});

		const hint = root.querySelector('.adm-hint');
		expect(hint?.textContent).toBe('Choose the one closest to your donors.');
		expect(hint?.nextElementSibling?.getAttribute('class')).toBe('adm-selectwrap');
		expect(select(root).getAttribute('aria-describedby')).toBe('region-hint');
		expect(select(root).getAttribute('aria-invalid')).toBeNull();
		expect(root.querySelector('[role="alert"]')).toBeNull();
	});

	it('keeps a retired option’s stored value under the words that say it is retired', () => {
		// an option no longer offered stays selected until another is chosen, and it is recorded by
		// the same value it always was.
		const root = render(SelectWithNote, {
			id: 'fund',
			label: 'Fund',
			name: 'revenue_account_id',
			options: FUNDS,
			retired: { value: 'acct_1188', label: 'Winter appeal' },
			defaultValue: 'acct_1188'
		});
		const last = [...select(root).options].at(-1);

		expect(last?.value).toBe('acct_1188');
		// the marker leads: appended after a name of any length it is the half a narrow select
		// truncates away, and the option then reads as one still on offer.
		expect(last?.textContent).toBe('No longer offered: Winter appeal');
	});
});
