import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { type CardQuestion, QuestionCard, type QuestionCardProps } from './question-card';

// what the question card sends for what was picked and typed: one choice, several, Other with its
// words and without them, words prefilled and cleared, an amount read into minor units or refused at
// its box, a date; the skip press; the presses held while answers are on their way; the starter
// note; and the presses' words for each round.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const QUESTIONS: CardQuestion[] = [
	{
		id: 'mission',
		kind: 'text',
		prompt: 'Your mission, in a sentence',
		prefill: 'No family in Riverside goes hungry'
	},
	{
		id: 'who',
		kind: 'choice',
		prompt: 'Who do your gifts mostly help?',
		options: ['Local families', 'Children', 'Animals']
	},
	{
		id: 'ways',
		kind: 'choices',
		prompt: 'Which ways to give should stand out?',
		hint: 'Pick any.',
		options: ['One-time', 'Monthly', 'In someone’s honour']
	},
	{ id: 'gift', kind: 'amount', prompt: 'A typical gift' },
	{ id: 'ends', kind: 'date', prompt: 'When does it end?' }
];

function props(over: Partial<QuestionCardProps> = {}): QuestionCardProps {
	return { questions: QUESTIONS, round: 'opening', onSubmit: () => {}, busy: false, ...over };
}

/**
 * `appendChild` rather than `append`: see ./ai-panel.dom.spec.tsx's `mount`.
 */
function mount(first: QuestionCardProps) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => root.render(<QuestionCard {...first} />));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return {
		host,
		redraw: (next: QuestionCardProps) => act(() => root.render(<QuestionCard {...next} />))
	};
}

function button(host: HTMLElement, words: string): HTMLButtonElement {
	const found = [...host.querySelectorAll('button')].find((b) => b.textContent === words);
	if (found === undefined) throw new Error(`no ${words} press`);
	return found;
}

function chip(host: HTMLElement, legend: string, words: string): HTMLInputElement {
	const group = [...host.querySelectorAll('fieldset')].find(
		(one) => one.querySelector('legend')?.textContent === legend
	);
	const input = [...(group?.querySelectorAll('label') ?? [])]
		.find((one) => one.textContent === words)
		?.querySelector('input');
	if (!input) throw new Error(`no ${words} under ${legend}`);
	return input;
}

/** the box a label names. */
function box(host: HTMLElement, label: string): HTMLInputElement {
	const named = [...host.querySelectorAll('label')].find((one) => one.textContent === label);
	const found = host.querySelector<HTMLInputElement>(`#${CSS.escape(named?.htmlFor ?? '')}`);
	if (found === null) throw new Error(`no box labelled ${label}`);
	return found;
}

function otherBox(host: HTMLElement, legend: string): HTMLInputElement {
	const group = [...host.querySelectorAll('fieldset')].find(
		(one) => one.querySelector('legend')?.textContent === legend
	);
	const found = group?.querySelector<HTMLInputElement>('input[type="text"]');
	if (!found) throw new Error(`no Other box under ${legend}`);
	return found;
}

