import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { type CardQuestion, QuestionCard, type QuestionCardProps } from './question-card';

// what the question card sends for what was picked and typed: one choice, several, Other with its
// words and without them, words prefilled and cleared, an amount read into minor units or refused at
// its box, a date; a tiers question's rows, seeded, added, dropped, refused at the box that is
// wrong and sent as amounts and words; the tick that marks a question taking several answers; the
// skip press; the presses held while answers are on their way; a refusal of the answers said at
// the card; the starter note; and the presses' words for each round.

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

const TIERS: CardQuestion = {
	id: 'tiers',
	kind: 'tiers',
	prompt: 'What does each amount do?',
	rows: [
		{ amount: 2500, text: 'Feeds a family for a week' },
		{ amount: 10_000 },
		{ amount: 150_000 }
	],
	placeholders: ['Feeds a family for a day', 'Stocks a pantry shelf', 'Keeps the kitchen open']
};

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

/** a tiers row's box, by the name a reader hears it by. */
function named(host: HTMLElement, name: string): HTMLInputElement {
	const found = host.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
	if (found === null) throw new Error(`no box named ${name}`);
	return found;
}

/** each tiers row's amount box, in order. */
function tierAmounts(host: HTMLElement): HTMLInputElement[] {
	return [...host.querySelectorAll<HTMLInputElement>('input[aria-label$=" amount"]')];
}

