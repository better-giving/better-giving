import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { AiPanel, type AiPanelProps, type ChatMessage } from './ai-panel';
import type { CardQuestion } from './question-card';

// what the AI panel does rather than how it looks: which region speaks a reply, which reply
// carries the refused line, what a new campaign's panel opens on and what a later turn says while
// it is written, where the focus is after a press, and what a press sends; an operator turn that
// answered drawn as its answers, the question card under the asked turn that is the chat's last
// and under no earlier one, and the panel docked or a sheet by the width it is at. the look is the
// design's and is read on a screen, not here.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HISTORY: ChatMessage[] = [
	{ id: 't1', role: 'operator', text: 'Make it warmer' },
	{ id: 't2', role: 'assistant', text: 'I moved the page to the warm shade.' }
];

const SUGGESTIONS = ['Tell donors what each amount buys', 'Add a FAQ', 'Shorten the story'];

/** the editor at the wide breakpoint or below it, as ../editor/wide.ts reads it. */
function atWidth(wide: boolean) {
	vi.spyOn(window, 'matchMedia').mockImplementation(
		(media) =>
			({
				matches: wide,
				media,
				addEventListener: () => {},
				removeEventListener: () => {}
			}) as unknown as MediaQueryList
	);
}

beforeEach(() => atWidth(true));

function props(over: Partial<AiPanelProps> = {}): AiPanelProps {
	return {
		messages: HISTORY,
		isRunning: false,
		onSend: () => {},
		onAnswer: () => {},
		open: true,
		onDismiss: () => {},
		suggestions: SUGGESTIONS,
		imageSrc: (id) => `/images/${id}`,
		...over
	};
}

/**
 * mounts the panel into a document that lives as long as the case, and hands back a way to draw it
 * again with other props, as the route does when its fetcher moves.
 *
 * `appendChild` rather than `append`: worker-configuration.d.ts declares HTMLRewriter's `Element`,
 * which merges into the DOM's and brings an `append(content, options)` that wins here.
 */
function mount(first: AiPanelProps) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => root.render(<AiPanel {...first} />));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return {
		host,
		redraw: (next: AiPanelProps) => act(() => root.render(<AiPanel {...next} />))
	};
}

function one<T extends Element>(host: HTMLElement, selector: string): T {
	const found = host.querySelector<T>(selector);
	if (found === null) throw new Error(`nothing on the page matches ${selector}`);
	return found;
}

const refusal = (host: HTMLElement) => one(host, '.adm-chat__refusal');
const box = (host: HTMLElement) => one<HTMLTextAreaElement>(host, 'textarea');
const send = (host: HTMLElement) => one<HTMLButtonElement>(host, 'button[aria-label="Send"]');

