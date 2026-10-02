import { useState } from 'react';
import type { TestSend, VarsWritten } from '../api/types';
import type { GroupReport } from './secret-group-form';

// the mail page's answers, one kept per block, which is what ../routes/_sections.smtp.tsx hands
// ./smtp-fold.tsx.
//
// **the router keeps one answer for the whole page and the fold has blocks that answer apart.**
// `actionData` is the latest submission's alone, and the test send stays pressable over a
// credentials press and the reading after it (`ownPress` in ./smtp-fold-state.ts). read straight
// off `actionData`, a send landing there takes the credentials' answer with it: a refusal's
// sentences vanish over boxes still holding what was refused, and a landed write stops reading as
// landed before its reading lands, so the Saved tick never draws and Save stays armed.
//
// so each kind is kept until a newer answer of that same kind replaces it. what a kept answer means
// once its reading lands is still the fold's to read (`useReseeded` in ./reseed.ts): nothing here
// lets one go early or holds one late.

/** what the fold is handed: each block's last answer, or `null` where that block has made none. */
export type MailAnswers = {
	readonly secrets: GroupReport | null;
	readonly test: TestSend | null;
	readonly freed: VarsWritten | null;
};

/** one answer off the page's `clientAction`, which carries exactly one kind. */
export type MailAnswer =
	| { readonly secrets: GroupReport }
	| { readonly test: TestSend }
	| { readonly freed: VarsWritten }
	| { readonly unknown: true };

export const NO_ANSWERS: MailAnswers = { secrets: null, test: null, freed: null };

/**
 * what is kept once `answer` lands: its own kind replaced, every other kept as it was.
 *
 * `undefined` replaces nothing — it is what the router hands once a later navigation drops the
 * answer, and that answer is still the last one its block made.
 */
export function keepAnswers(kept: MailAnswers, answer: MailAnswer | undefined): MailAnswers {
	if (answer === undefined) return kept;
	if ('secrets' in answer) return { ...kept, secrets: answer.secrets };
	if ('test' in answer) return { ...kept, test: answer.test };
	if ('freed' in answer) return { ...kept, freed: answer.freed };
	return kept;
}

/**
 * {@link keepAnswers} over every answer this page has been handed while mounted.
 *
 * folded during render rather than in an effect, so the render an answer arrives in is the one
 * that draws it — the seam moves focus on that render (./use-console-form.ts). keyed on the
 * answer's identity: every submission's answer is a new object, a revalidation hands the same one
 * back.
 */
export function useKeptAnswers(answer: MailAnswer | undefined): MailAnswers {
	const [held, setHeld] = useState(() => ({ seen: answer, kept: keepAnswers(NO_ANSWERS, answer) }));
	if (held.seen === answer) return held.kept;
	const next = { seen: answer, kept: keepAnswers(held.kept, answer) };
	setHeld(next);
	return next.kept;
}
