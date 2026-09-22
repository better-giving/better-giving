import { act, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mount, render } from '../render.testing';
import { type Option, SelectWithNote } from './SelectWithNote.jsx';

// a list of choices a form submits. what a case here is about is the two things that make it one:
// a name, and a value that is not the words shown for it — a fund is chosen by name and recorded by
// id. the machine's own listbox roles and arrow keys are ark's and are not restated.
//
// a component spec is `.tsx` and both pools collect either extension — ./Field.dom.spec.tsx says
// why.

/** two funds, whose stored values are nothing an operator would recognise. */
const FUNDS: readonly Option[] = [
	{ value: 'acct_4417', label: 'General fund' },
	{ value: 'acct_9002', label: 'Building appeal' }
];

/** the control inside a form, which is the only place the name and value it submits are readable. */
function Bound(props: { readonly defaultValue?: string; readonly disabled?: boolean }) {
	return (
		<form>
			<SelectWithNote
				id="fund"
				label="Fund"
				name="revenue_account_id"
				options={FUNDS}
				defaultValue={props.defaultValue}
				disabled={props.disabled}
			/>
		</form>
	);
}

/** the control as a screen that keeps the choice draws it: the value is state and only state. */
function Held() {
	const [fund, setFund] = useState('acct_4417');
	return (
		<form>
			<button type="button" onClick={() => setFund('acct_9002')}>
				pick the appeal
			</button>
			<SelectWithNote
				id="fund"
				label="Fund"
				name="revenue_account_id"
				options={FUNDS}
				value={fund}
				onValueChange={() => {}}
			/>
		</form>
	);
}

function trigger(root: HTMLElement): HTMLButtonElement {
	const found = root.querySelector<HTMLButtonElement>('button[role="combobox"]');
	if (found === null) throw new Error('the case drew no box to press');
	return found;
}

function hidden(root: HTMLElement): HTMLSelectElement {
	const found = root.querySelector('select');
	if (found === null) throw new Error('the case drew no form control to read');
	return found;
}

/** the rows the list holds, by the words each one draws. */
function rows(root: HTMLElement): string[] {
	return [...root.querySelectorAll('.adm-selectrow')].map((row) => row.textContent ?? '');
}

/** what the browser would send, as the pairs a form posts. */
function submitted(root: HTMLElement): [string, string][] {
	const form = root.querySelector('form');
	if (form === null) throw new Error('the case drew no form to read');
	return [...new FormData(form)].map(([name, value]) => [name, String(value)]);
}

/**
 * a key pressed wherever focus stands, which is the box until the list opens and the list after.
 * async, because the machine settles on a microtask: a synchronous `act` returns before the render
 * the key caused, and every assertion after it would read the box as it was.
 */
async function press(key: string): Promise<void> {
	await act(async () => {
		document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
	});
}

/** the row carrying these words, pressed. the list is open by then. */
async function choose(root: HTMLElement, words: string): Promise<void> {
	await act(async () => {
		trigger(root).click();
	});
	const row = [...root.querySelectorAll<HTMLElement>('.adm-selectrow')].find(
		(node) => node.textContent === words
	);
	if (row === undefined) throw new Error(`the list holds no row reading ${words}`);
	await act(async () => {
		row.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
		row.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
		row.click();
	});
}

