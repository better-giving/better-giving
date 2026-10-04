import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { ruleOf, sheet } from '../../styles/sheet-rule.testing';
import { render } from '../render.testing';
import { ChoiceChips, type ChoiceChipsProps } from './ChoiceChips.jsx';

// what a question drawn as chips is besides its look: native radios or checkboxes in one named
// group, so the platform's own keys walk it and a form submits it; the hint each control is
// described by; the tick that tells a question taking several answers from one taking one; the
// cards a choice with a line under it is drawn as; the group's refusal; and the Other chip, whose
// box opens with it, closes with it, and submits under a name of its own.
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

/** the text of every element an `aria-describedby` names, in order. */
function describedBy(input: Element): string[] {
	return (input.getAttribute('aria-describedby') ?? '')
		.split(' ')
		.filter(Boolean)
		.map((id) => document.getElementById(id)?.textContent ?? `(nothing answers ${id})`);
}

const KINDS = [
	{ value: 'year_end', label: 'Year-end appeal', description: 'The giving-season ask' },
	{ value: 'emergency', label: 'Emergency response', description: 'A crisis, right now' }
];

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

	describe('the tick a question taking several answers draws', () => {
		const ticks = (root: HTMLElement) =>
			[...root.querySelectorAll('label.adm-choicechip')].map(
				(label) => label.querySelector('svg.adm-choicechip__tick') !== null
			);

		it('stands in every checkbox chip, Other among them, out of the tree', () => {
			const root = render(Bound, { type: 'checkbox' });

			expect(ticks(root)).toEqual([true, true, true, true]);
			for (const tick of root.querySelectorAll('.adm-choicechip__tick')) {
				expect(tick.getAttribute('aria-hidden')).toBe('true');
			}
		});

		it('stands in no radio chip', () => {
			const root = render(Bound, {});

			expect(ticks(root)).toEqual([false, false, false, false]);
		});

		it('fills with the primary pair when its chip is taken, and is an empty box until then', () => {
			const css = sheet('adm.css');
			const rest = ruleOf(css, '.adm-choicechip__tick');
			const taken = ruleOf(css, '.adm-choicechip:has(input:checked) > .adm-choicechip__tick');

			expect(rest.get('color')).toBe('transparent');
			expect(taken.get('background')).toBe('var(--admin-primary-bg)');
			expect(taken.get('color')).toBe('var(--admin-primary-ink)');
		});
	});

	describe('as cards', () => {
		it('draws each choice as its label over its line, named by the label and described by the line', () => {
			const root = render(Bound, { options: KINDS, other: undefined, cards: true });
			const radios = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')];

			expect(root.querySelector('.adm-choicechips--cards')).not.toBeNull();
			expect(
				radios
					.map((radio) => document.getElementById(radio.getAttribute('aria-labelledby') ?? ''))
					.map((label) => label?.textContent)
			).toEqual(['Year-end appeal', 'Emergency response']);
			expect(radios.map(describedBy)).toEqual([['The giving-season ask'], ['A crisis, right now']]);
			expect(
				[...root.querySelectorAll('.adm-choicechip__desc')].map((line) => line.textContent)
			).toEqual(['The giving-season ask', 'A crisis, right now']);
		});

		it('submit the value of the one taken', async () => {
			const root = render(Bound, { options: KINDS, other: undefined, cards: true });
			const emergency = root.querySelector<HTMLInputElement>('input[value="emergency"]');
			if (emergency === null) throw new Error('no emergency card');
			await take(emergency);

			expect(submitted(root)).toEqual(['who=emergency']);
		});
	});

	describe('refused', () => {
		it('says why once under the group, and marks and describes every control by it', () => {
			const root = render(Bound, { hint: 'Pick the closest.', error: 'required' });
			const said = root.querySelectorAll('.adm-field__error');

			expect(said).toHaveLength(1);
			expect(said[0]?.textContent).toBe('required');
			expect(said[0]?.closest('fieldset')).toBe(root.querySelector('fieldset'));
			for (const input of root.querySelectorAll('input')) {
				expect(input.getAttribute('aria-invalid')).toBe('true');
				expect(describedBy(input)).toEqual(['Pick the closest.', 'required']);
			}
		});

		it('marks nothing while there is no refusal', () => {
			const root = render(Bound, {});

			expect(root.querySelector('.adm-field__error')).toBeNull();
			expect(root.querySelector('[aria-invalid]')).toBeNull();
		});
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
