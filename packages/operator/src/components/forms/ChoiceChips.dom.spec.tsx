import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { ChoiceChips, type ChoiceChipsProps } from './ChoiceChips.jsx';

// what a question drawn as chips is besides its look: native radios or checkboxes in one named
// group, so the platform's own keys walk it and a form submits it; the hint each control is
// described by; and the Other chip, whose box opens with it, closes with it, and submits under a
// name of its own.
//
// the arrow keys inside a radio group and Space on a checkbox are the platform's, which happy-dom
// does not walk; what is asserted is the markup that hands them to the platform.

const WHO = [
	{ value: 'Local families', label: 'Local families' },
	{ value: 'Children', label: 'Children' },
	{ value: 'Animals', label: 'Animals' }
];

function Bound(props: Partial<ChoiceChipsProps>) {
	return (
		<form>
			<ChoiceChips
				id="who"
				name="who"
				legend="Who do your gifts mostly help?"
				options={WHO}
				other={{ name: 'who:other', placeholder: 'In your words' }}
				{...props}
			/>
		</form>
	);
}

function submitted(root: HTMLElement): string[] {
	const form = root.querySelector('form');
	if (form === null) throw new Error('the case drew no form to read');
	return [...new FormData(form)].map(([name, value]) => `${name}=${String(value)}`);
}

function chip(root: HTMLElement, words: string): HTMLInputElement {
	const label = [...root.querySelectorAll('label')].find((one) => one.textContent === words);
	const input = label?.querySelector('input');
	if (!input) throw new Error(`no chip reading ${words}`);
	return input;
}

const otherBox = (root: HTMLElement) => root.querySelector<HTMLInputElement>('input[type="text"]');

async function take(input: HTMLInputElement) {
	await act(async () => {
		input.focus();
		input.click();
	});
}

describe('choice chips mounted into a document', () => {
	it('are native radios in one fieldset named by the question, each named by its own words', () => {
		const root = render(Bound, {});
		const group = root.querySelector('fieldset');

		expect(group?.querySelector('legend')?.textContent).toBe('Who do your gifts mostly help?');
		const radios = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
		expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual([
			'Local families',
			'Children',
			'Animals',
			'Other'
		]);
		expect(new Set(radios.map((radio) => radio.name))).toEqual(new Set(['who']));
		expect(radios.every((radio) => radio.closest('fieldset') === group)).toBe(true);
	});

	it('are checkboxes when several may be taken, and submit each one taken', async () => {
		const root = render(Bound, { type: 'checkbox', other: undefined });
		await take(chip(root, 'Children'));
		await take(chip(root, 'Animals'));

		expect(root.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
		expect(submitted(root)).toEqual(['who=Children', 'who=Animals']);
	});

	it('take one at a time as radios', async () => {
		const root = render(Bound, {});
		await take(chip(root, 'Children'));
		await take(chip(root, 'Animals'));

		expect(submitted(root)).toEqual(['who=Animals']);
	});

	it('describe every control by the hint', () => {
		const root = render(Bound, { hint: 'Pick the closest.' });
		const hint = root.querySelector('.adm-hint');

		expect(hint?.textContent).toBe('Pick the closest.');
		for (const input of root.querySelectorAll('input')) {
			expect(input.getAttribute('aria-describedby')).toBe(hint?.id);
		}
	});

	describe('the Other chip', () => {
		it('opens its box when taken, named Other, and leaves the focus on the chip', async () => {
			const root = render(Bound, {});
			expect(otherBox(root)).toBeNull();

			const other = chip(root, 'Other');
			await take(other);

			const box = otherBox(root);
			expect(box).not.toBeNull();
			expect(document.getElementById(box?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
				'Other'
			);
			expect(box?.placeholder).toBe('In your words');
			expect(document.activeElement).toBe(other);
		});

		it('submits empty under the group, and its words under a name of their own', async () => {
			const root = render(Bound, {});
			await take(chip(root, 'Other'));
			const box = otherBox(root);
			if (box === null) throw new Error('no Other box');
			act(() => {
				box.value = 'Veterans';
			});

			expect(submitted(root)).toEqual(['who=', 'who:other=Veterans']);
		});

		it('closes its box, words and all, when another radio is taken', async () => {
			const root = render(Bound, {});
			await take(chip(root, 'Other'));
			await take(chip(root, 'Children'));

			expect(otherBox(root)).toBeNull();
			expect(submitted(root)).toEqual(['who=Children']);
		});

		it('closes its box when unticked among checkboxes', async () => {
			const root = render(Bound, { type: 'checkbox' });
			const other = chip(root, 'Other');
			await take(other);
			expect(otherBox(root)).not.toBeNull();

			await take(other);
			expect(otherBox(root)).toBeNull();
		});
	});
});