/** types into a box the way a keyboard does: the value changes and the element says so. */
function type(input: HTMLInputElement, words: string) {
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
	act(() => {
		setter?.call(input, words);
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

async function press(target: HTMLElement) {
	await act(async () => {
		target.focus();
		target.click();
	});
}

describe('the question card', () => {
	it('sends the prefilled words, and nothing for a question left alone', async () => {
		const onSubmit = vi.fn();
		const { host } = mount(props({ onSubmit }));

		await press(button(host, 'Draft my page'));

		expect(onSubmit).toHaveBeenCalledWith([
			{ id: 'mission', value: 'No family in Riverside goes hungry' }
		]);
	});

	it('sends no words for prefilled words cleared', async () => {
		const onSubmit = vi.fn();
		const { host } = mount(props({ onSubmit }));
		type(box(host, 'Your mission, in a sentence'), '  ');

		await press(button(host, 'Draft my page'));

		expect(onSubmit).toHaveBeenCalledWith([]);
	});

	it('sends the choice picked and every choice ticked, in the questions’ order', async () => {
		const onSubmit = vi.fn();
		const { host } = mount(props({ onSubmit }));
		await press(chip(host, 'Who do your gifts mostly help?', 'Children'));
		await press(chip(host, 'Which ways to give should stand out?', 'Monthly'));
		await press(chip(host, 'Which ways to give should stand out?', 'In someone’s honour'));

		await press(button(host, 'Draft my page'));

		expect(onSubmit).toHaveBeenCalledWith([
			{ id: 'mission', value: 'No family in Riverside goes hungry' },
			{ id: 'who', value: 'Children' },
			{ id: 'ways', value: ['Monthly', 'In someone’s honour'] }
		]);
	});

	it('sends Other’s words as the answer, beside the choices ticked with it', async () => {
		const onSubmit = vi.fn();
		const { host } = mount(props({ onSubmit }));
		await press(chip(host, 'Who do your gifts mostly help?', 'Other'));
		type(otherBox(host, 'Who do your gifts mostly help?'), ' Veterans ');
		await press(chip(host, 'Which ways to give should stand out?', 'Monthly'));
		await press(chip(host, 'Which ways to give should stand out?', 'Other'));
		type(otherBox(host, 'Which ways to give should stand out?'), 'Gift aid');

		await press(button(host, 'Draft my page'));

		expect(onSubmit.mock.calls[0]?.[0]).toEqual([
			{ id: 'mission', value: 'No family in Riverside goes hungry' },
			{ id: 'who', value: 'Veterans' },
			{ id: 'ways', value: ['Monthly', 'Gift aid'] }
		]);
	});

	it('sends nothing for Other taken with no words', async () => {
		const onSubmit = vi.fn();
		const { host } = mount(props({ onSubmit }));
		await press(chip(host, 'Who do your gifts mostly help?', 'Other'));
		await press(chip(host, 'Which ways to give should stand out?', 'Other'));

		await press(button(host, 'Draft my page'));

		expect(onSubmit.mock.calls[0]?.[0]).toEqual([
			{ id: 'mission', value: 'No family in Riverside goes hungry' }
		]);
	});

	it('sends an amount in minor units, the $ taken as the box’s own', async () => {
		const onSubmit = vi.fn();
		const { host } = mount(props({ onSubmit }));
		type(box(host, 'A typical gift'), '$50');

		await press(button(host, 'Draft my page'));

		expect(onSubmit.mock.calls[0]?.[0]).toContainEqual({ id: 'gift', value: 5000 });
	});

	it('refuses an amount it cannot read under its box, puts the caret there and sends nothing', async () => {
		const onSubmit = vi.fn();
		const { host } = mount(props({ onSubmit }));
		const gift = box(host, 'A typical gift');
		type(gift, '$abc');

		await press(button(host, 'Draft my page'));

		expect(onSubmit).not.toHaveBeenCalled();
		expect(gift.getAttribute('aria-invalid')).toBe('true');
		expect(document.activeElement).toBe(gift);
		const said = (gift.getAttribute('aria-describedby') ?? '')
			.split(' ')
			.map((id) => document.getElementById(id)?.textContent)
			.join(' ');
		expect(said).toContain('must be an amount');

		type(gift, '50');
		expect(gift.hasAttribute('aria-invalid')).toBe(false);
	});

	it('sends a date as the platform’s YYYY-MM-DD', async () => {
		const onSubmit = vi.fn();
		const { host } = mount(props({ onSubmit }));
		const ends = box(host, 'When does it end?');
		expect(ends.type).toBe('date');
		type(ends, '2026-12-31');

		await press(button(host, 'Draft my page'));

		expect(onSubmit.mock.calls[0]?.[0]).toContainEqual({ id: 'ends', value: '2026-12-31' });
	});

	it('sends no answers at all from the skip press', async () => {
		const onSubmit = vi.fn();
		const { host } = mount(props({ onSubmit }));
		await press(chip(host, 'Who do your gifts mostly help?', 'Children'));

		await press(button(host, 'Skip, draft anyway'));

		expect(onSubmit).toHaveBeenCalledWith([]);
	});

	it('holds both presses while the answers are on their way, the focus where it was', async () => {
		const onSubmit = vi.fn();
		const { host, redraw } = mount(props({ onSubmit }));
		const send = button(host, 'Draft my page');
		await press(send);
		redraw(props({ onSubmit, busy: true }));

		expect(document.activeElement).toBe(send);
		expect(send.getAttribute('aria-disabled')).toBe('true');
		expect(send.getAttribute('aria-busy')).toBe('true');
		expect(button(host, 'Skip, draft anyway').getAttribute('aria-disabled')).toBe('true');

		await press(send);
		await press(button(host, 'Skip, draft anyway'));
		expect(onSubmit).toHaveBeenCalledOnce();
		expect(box(host, 'Your mission, in a sentence').value).toBe(
			'No family in Riverside goes hungry'
		);
	});

	it('says the AI is not answering only on a card of the usual questions', () => {
		const note = 'The AI isn’t answering right now, so here are the usual questions.';
		expect(mount(props()).host.textContent).not.toContain(note);
		expect(mount(props({ starter: true })).host.textContent).toContain(note);
	});

	it('words its presses for the round', () => {
		const presses = (host: HTMLElement) =>
			[...host.querySelectorAll('button')].map((b) => b.textContent);

		expect(presses(mount(props({ round: 'opening' })).host)).toEqual([
			'Draft my page',
			'Skip, draft anyway'
		]);
		expect(presses(mount(props({ round: 'follow-up' })).host)).toEqual([
			'Update the page',
			'Just do your best'
		]);
	});
});