describe('a select with a note mounted into a document', () => {
	it('submits a name, and the value an option carries rather than the words shown for it', () => {
		const root = render(Bound, { defaultValue: 'acct_9002' });

		expect(submitted(root)).toEqual([['revenue_account_id', 'acct_9002']]);
		expect(trigger(root).textContent).toBe('Building appeal');
		expect(rows(root)).toEqual(['General fund', 'Building appeal']);
	});

	it('shows and submits the first line where nothing is seeded, as a native select does', () => {
		const root = render(Bound, {});

		expect(submitted(root)).toEqual([['revenue_account_id', 'acct_4417']]);
		expect(trigger(root).textContent).toBe('General fund');
	});

	it('holds a line whose value is empty as a line, and not as nothing chosen', () => {
		// the blank line a list opens on — `Choose a program` — is chosen, drawn and submitted like any
		// other.
		const root = render(
			() => (
				<form>
					<SelectWithNote
						id="program"
						label="Program"
						name="program_id"
						options={[{ value: '', label: 'Choose a program' }, ...FUNDS]}
						defaultValue=""
					/>
				</form>
			),
			{}
		);

		expect(trigger(root).textContent).toBe('Choose a program');
		expect([...hidden(root).options].map((option) => option.value)).toEqual([
			'',
			'acct_4417',
			'acct_9002'
		]);
		expect(submitted(root)).toEqual([['program_id', '']]);
	});

	it('submits the line chosen', async () => {
		const root = render(Bound, {});

		await choose(root, 'Building appeal');

		expect(submitted(root)).toEqual([['revenue_account_id', 'acct_9002']]);
		expect(trigger(root).textContent).toBe('Building appeal');
	});

	it('hands the value of the line chosen to its caller', async () => {
		const chosen = vi.fn();
		const root = render(SelectWithNote, {
			id: 'fund',
			label: 'Fund',
			name: 'fund',
			options: FUNDS,
			onValueChange: chosen
		});

		await choose(root, 'Building appeal');

		expect(chosen).toHaveBeenCalledWith('acct_9002');
	});

	it('says a choice out loud, so the form layer counting events hears it', async () => {
		// the machine dispatches `change` alone, and what arms a save button and what conform listens
		// to are both `input`.
		const heard: string[] = [];
		const root = render(
			() => (
				<form onInput={(event) => heard.push((event.target as HTMLSelectElement).name)}>
					<SelectWithNote id="fund" label="Fund" name="fund" options={FUNDS} />
				</form>
			),
			{}
		);

		await choose(root, 'Building appeal');

		// once, and only once: the event is marked the way the machine marks its own, and a marker
		// the machine stopped recognising would read the event back as a second choice — twice at
		// best and without end at worst.
		expect(heard).toEqual(['fund']);
	});

	it('holds the choice its caller states, and takes no other', async () => {
		// a `value` mapped onto `defaultValue` is a control that ignores every change its caller then
		// makes to it, which is the defect ./Field.jsx carried until it took the attributes as
		// written. what proves it is the pointer moving the choice and the caller keeping it.
		const root = render(Held, {});

		await choose(root, 'Building appeal');
		expect(trigger(root).textContent).toBe('General fund');
		expect(submitted(root)).toEqual([['revenue_account_id', 'acct_4417']]);

		await act(async () => {
			root.querySelector<HTMLButtonElement>('button:not([role])')?.click();
		});
		expect(trigger(root).textContent).toBe('Building appeal');
		expect(submitted(root)).toEqual([['revenue_account_id', 'acct_9002']]);
	});

	it('follows a new seed, and a form reset goes back to that one', async () => {
		// the reading a landed write leaves behind is a new seed, and what a put-back resets to has
		// to be that reading rather than the one the page opened on.
		const { root, again } = mount(Bound, { defaultValue: 'acct_4417' });

		again({ defaultValue: 'acct_9002' });
		// the machine settles its new draw on a microtask.
		await act(async () => {});
		expect(submitted(root)).toEqual([['revenue_account_id', 'acct_9002']]);

		await choose(root, 'General fund');
		await act(async () => root.querySelector('form')?.reset());

		expect(trigger(root).textContent).toBe('Building appeal');
		expect(submitted(root)).toEqual([['revenue_account_id', 'acct_9002']]);
	});

	it('resets to its seed after the list it offers has changed', async () => {
		// a list re-read under a form — an account added to the chart — is a new collection and the
		// same seed, and a put-back still lands on that seed rather than on whatever the new list
		// happens to open on.
		function Listed(props: { readonly options: readonly Option[] }) {
			return (
				<form>
					<SelectWithNote
						id="fund"
						label="Fund"
						name="revenue_account_id"
						options={props.options}
						defaultValue="acct_9002"
					/>
				</form>
			);
		}
		const { root, again } = mount(Listed, { options: FUNDS });

		again({ options: [{ value: 'acct_1000', label: 'Endowment' }, ...FUNDS] });
		await act(async () => {});
		await choose(root, 'Endowment');
		await act(async () => root.querySelector('form')?.reset());

		expect(trigger(root).textContent).toBe('Building appeal');
		expect(submitted(root)).toEqual([['revenue_account_id', 'acct_9002']]);
	});

	it('draws no list at all where it has no lines to offer', async () => {
		// the note under an empty box says why it is empty, and a bare surface opened over it would
		// cover the one sentence that does.
		const root = render(SelectWithNote, {
			id: 'fund',
			label: 'Fund',
			name: 'fund',
			note: 'No funds have been created yet.'
		});

		await act(async () => trigger(root).click());

		expect(root.querySelector('.adm-selectlist')).toBeNull();
	});

	it('keeps a retired option chosen, last, and under the words that say it is retired', () => {
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

		// the marker leads: appended after a name of any length it is the half a narrow box truncates
		// away, and the option then reads as one still on offer.
		expect(rows(root).at(-1)).toBe('No longer offered: Winter appeal');
		expect(trigger(root).textContent).toBe('No longer offered: Winter appeal');
		expect(hidden(root).value).toBe('acct_1188');
	});

	it('announces the refusal, marks the control, and points it at a paragraph that exists', () => {
		// for ./Field.jsx's reason: a refusal is what a press answered with, and a message drawn
		// where the field is but never announced is one nobody using a reader is told about.
		const root = render(SelectWithNote, {
			id: 'kind',
			label: 'Kind',
			name: 'kind',
			options: FUNDS,
			error: 'Choose a kind.'
		});

		expect(trigger(root).getAttribute('aria-invalid')).toBe('true');
		expect(trigger(root).hasAttribute('data-invalid')).toBe(true);
		expect(
			root.querySelector(`#${trigger(root).getAttribute('aria-describedby')}`)?.textContent
		).toBe('Choose a kind.');
		expect(root.querySelector('.adm-field__error')?.getAttribute('role')).toBe('alert');
	});

	it('marks the control a larger rule refused, with no message of its own', () => {
		const root = render(SelectWithNote, {
			id: 'kind',
			label: 'Kind',
			name: 'kind',
			options: FUNDS,
			'aria-invalid': 'true'
		});

		expect(trigger(root).getAttribute('aria-invalid')).toBe('true');
		expect(root.querySelector('[role="alert"]')).toBeNull();
	});

	it('draws a hint over the box, in the quiet register, and points the control at it', () => {
		// the hint is read before choosing, so it is above the box like ./Field.jsx's and is neither
		// a refusal nor the standing note: no live region, no marking.
		const root = render(SelectWithNote, {
			id: 'region',
			label: 'Region',
			name: 'region',
			options: FUNDS,
			hint: 'Choose the one closest to your donors.',
			note: 'A region added in the last minute may not be here yet.'
		});

		const hint = root.querySelector('.adm-hint');
		expect(hint?.textContent).toBe('Choose the one closest to your donors.');
		expect(hint?.nextElementSibling?.getAttribute('class')).toBe('adm-selectwrap');
		expect(trigger(root).getAttribute('aria-describedby')).toBe('region-hint region-note');
		expect(trigger(root).getAttribute('aria-invalid')).not.toBe('true');
		expect(root.querySelector('[role="alert"]')).toBeNull();
	});

	it('is described by the blocks its caller names, where the caller names them', () => {
		const root = render(SelectWithNote, {
			id: 'region',
			label: 'Region',
			options: FUNDS,
			hint: 'Choose the one closest to your donors.',
			'aria-describedby': 'somewhere-else'
		});

		expect(trigger(root).getAttribute('aria-describedby')).toBe('somewhere-else');
	});

	it('is named by its label, and the box is what the label points at', () => {
		const root = render(SelectWithNote, { id: 'fund', label: 'Fund', options: FUNDS });

		expect(root.querySelector('label')?.getAttribute('for')).toBe('fund');
		expect(trigger(root).id).toBe('fund');
		expect(trigger(root).getAttribute('aria-labelledby')).toBe('fund-label');
		expect(root.querySelector('[role="listbox"]')?.getAttribute('aria-labelledby')).toBe(
			'fund-label'
		);
	});

	it('is unusable and sends nothing while its caller closes it', () => {
		const root = render(Bound, { disabled: true });

		expect(trigger(root).disabled).toBe(true);
		expect(trigger(root).hasAttribute('data-disabled')).toBe(true);
		// read off the element rather than off `FormData`: happy-dom's form data carries a disabled
		// select that a browser's leaves out.
		expect(hidden(root).disabled).toBe(true);
	});

	it('hands a focus move made by name on to the box', () => {
		// a form layer moving focus to the first refused control walks the form's elements by name,
		// and the one carrying the name here is the machine's hidden select.
		const root = render(Bound, {});

		act(() => hidden(root).focus());

		expect(document.activeElement).toBe(trigger(root));
	});

	it('opens from the keyboard and takes the line it lands on', async () => {
		const root = render(Bound, {});
		act(() => trigger(root).focus());

		await press('ArrowDown');
		await press('ArrowDown');
		await press('Enter');

		expect(submitted(root)).toEqual([['revenue_account_id', 'acct_9002']]);
	});
});

describe('a select with a note under a form layer watching the document', () => {
	it('hands the form layer the named element, already holding the choice', async () => {
		// conform's `useForm` listens for `input` on the document and reads the event's target: a
		// control of its form, by name, whose form data it validates on the spot
		// (`shouldRevalidate: 'onInput'` in packages/app/src/lib/admin/use-admin-form.ts and
		// packages/console-ui/src/lib/use-console-form.ts). so a refused box re-checks on the choice
		// that follows only if the event arrives on the element carrying the name, with the value on
		// it already.
		const read: [string, string | null][] = [];
		const listen = (event: Event) => {
			const target = event.target;
			if (!(target instanceof HTMLSelectElement) || target.form === null) return;
			read.push([target.name, new FormData(target.form).get(target.name) as string | null]);
		};
		document.addEventListener('input', listen);
		try {
			const root = render(Bound, {});
			await choose(root, 'Building appeal');
		} finally {
			document.removeEventListener('input', listen);
		}

		expect(read).toEqual([['revenue_account_id', 'acct_9002']]);
	});
});
