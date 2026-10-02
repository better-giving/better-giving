import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaypalRunRead } from '../api/types';

// the page read again once a run stops, held at the hook itself. ../../vite.config.ts pins one node
// pool and no dom, so the hook is run under a stand-in for the three react hooks it calls: each
// render reads its slots in call order, as react does, and an effect runs after the render whose
// dependencies moved. that is all of react this question needs — whether mounting over a run that
// has already ended reads the page again — and every other decision in the hook is ./run-poll.ts's
// and held at ./run-poll.spec.ts.

const harness = vi.hoisted(() => {
	type Effect = { deps: readonly unknown[] | undefined };
	const slots: unknown[] = [];
	let cursor = 0;
	let queued: Array<() => unknown> = [];
	let moved = false;
	return {
		revalidate: { calls: 0 },
		reset() {
			slots.length = 0;
		},
		useState<T>(initial: T | (() => T)) {
			const at = cursor++;
			if (!(at in slots))
				slots[at] = typeof initial === 'function' ? (initial as () => T)() : initial;
			const set = (next: T | ((was: T) => T)) => {
				const value = typeof next === 'function' ? (next as (was: T) => T)(slots[at] as T) : next;
				if (Object.is(value, slots[at])) return;
				slots[at] = value;
				moved = true;
			};
			return [slots[at] as T, set] as const;
		},
		useRef<T>(initial: T) {
			const at = cursor++;
			if (!(at in slots)) slots[at] = { current: initial };
			return slots[at] as { current: T };
		},
		useEffect(effect: () => unknown, deps?: readonly unknown[]) {
			const at = cursor++;
			const was = slots[at] as Effect | undefined;
			const stale =
				was === undefined ||
				deps === undefined ||
				deps.some((dep, index) => !Object.is(dep, was.deps?.[index]));
			if (!stale) return;
			slots[at] = { deps } satisfies Effect;
			queued.push(effect);
		},
		/** one commit: render, run what moved, and render again for as long as an effect set state. */
		render<R>(hook: () => R): R {
			let drawn: R;
			do {
				cursor = 0;
				moved = false;
				queued = [];
				drawn = hook();
				for (const effect of queued) effect();
			} while (moved);
			return drawn;
		}
	};
});

vi.mock('react', async (original) => ({
	...(await original<typeof import('react')>()),
	useState: harness.useState,
	useRef: harness.useRef,
	useEffect: harness.useEffect
}));

vi.mock('react-router', () => {
	const revalidate = async () => {
		harness.revalidate.calls += 1;
	};
	return { useRevalidator: () => ({ revalidate }) };
});

// the poll's ask never answers here: what is held is the read after a stop, not the poll.
vi.mock('./processor-cache', () => ({
	pollRun: () => new Promise(() => {}),
	runDrawn: () => {}
}));

const { useRunPoll } = await import('./use-run-poll');

const facts = { registration: null, elsewhere: [] };
const running: PaypalRunRead = { kind: 'running', stage: 'authorizing', facts, outcome: null };
const ended: PaypalRunRead = {
	kind: 'ended',
	stage: 'storing',
	facts,
	outcome: { kind: 'done' }
};

beforeEach(() => {
	vi.useFakeTimers();
	harness.reset();
	harness.revalidate.calls = 0;
});

afterEach(() => {
	vi.useRealTimers();
});

describe('the page read again once a run stops', () => {
	it('is not asked for by mounting over a run that had already ended', () => {
		// the page load that drew it is the reading taken after the stop, so there is nothing to put
		// back and a second read only risks one taken across a different run.
		harness.render(() => useRunPoll('paypal', ended, false));
		harness.render(() => useRunPoll('paypal', ended, false));
		expect(harness.revalidate.calls).toBe(0);
	});

	it('is asked for once when a run drawn going stops', () => {
		harness.render(() => useRunPoll('paypal', running, false));
		expect(harness.revalidate.calls).toBe(0);
		harness.render(() => useRunPoll('paypal', ended, false));
		harness.render(() => useRunPoll('paypal', ended, false));
		expect(harness.revalidate.calls).toBe(1);
	});

	it('is asked for again by the next run to stop, after mounting over an ended one', () => {
		harness.render(() => useRunPoll('paypal', ended, false));
		harness.render(() => useRunPoll('paypal', running, false));
		harness.render(() => useRunPoll('paypal', ended, false));
		expect(harness.revalidate.calls).toBe(1);
	});
});