/** types into the box the way a keyboard does: the value changes and the element says so. */
function type(host: HTMLElement, words: string) {
	const textarea = box(host);
	const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
	act(() => {
		setter?.call(textarea, words);
		textarea.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

async function press(button: HTMLElement) {
	await act(async () => {
		button.focus();
		button.click();
	});
}

describe('the AI panel', () => {
	it('speaks a reply that arrives through role="log", and not the history it opened on', () => {
		const { host, redraw } = mount(props());
		const log = one(host, '[role="log"]');

		expect(log.getAttribute('aria-live')).toBe('polite');
		expect(log.textContent).toBe('');

		redraw(
			props({
				messages: [
					...HISTORY,
					{ id: 't3', role: 'operator', text: 'Shorten the story' },
					{
						id: 't4',
						role: 'assistant',
						text: 'I cut the story to three sentences.',
						note: 'fell-back'
					}
				]
			})
		);

		expect(log.querySelectorAll('p')).toHaveLength(1);
		expect(log.textContent).toContain('I cut the story to three sentences.');
		expect(log.textContent).toContain('the default model wrote this reply');
		expect(log.textContent).not.toContain('warm shade');
	});

	it('opens a new campaign on its title and "What\'s it for?" line, drafting', () => {
		const { host } = mount(
			props({
				messages: [],
				waiting: { title: 'Winter coat drive', purpose: 'Coats for 300 kids, goal $15k by Dec 31' }
			})
		);
		const first = one(host, '.adm-chat__mine');

		expect(first.querySelector('strong')?.textContent).toBe('Winter coat drive');
		expect(first.textContent).toContain('Coats for 300 kids, goal $15k by Dec 31');
		expect(one(host, '[role="status"]').textContent).toBe('Writing the first draft');
		expect(send(host).getAttribute('aria-disabled')).toBe('true');
		expect(host.querySelector('.adm-chat__suggestions')).toBeNull();
	});

	it("draws a reply's backticked spans as code, and an operator's backticks as typed", () => {
		const fix = 'Run `pnpm run login`, then start it again with `BETTER_GIVING_REMOTE_AI=1`.';
		const { host } = mount(
			props({
				messages: [
					{ id: 't1', role: 'operator', text: 'Why is `AI` missing?' },
					{ id: 't2', role: 'assistant', text: fix }
				]
			})
		);
		const [mine, reply] = [...one(host, '.adm-chat__log').querySelectorAll('.adm-chat__turn')];

		expect([...(reply?.querySelectorAll('code') ?? [])].map((code) => code.textContent)).toEqual([
			'pnpm run login',
			'BETTER_GIVING_REMOTE_AI=1'
		]);
		expect(reply?.textContent).toBe(
			'Run pnpm run login, then start it again with BETTER_GIVING_REMOTE_AI=1.'
		);
		expect(mine?.querySelector('code')).toBeNull();
		expect(mine?.textContent).toBe('Why is `AI` missing?');
	});

	it('draws a line under a reply that did not fit the page, and under no other', () => {
		const { host } = mount(
			props({
				messages: [
					...HISTORY,
					{ id: 't3', role: 'operator', text: 'Put the box first' },
					{ id: 't4', role: 'assistant', text: 'I moved the box to the top.', note: 'refused' }
				]
			})
		);
		const turns = [...one(host, '.adm-chat__log').querySelectorAll('.adm-chat__turn')];
		const turnOf = (words: string) => turns.find((turn) => turn.textContent?.startsWith(words));
		const refused =
			'That reply didn’t fit the page, so nothing changed. Ask again, or say it another way.';

		expect(turnOf('I moved the box to the top.')?.textContent).toContain(refused);
		expect(turnOf('I moved the page to the warm shade.')?.textContent).not.toContain(refused);
	});

	it('says a reply is being written on a turn after the first, and falls silent when it lands', () => {
		const { host, redraw } = mount(props());
		const status = one(host, '[role="status"]');
		expect(status.textContent).toBe('');

		redraw(props({ isRunning: true }));
		expect(status.textContent).toBe('Writing a reply');
		expect(one(host, '.adm-chat__log').textContent).toContain('Writing a reply');

		redraw(props({ isRunning: false }));
		expect(status.textContent).toBe('');
	});

	it('keeps the focus on Send after a press, while the reply is written', async () => {
		const onSend = vi.fn();
		const { host, redraw } = mount(props({ onSend }));

		type(host, 'Make the story shorter');
		await press(send(host));
		expect(onSend).toHaveBeenCalledWith({ text: 'Make the story shorter', imageIds: [] });

		redraw(props({ onSend, isRunning: true }));

		expect(document.activeElement).toBe(send(host));
		expect(send(host).getAttribute('aria-disabled')).toBe('true');
		expect(box(host).disabled).toBe(false);

		type(host, 'And warmer');
		await press(send(host));
		expect(onSend).toHaveBeenCalledTimes(1);
		expect(box(host).value).toBe('And warmer');
	});

	it('sends a suggestion as its own words, leaving the draft and putting the focus in the box', async () => {
		const onSend = vi.fn();
		const { host } = mount(props({ onSend }));
		type(host, '$40 buys one winter coat');

		const suggestion = [...host.querySelectorAll('.adm-chat__suggestions button')].find(
			(b) => b.textContent === 'Tell donors what each amount buys'
		);
		if (!(suggestion instanceof HTMLButtonElement)) throw new Error('no such suggestion');
		await press(suggestion);

		expect(onSend).toHaveBeenCalledWith({
			text: 'Tell donors what each amount buys',
			imageIds: []
		});
		expect(box(host).value).toBe('$40 buys one winter coat');
		expect(document.activeElement).toBe(box(host));
	});

	describe('handed a send back', () => {
		const REFUSED = {
			text: 'Make the story shorter',
			reason: 'The chat did not answer. Send it again.'
		};

		it('puts the words back into an empty box and the focus in it', async () => {
			const onSend = vi.fn();
			const { host, redraw } = mount(props({ onSend }));
			type(host, REFUSED.text);
			await press(send(host));
			expect(box(host).value).toBe('');

			redraw(props({ onSend, unsent: { ...REFUSED } }));
			expect(box(host).value).toBe(REFUSED.text);
			expect(document.activeElement).toBe(box(host));

			// the route builds a fresh object on each draw; the same words and reason are not new.
			type(host, '');
			redraw(props({ onSend, unsent: { ...REFUSED } }));
			expect(box(host).value).toBe('');
		});

		it('keeps what was typed while the send was away', () => {
			const { host, redraw } = mount(props());
			type(host, 'Add a FAQ instead');

			redraw(props({ unsent: REFUSED }));

			expect(box(host).value).toBe('Add a FAQ instead');
			expect(document.activeElement).toBe(box(host));
		});

		it('says why at the box, in a region there from the start, until the next send', async () => {
			const onSend = vi.fn();
			const { host, redraw } = mount(props({ onSend }));
			const region = refusal(host);
			expect(region.getAttribute('role')).toBe('status');
			expect(region.textContent).toBe('');
			expect(box(host).hasAttribute('aria-describedby')).toBe(false);

			redraw(props({ onSend, unsent: REFUSED }));
			expect(refusal(host)).toBe(region);
			expect(region.textContent).toBe(REFUSED.reason);
			expect(box(host).getAttribute('aria-describedby')).toBe(region.id);

			await press(send(host));
			expect(onSend).toHaveBeenCalledWith({ text: REFUSED.text, imageIds: [] });
			expect(region.textContent).toBe('');
			expect(box(host).hasAttribute('aria-describedby')).toBe(false);
		});
	});
});

describe('the AI panel by width', () => {
	it('is a column docked beside the preview from the wide breakpoint, named AI, with no way out', () => {
		const { host } = mount(props({ open: false }));
		const panel = one(host, 'aside');

		expect(document.getElementById(panel.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
			'AI'
		);
		expect(host.querySelector('dialog')).toBeNull();
		expect(panel.querySelector('button[aria-label="Close"]')).toBeNull();
		expect(panel.querySelector('textarea')).not.toBeNull();
	});

	it('is a sheet named AI below it, drawn only while open, and dismissed by its X', () => {
		atWidth(false);
		const onDismiss = vi.fn();
		const { host, redraw } = mount(props({ open: false, onDismiss }));
		expect(host.querySelector('aside')).toBeNull();
		expect(host.querySelector('dialog')).toBeNull();

		redraw(props({ open: true, onDismiss }));
		const sheet = one<HTMLDialogElement>(host, 'dialog');
		expect(sheet.querySelector('h2')?.textContent).toBe('AI');
		act(() => one<HTMLButtonElement>(sheet, 'button[aria-label="Close"]').click());
		expect(onDismiss).toHaveBeenCalledOnce();
	});
});

const ASKED: CardQuestion[] = [
	{ id: 'who', kind: 'choice', prompt: 'Who do your gifts mostly help?', options: ['Children'] }
];

describe('the log', () => {
	const asked = (id: string): ChatMessage => ({
		id,
		role: 'assistant',
		text: 'Before I draft your page, a few quick questions.',
		questions: ASKED
	});
	const cards = (host: HTMLElement) => host.querySelectorAll('.adm-questions');
	const presses = (host: HTMLElement) =>
		[...host.querySelectorAll('.adm-questions button')].map((b) => b.textContent);
	const placeholder = (host: HTMLElement) => box(host).getAttribute('placeholder');

	it('draws an answered turn as its answers, each prompt labelling its words', () => {
		const { host } = mount(
			props({
				messages: [
					asked('a1'),
					{
						id: 'o1',
						role: 'operator',
						text: 'Who do your gifts mostly help? — Children',
						answers: [
							{ id: 'who', prompt: 'Who do your gifts mostly help?', words: 'Children' },
							{ id: 'gift', prompt: 'A typical gift', words: '$50' }
						]
					}
				]
			})
		);
		const summary = one(host, '.adm-answers');

		expect(summary.querySelector('.adm-answers__title')?.textContent).toBe('Your answers');
		expect([...summary.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
			'Who do your gifts mostly help?',
			'A typical gift'
		]);
		expect([...summary.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual([
			'Children',
			'$50'
		]);
		expect(host.textContent).not.toContain('— Children');
	});

	it('draws a turn that answered nothing as its words', () => {
		const { host } = mount(
			props({
				messages: [
					asked('a1'),
					{ id: 'o1', role: 'operator', text: 'Skipped the questions.', answers: [] }
				]
			})
		);

		expect(host.querySelector('.adm-answers')).toBeNull();
		expect(one(host, '.adm-chat__mine').textContent).toBe('Skipped the questions.');
	});

	it('puts the card under the asked turn that is the chat’s last, as the opening round', () => {
		const { host } = mount(props({ messages: [asked('a1')] }));

		expect(cards(host)).toHaveLength(1);
		expect(presses(host)).toEqual(['Draft my page', 'Skip, draft anyway']);
		expect(placeholder(host)).toBe('Or tell me in your own words');
	});

	it('asks a later round as a follow-up', () => {
		const { host } = mount(props({ messages: [...HISTORY, asked('a2')] }));

		expect(presses(host)).toEqual(['Update the page', 'Just do your best']);
	});

	it('draws an asked turn no longer the last as its words alone', () => {
		const { host } = mount(
			props({
				messages: [asked('a1'), { id: 'o1', role: 'operator', text: 'Just make it warm' }]
			})
		);

		expect(cards(host)).toHaveLength(0);
		expect(host.textContent).toContain('Before I draft your page, a few quick questions.');
		expect(placeholder(host)).toBe('Ask for a change');
	});

	it('hands a card’s answers on, and holds the card while they are on their way', async () => {
		const onAnswer = vi.fn();
		const { host, redraw } = mount(props({ messages: [asked('a1')], onAnswer }));
		const skip = [...host.querySelectorAll<HTMLButtonElement>('.adm-questions button')].find(
			(b) => b.textContent === 'Skip, draft anyway'
		);
		if (skip === undefined) throw new Error('no skip press');

		await press(skip);
		expect(onAnswer).toHaveBeenCalledWith([]);

		redraw(props({ messages: [asked('a1')], onAnswer, isRunning: true }));
		expect(skip.getAttribute('aria-disabled')).toBe('true');
		expect(document.activeElement).toBe(skip);
	});

	it('marks the usual questions the AI did not answer for', () => {
		const { host } = mount(props({ messages: [{ ...asked('a1'), note: 'starter' }] }));

		expect(one(host, '.adm-questions').textContent).toContain('The AI isn’t answering right now');
	});

	it('says the opening questions are being read while they are', () => {
		const { host, redraw } = mount(props({ messages: [], opening: true }));
		const status = one(host, '[role="status"]');

		expect(status.textContent).toBe('Reading your page');
		expect(send(host).getAttribute('aria-disabled')).toBe('true');

		redraw(props({ messages: [asked('a1')], opening: false }));
		expect(status.textContent).toBe('');
		expect(one(host, '[role="log"]').textContent).toContain(
			'Before I draft your page, a few quick questions.'
		);
	});
});