/** what a box's `aria-describedby` names, read off the elements it names. */
function said(box: HTMLElement): string {
	return (box.getAttribute('aria-describedby') ?? '')
		.split(' ')
		.map((id) => document.getElementById(id)?.textContent)
		.join(' ');
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

	it('draws a tick in every chip of a question taking several answers, and none in one taking one', () => {
		const { host } = mount(props());
		const ticks = (legend: string) =>
			[...host.querySelectorAll('fieldset')]
				.find((one) => one.querySelector('legend')?.textContent === legend)
				?.querySelectorAll('.adm-choicechip__tick').length;

		expect(ticks('Which ways to give should stand out?')).toBe(4);
		expect(ticks('Who do your gifts mostly help?')).toBe(0);
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

	it('groups an amount’s thousands as it is typed, and sends the minor units typed', async () => {
		const onSubmit = vi.fn();
		const { host } = mount(props({ onSubmit }));
		const gift = box(host, 'A typical gift');
		type(gift, '100000');
		expect(gift.value).toBe('100,000');

		await press(button(host, 'Draft my page'));

		expect(onSubmit.mock.calls[0]?.[0]).toContainEqual({ id: 'gift', value: 10_000_000 });
	});

	it('starts an amount box on its prefill and shows its example, both grouped, and sends the prefill', async () => {
		const onSubmit = vi.fn();
		const { host } = mount(
			props({
				questions: [
					{
						id: 'goal',
						kind: 'amount',
						prompt: 'Your goal',
						prefill: 2_500_000,
						placeholder: 1_000_000
					}
				],
				onSubmit
			})
		);
		const goal = box(host, 'Your goal');

		expect(goal.value).toBe('25,000');
		expect(goal.placeholder).toBe('10,000');

		await press(button(host, 'Draft my page'));
		expect(onSubmit).toHaveBeenCalledWith([{ id: 'goal', value: 2_500_000 }]);
	});

	it('takes a press anywhere on an amount box’s drawn frame, named by its question alone', () => {
		const { host } = mount(props());
		const gift = box(host, 'A typical gift');
		const frame = gift.closest('.adm-affixed');

		expect(frame?.tagName).toBe('LABEL');
		expect(frame?.querySelector('.adm-affixed__unit')?.textContent).toBe('$');
		expect(document.getElementById(gift.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
			'A typical gift'
		);
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

	it('draws a tiers question’s rows with their amounts grouped, their words and their examples', () => {
		const { host } = mount(props({ questions: [TIERS] }));

		expect(host.querySelector('legend')?.textContent).toBe('What does each amount do?');
		expect(tierAmounts(host).map((box) => box.value)).toEqual(['25', '100', '1,500']);
		const words = [1, 2, 3].map((at) => named(host, `What tier ${at} does`));
		expect(words.map((box) => box.value)).toEqual(['Feeds a family for a week', '', '']);
		expect(words.map((box) => box.placeholder)).toEqual([
			'Feeds a family for a day',
			'Stocks a pantry shelf',
			'Keeps the kitchen open'
		]);
	});

	it('adds tier rows up to six, the caret in each new amount, and holds Add there', async () => {
		const { host } = mount(props({ questions: [TIERS] }));
		const add = button(host, 'Add another');

		await press(add);
		expect(document.activeElement).toBe(named(host, 'Tier 4 amount'));
		await press(add);
		await press(add);
		expect(tierAmounts(host)).toHaveLength(6);
		expect(add.getAttribute('aria-disabled')).toBe('true');

		await press(add);
		expect(tierAmounts(host)).toHaveLength(6);
		expect(document.activeElement).toBe(add);
	});

	it('drops tier rows down to one, which carries no Remove', async () => {
		const { host } = mount(props({ questions: [TIERS] }));
		const removes = () =>
			[...host.querySelectorAll('button')].flatMap((one) => one.getAttribute('aria-label') ?? []);
		expect(removes()).toEqual(['Remove tier 1', 'Remove tier 2', 'Remove tier 3']);

		await press(host.querySelector<HTMLElement>('[aria-label="Remove tier 1"]') as HTMLElement);
		expect(tierAmounts(host).map((box) => box.value)).toEqual(['100', '1,500']);
		expect(document.activeElement).toBe(named(host, 'Tier 1 amount'));
		await press(host.querySelector<HTMLElement>('[aria-label="Remove tier 2"]') as HTMLElement);

		expect(tierAmounts(host).map((box) => box.value)).toEqual(['100']);
		expect(removes()).toEqual([]);
	});

	it('refuses a tier with an amount and no words at its words, and sends nothing until they clear', async () => {
		const onSubmit = vi.fn();
		const { host } = mount(props({ questions: [TIERS], onSubmit }));

		await press(button(host, 'Draft my page'));

		expect(onSubmit).not.toHaveBeenCalled();
		const second = named(host, 'What tier 2 does');
		expect(second.getAttribute('aria-invalid')).toBe('true');
		expect(said(second)).toBe('required');
		expect(document.activeElement).toBe(second);
		expect(named(host, 'What tier 1 does').hasAttribute('aria-invalid')).toBe(false);
		expect(named(host, 'Tier 2 amount').hasAttribute('aria-invalid')).toBe(false);

		type(second, 'Stocks a pantry shelf');
		expect(second.hasAttribute('aria-invalid')).toBe(false);
	});

	it('refuses words with no amount at the amount', async () => {
		const onSubmit = vi.fn();
		const { host } = mount(props({ questions: [TIERS], onSubmit }));
		type(named(host, 'What tier 2 does'), 'Stocks a pantry shelf');
		type(named(host, 'What tier 3 does'), 'Keeps the kitchen open');
		type(named(host, 'Tier 3 amount'), '');

		await press(button(host, 'Draft my page'));

		const amount = named(host, 'Tier 3 amount');
		expect(onSubmit).not.toHaveBeenCalled();
		expect(said(amount)).toBe('$ required');
		expect(document.activeElement).toBe(amount);
	});

	it('refuses an amount a tier above already holds at the second', async () => {
		const onSubmit = vi.fn();
		const { host } = mount(props({ questions: [TIERS], onSubmit }));
		type(named(host, 'What tier 2 does'), 'Stocks a pantry shelf');
		type(named(host, 'What tier 3 does'), 'Keeps the kitchen open');
		type(named(host, 'Tier 3 amount'), '25');

		await press(button(host, 'Draft my page'));

		const third = named(host, 'Tier 3 amount');
		expect(onSubmit).not.toHaveBeenCalled();
		expect(said(third)).toBe('$ different from tier 1');
		expect(named(host, 'Tier 1 amount').hasAttribute('aria-invalid')).toBe(false);
		expect(document.activeElement).toBe(third);

		type(third, '250');
		expect(third.hasAttribute('aria-invalid')).toBe(false);
	});

	it('sends the filled tiers as minor units and words, in order, an empty row left out', async () => {
		const onSubmit = vi.fn();
		const { host } = mount(props({ questions: [TIERS], onSubmit }));
		type(named(host, 'What tier 2 does'), ' Stocks a pantry shelf ');
		type(named(host, 'What tier 3 does'), 'Keeps the kitchen open');
		await press(button(host, 'Add another'));

		await press(button(host, 'Draft my page'));

		expect(onSubmit).toHaveBeenCalledWith([
			{
				id: 'tiers',
				value: [
					{ amount: 2500, text: 'Feeds a family for a week' },
					{ amount: 10_000, text: 'Stocks a pantry shelf' },
					{ amount: 150_000, text: 'Keeps the kitchen open' }
				]
			}
		]);
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

	it('says why its answers were refused under its presses, in a region there before it speaks', async () => {
		const onSubmit = vi.fn();
		const { host, redraw } = mount(props({ onSubmit }));
		const region = host.querySelector('.adm-questions__refusal');
		expect(region?.getAttribute('role')).toBe('status');
		expect(region?.textContent).toBe('');
		const send = button(host, 'Draft my page');
		expect(send.hasAttribute('aria-describedby')).toBe(false);

		await press(chip(host, 'Who do your gifts mostly help?', 'Children'));
		type(box(host, 'A typical gift'), '50');
		await press(send);
		redraw(props({ onSubmit, busy: true }));
		redraw(
			props({
				onSubmit,
				busy: false,
				refusal: 'No model answered. Set `AI` and run `pnpm run login`.'
			})
		);

		expect(host.querySelector('.adm-questions__refusal')).toBe(region);
		expect(region?.textContent).toBe('No model answered. Set AI and run pnpm run login.');
		expect([...(region?.querySelectorAll('code') ?? [])].map((code) => code.textContent)).toEqual([
			'AI',
			'pnpm run login'
		]);
		expect(send.getAttribute('aria-describedby')).toBe(region?.id);
		expect(document.activeElement).toBe(send);
		expect(chip(host, 'Who do your gifts mostly help?', 'Children').checked).toBe(true);
		expect(box(host, 'A typical gift').value).toBe('50');
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
