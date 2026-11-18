import type { SaveState } from '@better-giving/operator/save-state.react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { useSettingsSave } from './settings-card';

// the step from a group's save state to the four settings-layout-css draws, and the one rule that
// step adds: the registry holds Saved for two seconds, under the four the shared state keeps a
// confirmation for (packages/operator/src/save-state.ts).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	vi.useRealTimers();
});

const PRISTINE: SaveState = { pending: false, done: false, disabled: true };
const DIRTY: SaveState = { pending: false, done: false, disabled: false };
const SAVING: SaveState = { pending: true, done: false, disabled: true };
const SAVED: SaveState = { pending: false, done: true, disabled: true };

function Probe({ save }: { save: SaveState }) {
	return <output>{useSettingsSave(save)}</output>;
}

function drawn(save: SaveState) {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(<Probe save={save} />));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return {
		says: () => root.textContent,
		next: (next: SaveState) => act(() => mounted.render(<Probe save={next} />))
	};
}

describe('what a settings save row draws', () => {
	it.each([
		{ save: PRISTINE, state: 'pristine' },
		{ save: DIRTY, state: 'dirty' },
		{ save: SAVING, state: 'saving' },
		{ save: SAVED, state: 'saved' }
	])('draws $state for that group', ({ save, state }) => {
		expect(drawn(save).says()).toBe(state);
	});

	it('holds Saved for two seconds, then goes back to pristine', () => {
		vi.useFakeTimers();
		const row = drawn(SAVING);
		row.next(SAVED);

		act(() => vi.advanceTimersByTime(1999));
		expect(row.says()).toBe('saved');
		act(() => vi.advanceTimersByTime(1));
		expect(row.says()).toBe('pristine');
	});

	it('draws a second save’s Saved after the first has gone', () => {
		vi.useFakeTimers();
		const row = drawn(SAVED);
		act(() => vi.advanceTimersByTime(2000));
		row.next(SAVING);
		row.next(SAVED);

		expect(row.says()).toBe('saved');
	});
});
