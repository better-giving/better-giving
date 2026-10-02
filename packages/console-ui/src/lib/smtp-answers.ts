import { useState } from 'react';
import type { TestSend, VarsWritten } from '../api/types';
import type { GroupReport } from './secret-group-form';

// a page's answers, one kept per kind of press, which is what ../routes/_sections.smtp.tsx hands
// ./smtp-fold.tsx and ../routes/_sections.password.tsx hands ./password-fold.tsx.
//
// **the router keeps one answer for the whole page and the fold has blocks that answer apart.**
// `actionData` is the latest submission's alone, and a second press stays pressable over a
// credentials press and the reading after it (the mail page's test send: `ownPress` in
// ./smtp-fold-state.ts; the password page's freeing press). read straight off `actionData`, an
// answer landing there takes the credentials' answer with it: a refusal's sentences vanish over
// boxes still holding what was refused, and a landed write stops reading as landed before its
// reading lands, so the Saved tick never draws and Save stays armed.
//
// so each kind is kept until a newer answer of that same kind replaces it. the kinds are the keys
// of the page's empty record (`NO_ANSWERS` for the mail page): an answer carrying none of them
// replaces nothing. what a kept answer means once its reading lands is still the fold's to read
// (`useReseeded` in ./reseed.ts): nothing here lets one go early or holds one late.

/** one answer off a page's `clientAction`, which carries exactly one of `A`'s kinds, or none. */
export type AnswerTo<A> =
	| { [K in keyof A]: { readonly [P in K]: NonNullable<A[P]> } }[keyof A]
	| { readonly unknown: true };

/** what the mail fold is handed: each block's last answer, or `null` where that block has made none. */
export type MailAnswers = {
	readonly secrets: GroupReport | null;
	readonly test: TestSend | null;
	readonly freed: VarsWritten | null;
};

export const NO_ANSWERS: MailAnswers = { secrets: null, test: null, freed: null };

/**
 * what is kept once `answer` lands: its own kind replaced, every other kept as it was.
 *
 * `undefined` replaces nothing — it is what the router hands once a later navigation drops the
 * answer, and that answer is still the last one its block made.
 */
export function keepAnswers<A extends object>(kept: A, answer: AnswerTo<A> | undefined): A {
	if (answer === undefined) return kept;
	for (const kind of Object.keys(kept)) {
		if (kind in answer) return { ...kept, [kind]: (answer as Record<string, unknown>)[kind] };
	}
	return kept;
}

/**
 * {@link keepAnswers} over every answer this page has been handed while mounted, starting from
 * `none` — the page's kinds, each holding `null`.
 *
 * folded during render rather than in an effect, so the render an answer arrives in is the one
 * that draws it — the seam moves focus on that render (./use-console-form.ts). keyed on the
 * answer's identity: every submission's answer is a new object, a revalidation hands the same one
 * back.
 */
export function useKeptAnswers<A extends object>(none: A, answer: AnswerTo<A> | undefined): A {
	const [held, setHeld] = useState(() => ({ seen: answer, kept: keepAnswers(none, answer) }));
	if (held.seen === answer) return held.kept;
	const next = { seen: answer, kept: keepAnswers(held.kept, answer) };
	setHeld(next);
	return next.kept;
}
