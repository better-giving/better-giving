import { useEffect, useRef } from 'react';

/**
 * one post per press. `sending` (./use-posting.ts) arrives a render late — the router draws its
 * navigation state in a transition — so a second submit in the same tick still reads it false and
 * posts again; the claim is remembered here instead. it is let go when the post's answer lands:
 * `sending` dropping back, or a new `answer` drawn while nothing is out. a submit the form itself
 * refuses before posting hands its claim back with `release`.
 */
export function usePressOnce(sending: boolean, answer: unknown) {
	const out = useRef(false);
	useEffect(() => {
		if (!sending) out.current = false;
	}, [sending, answer]);
	return {
		/** true for the press that may post; every later one until the answer lands gets false. */
		claim(): boolean {
			if (sending || out.current) return false;
			out.current = true;
			return true;
		},
		release(): void {
			out.current = false;
		}
	};
}
