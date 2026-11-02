import type { Tone } from '@better-giving/operator/components/closed-sets';
import type { DonationStatus } from '$lib/donations/statuses';
import { FORM_STATUS_LABELS, type FormStatus } from '$lib/forms/statuses';
import type { ProgramStatus } from '$lib/programs/statuses';
import type { RecurringPlanStatus } from '$lib/recurring/statuses';

// which tone the status pill takes, one map per lifecycle union the dashboard renders.
//
// the ladder, whose colours `packages/operator/src/styles/tokens.css` declares at `three registers
// of status`:
//   - `done` is a record the operator put live and that is live, a form taking gifts or a program
//     open. being live is the state the operator set it to reach, and the accent says it got there.
//   - no tone is a record at rest that asks nothing of the operator: a gift that settled and a
//     repeating gift still collecting. a list of money is mostly those rows, and a tone on them
//     would put the accent on every row an operator is not looking for. it draws the hueless pill,
//     slate 3 under slate 11, in a table cell as everywhere else.
//   - `attention` is waiting on somebody.
//   - `blocker` is failed or refused.
//   - `note` is ended: retired, stopped, cancelled or refunded. it keeps the hueless pill's
//     slate 11 ink and draws no ground, so an ended record is told from one at rest by the ground
//     and not by one ink step. `packages/operator/src/styles/state-in-a-cell.spec.ts` holds that
//     split.
//
// a word that is not a record's own lifecycle status — a consent reading, a count, `Repeating`,
// `Invited` — takes no tone at all and stays the hueless pill.
//
// here and not beside the labels in `$lib/{programs,forms,recurring,donations}/statuses.ts`, for
// the reason `./forms/readiness.tsx`'s `TONES` is where it is: those four modules are also the
// source of a check constraint or of a read-time projection and state that they import nothing,
// and a tone is a fact about a screen rather than about the column.
//
// every map is keyed by its union rather than by `string`, so a status added to one of them is a
// type error here rather than a word that arrives untoned and reads as a value nobody classified.

export const PROGRAM_STATUS_TONES: Record<ProgramStatus, Tone> = {
	active: 'done',
	archived: 'note'
};

// `draft` is `attention` and not a quieter tone: a draft shows nothing on a site with its snippet
// already on it, so it is a form waiting on the operator rather than a form at rest —
// `FORM_STATUS_NOTES` in `$lib/forms/statuses.ts` is the same fact in a sentence.
export const FORM_STATUS_TONES: Record<FormStatus, Tone> = {
	draft: 'attention',
	live: 'done',
	archived: 'note'
};

// the word and tone a form's status pill takes.
//
// a form stored `live` while `giftsBlocked` is true is not taking gifts: `anyBlocker` in
// `$lib/forms/readiness.ts` is that boolean, and `publishedConfig` in
// `$lib/server/forms/published-config.ts` serves nothing while it holds. Live would say the form
// is taking gifts. draft and archived keep their own words. the forms list's sample card is not a
// stored form and does not call this.
export function formStatusWord(
	status: FormStatus,
	giftsBlocked: boolean
): { readonly word: string; readonly tone: Tone } {
	if (status === 'live' && giftsBlocked) return { word: 'Not taking gifts', tone: 'attention' };
	return { word: FORM_STATUS_LABELS[status], tone: FORM_STATUS_TONES[status] };
}

// `cancelled` is the operator's own deliberate end and `lapsed` is the rail giving up on a card
// that kept failing. they read alike down a list and are not the same fact, which is the whole of
// why they are toned apart.
export const RECURRING_STATUS_TONES: Record<RecurringPlanStatus, Tone | undefined> = {
	active: undefined,
	cancelled: 'note',
	lapsed: 'blocker'
};

// `failed` is the only one on the refused rung — the attempt the rail turned down, and the row a
// staff member scans a gift list to find. `cancelled` is an attempt somebody abandoned, which is
// an end rather than a refusal.
//
// both refund states are `note` and neither is `done`. a refund is a gift that ended, and the
// accent on `Refunded` would say the one thing an operator must not read off a colour here: that
// the money is in.
//
// `disputed` is `attention`: the gift waits on the organisation's evidence before the processor's
// deadline, then on the processor's ruling. not `blocker`, since nothing has been refused yet — a
// loss reads as a refund does, on the refund states' rung, and a win reads as the gift did before.
// never `done`, since the processor has already taken the money back out. ./status-tones.spec.ts
// holds the last.
export const DONATION_STATUS_TONES: Record<DonationStatus, Tone | undefined> = {
	pending: 'attention',
	completed: undefined,
	failed: 'blocker',
	cancelled: 'note',
	refunded: 'note',
	disputed: 'attention',
	partially_refunded: 'note'
};
