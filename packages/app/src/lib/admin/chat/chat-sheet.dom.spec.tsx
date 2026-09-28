import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { type ChatMessage, ChatSheet, type ChatSheetProps } from './chat-sheet';

// what the chat sheet does rather than how it looks: which region speaks a reply, what a new
// campaign's sheet opens on, where the focus is after a press, and what a press sends. the look is
// the design's and is read on a screen, not here.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HISTORY: ChatMessage[] = [
	{ id: 't1', role: 'operator', text: 'Make it warmer' },
	{ id: 't2', role: 'assistant', text: 'I moved the page to the warm shade.' }
];

const SUGGESTIONS = ['Tell donors what each amount buys', 'Add a FAQ', 'Shorten the story'];

function props(over: Partial<ChatSheetProps> = {}): ChatSheetProps {
	return {
		messages: HISTORY,
		isRunning: false,
		onSend: () => {},
		onDismiss: () => {},
		suggestions: SUGGESTIONS,
		imageSrc: (id) => `/images/${id}`,
		...over
	};
}

/**
 * mounts the sheet into a document that lives as long as the case, and hands back a way to draw it
 * again with other props, as the route does when its fetcher moves.
 *
 * `appendChild` rather than `append`: worker-configuration.d.ts declares HTMLRewriter's `Element`,
 * which merges into the DOM's and brings an `append(content, options)` that wins here.
 */
function mount(first: ChatSheetProps) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => root.render(<ChatSheet {...first} />));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return {
		host,
		redraw: (next: ChatSheetProps) => act(() => root.render(<ChatSheet {...next} />))
	};
}

function one<T extends Element>(host: HTMLElement, selector: string): T {
	const found = host.querySelector<T>(selector);
	if (found === null) throw new Error(`nothing on the page matches ${selector}`);
	return found;
}

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

describe('the chat sheet', () => {
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
		expect(log.textContent).toContain('the free model wrote this reply');
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
});
