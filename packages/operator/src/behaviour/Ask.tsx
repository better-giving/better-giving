import { type ComponentType, useEffect, useRef, useSyncExternalStore } from 'react';

// a question put to the operator as a value: a handler calls `ask` with a component, the component
// is drawn by `AskHost` at the root, and what it answers is what the call resolves with.
//
// it draws nothing of its own. an asked component renders its card through ./Dialog.tsx's `Modal`,
// and nothing here knows it does — the store holds a component and its props and hands it the one
// way to answer.
//
// **an answer takes the card off the screen in the same commit.** `Modal` has no closing
// presentation and reports no end of one, so there is nothing to keep an answered entry mounted
// for; the entry leaves the store as the promise settles, and `Modal`'s own cleanup puts focus back
// on the control that raised the question.

/** what an asked component receives on top of its own props. */
export interface AskProps<T = void> {
	/** settles the awaited promise and takes the card down. called with no value it answers `undefined` — the dismissed case. */
	resolve: (value?: T) => void;
}

export interface AskOpts {
	/**
	 * one slot. asking again on the same key settles the pending ask with `undefined` and swaps this
	 * one into the same mounted entry, so a card whose component is the same stays up and only its
	 * props change — one card, not a close and a reopen.
	 */
	key?: string;
}

/** the call signature `ask` and `useAsk`'s bound form both carry. */
export type AskFn = <T = void, P extends object = Record<string, never>>(
	Component: ComponentType<P & AskProps<T>>,
	props?: P,
	opts?: AskOpts
) => Promise<T | undefined>;

type Entry = {
	readonly id: number;
	readonly key: string | undefined;
	// heterogeneous by construction; each entry's props were checked at the `ask` call that made it
	// biome-ignore lint/suspicious/noExplicitAny: the store erases P, see above
	readonly Component: ComponentType<any>;
	readonly props: Record<string, unknown>;
	readonly settle: (value: unknown) => void;
};

const EMPTY: readonly Entry[] = [];

let entries: readonly Entry[] = EMPTY;
let nextId = 0;
const listeners = new Set<() => void>();

function commit(next: readonly Entry[]): void {
	entries = next;
	for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
const snapshot = () => entries;
// nothing is asked while markup is rendered without a document — the store is written by handlers
const serverSnapshot = () => EMPTY;

/**
 * mount a component and await what it answers, from anywhere — a handler, an effect, a promise
 * chain. requires `<AskHost />` in the tree.
 *
 * a question raised from a component that can unmount belongs on {@link useAsk} instead: this one
 * outlives its caller, and a card over a page that no longer knows about it is what that buys.
 *
 * @example
 * const email = await ask<string>(ContactPrompt, { seed });
 * if (email === undefined) return; // dismissed
 */
export const ask: AskFn = (Component, props, opts) => start(Component, props, opts)[0];

/**
 * the whole of `ask`, plus the handle `useAsk` cancels on unmount. cancelling settles with
 * `undefined` — the answer a dismissal gives, so a caller handling "dismissed" needs no second
 * branch.
 */
function start<T, P extends object>(
	Component: ComponentType<P & AskProps<T>>,
	props?: P,
	opts?: AskOpts
): [Promise<T | undefined>, () => void] {
	// module state on a server render is shared between renders and no host draws there
	if (typeof document === 'undefined') return [Promise.resolve(undefined), () => {}];

	let cancel = () => {};
	const promise = new Promise<T | undefined>((res) => {
		const held = opts?.key === undefined ? undefined : entries.find((e) => e.key === opts.key);
		const id = held?.id ?? nextId++;

		let done = false;
		const settle = (value: unknown) => {
			if (done) return;
			done = true;
			res(value as T | undefined);
		};

		cancel = () => {
			if (done) return;
			settle(undefined);
			// only while this ask still owns the slot: a keyed replacement inherited the id, and
			// dropping it would take down the question now on screen
			if (entries.find((e) => e.id === id)?.settle === settle) {
				commit(entries.filter((e) => e.id !== id));
			}
		};

		const entry: Entry = {
			id,
			key: opts?.key,
			Component,
			props: (props ?? {}) as Record<string, unknown>,
			settle
		};
		commit(held ? entries.map((e) => (e === held ? entry : e)) : [...entries, entry]);

		// the superseded question kept no entry of its own, so nothing will ever answer it
		held?.settle(undefined);

		// a host above the caller subscribes after the caller's own mount effect, so an ask raised on
		// mount finds no listener yet. one task is that subscription's to land in.
		if (listeners.size === 0) {
			setTimeout(() => {
				if (done || listeners.size > 0) return;
				console.error("ask(): no <AskHost /> is mounted, so this question can't be shown");
				cancel();
			});
		}
	});
	return [promise, cancel];
}

/**
 * `ask` bound to the caller's lifetime: a component that goes away takes its open questions, and
 * the continuation waiting on each, with it — each answers `undefined`.
 *
 * the host is at the root, so without this a question survives its caller and a card can stand
 * over a page with no code left to act on the answer.
 */
export function useAsk(): AskFn {
	const pending = useRef<Set<() => void>>(null);
	pending.current ??= new Set();

	useEffect(() => {
		const open = pending.current;
		return () => {
			if (open === null) return;
			for (const cancel of open) cancel();
			open.clear();
		};
	}, []);

	// one identity for the life of the component, so an effect can depend on it.
	const bound = useRef<AskFn>(null);
	bound.current ??= (Component, props, opts) => {
		const [promise, cancel] = start(Component, props, opts);
		const open = pending.current;
		open?.add(cancel);
		return promise.finally(() => open?.delete(cancel));
	};
	return bound.current;
}

/**
 * test-only: settles and drops every pending ask. the store is module state and outlives a mounted
 * tree, so a case that asks without answering would leak its card into the next.
 */
export function resetAsks(): void {
	const was = entries;
	commit(EMPTY);
	for (const entry of was) entry.settle(undefined);
}

/** where `ask` mounts. draws nothing until something is asked, so it belongs once, at the root. */
export function AskHost() {
	const list = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
	return (
		<>
			{list.map((entry) => (
				<AskEntry key={entry.id} entry={entry} />
			))}
		</>
	);
}

function AskEntry({ entry }: { entry: Entry }) {
	return (
		<entry.Component
			{...entry.props}
			resolve={(value?: unknown) => {
				entry.settle(value);
				// a stale answer from a card a keyed replacement has already swapped is not this slot's
				if (entries.find((e) => e.id === entry.id) === entry) {
					commit(entries.filter((e) => e.id !== entry.id));
				}
			}}
		/>
	);
}
