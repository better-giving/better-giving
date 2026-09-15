import { act, useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '../components/render.testing';
import { AskHost, type AskProps, ask, resetAsks, useAsk } from './Ask';

// what ./Ask.tsx writes: an answer reaching the caller, a dismissal answering `undefined`, a keyed
// ask taking over the slot on screen, and a question never outliving whatever can no longer hear
// its answer. the cards are plain markup — the store knows nothing of ./Dialog.tsx, so nothing
// here needs one.

/** an asked component at its smallest: a label, and the two ways to answer. */
function Question({ label, resolve }: { label: string } & AskProps<string>) {
	return (
		<div data-question={label}>
			<p>{label}</p>
			<button type="button" data-answer onClick={() => resolve(`answered ${label}`)}>
				answer
			</button>
			<button type="button" data-dismiss onClick={() => resolve()}>
				dismiss
			</button>
		</div>
	);
}

/** the one question card on the page, or `null`. */
const card = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-question]');

const press = (root: HTMLElement, what: 'answer' | 'dismiss') =>
	act(() => root.querySelector<HTMLButtonElement>(`[data-${what}]`)?.click());

/** a task, which is what the missing-host check waits for. */
const aTask = () => new Promise((done) => setTimeout(done));

afterEach(() => {
	resetAsks();
});

describe('ask', () => {
	it('resolves with what the card answered, and takes the card down', async () => {
		const root = render(AskHost, {});
		let answer!: Promise<string | undefined>;
		act(() => {
			answer = ask<string, { label: string }>(Question, { label: 'first' });
		});
		expect(card(root)?.dataset.question).toBe('first');

		press(root, 'answer');
		expect(await answer).toBe('answered first');
		expect(card(root)).toBeNull();
	});

	it('answers undefined for a dismissal', async () => {
		const root = render(AskHost, {});
		let answer!: Promise<string | undefined>;
		act(() => {
			answer = ask<string, { label: string }>(Question, { label: 'left' });
		});

		press(root, 'dismiss');
		expect(await answer).toBeUndefined();
		expect(card(root)).toBeNull();
	});

	it('swaps a keyed re-ask into the card already on screen', async () => {
		const root = render(AskHost, {});
		let first!: Promise<string | undefined>;
		act(() => {
			first = ask<string, { label: string }>(Question, { label: 'first' }, { key: 'slot' });
		});
		const drawn = card(root);

		let second!: Promise<string | undefined>;
		act(() => {
			second = ask<string, { label: string }>(Question, { label: 'second' }, { key: 'slot' });
		});

		// the superseded question answers rather than hanging, and the element is the same one
		expect(await first).toBeUndefined();
		expect(root.querySelectorAll('[data-question]')).toHaveLength(1);
		expect(card(root)).toBe(drawn);
		expect(card(root)?.dataset.question).toBe('second');

		press(root, 'answer');
		expect(await second).toBe('answered second');
	});

	it('draws unkeyed asks side by side', () => {
		const root = render(AskHost, {});
		act(() => {
			ask<string, { label: string }>(Question, { label: 'one' });
			ask<string, { label: string }>(Question, { label: 'two' });
		});
		expect(root.querySelectorAll('[data-question]')).toHaveLength(2);
	});

	it('tells the caller why and answers undefined where no host is mounted', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const answer = ask<string, { label: string }>(Question, { label: 'unheard' });
		await aTask();

		expect(await answer).toBeUndefined();
		expect(error).toHaveBeenCalledWith(expect.stringContaining('<AskHost />'));
	});

	it('keeps an ask raised on mount, before the host above it subscribes', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		function Asker() {
			useEffect(() => {
				ask<string, { label: string }>(Question, { label: 'on mount' });
			}, []);
			return null;
		}
		const root = render(
			() => (
				<>
					<Asker />
					<AskHost />
				</>
			),
			{}
		);
		await act(aTask);

		expect(card(root)?.dataset.question).toBe('on mount');
		expect(error).not.toHaveBeenCalled();
	});

	it('answers undefined and draws nothing without a document', async () => {
		vi.stubGlobal('document', undefined);
		const answer = ask<string, { label: string }>(Question, { label: 'server' });
		vi.unstubAllGlobals();

		expect(await answer).toBeUndefined();
	});
});

describe('useAsk', () => {
	it('cancels the questions its caller leaves behind', async () => {
		let answer: Promise<string | undefined> | undefined;
		function Owner() {
			const bound = useAsk();
			return (
				<button
					type="button"
					data-raise
					onClick={() => {
						answer = bound<string, { label: string }>(Question, { label: 'owned' });
					}}
				>
					raise
				</button>
			);
		}
		function Page() {
			const [mounted, setMounted] = useState(true);
			return (
				<>
					{mounted ? <Owner /> : null}
					<button type="button" data-unmount onClick={() => setMounted(false)}>
						unmount
					</button>
					<AskHost />
				</>
			);
		}

		const root = render(Page, {});
		act(() => root.querySelector<HTMLButtonElement>('[data-raise]')?.click());
		expect(card(root)?.dataset.question).toBe('owned');

		act(() => root.querySelector<HTMLButtonElement>('[data-unmount]')?.click());
		expect(card(root)).toBeNull();
		expect(await answer).toBeUndefined();
	});
});
