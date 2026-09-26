import type { Tone } from '@better-giving/operator/components/closed-sets';
import type { DonationStatus } from '$lib/donations/statuses';
import type { FormStatus } from '$lib/forms/statuses';
import type { ProgramStatus } from '$lib/programs/statuses';
import type { RecurringPlanStatus } from '$lib/recurring/statuses';

// which tone the status pill takes, one map per lifecycle union the dashboard renders.
//
// the ladder is the one `packages/operator/src/styles/tokens.css` declares at `three registers of
// status`: settled or running is `done`, waiting on somebody is `attention`, failed or refused is
// `blocker`, ended is `note`. a word that is not a record's own lifecycle status — a consent
// reading, a count, `Repeating`, `Invited` — takes no tone at all and stays hueless.
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

// `cancelled` is the operator's own deliberate end and `lapsed` is the rail giving up on a card
// that kept failing. they read alike down a list and are not the same fact, which is the whole of
// why they are toned apart.
export const RECURRING_STATUS_TONES: Record<RecurringPlanStatus, Tone> = {
	active: 'done',
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
export const DONATION_STATUS_TONES: Record<DonationStatus, Tone> = {
	pending: 'attention',
	completed: 'done',
	failed: 'blocker',
	cancelled: 'note',
	refunded: 'note',
	disputed: 'attention',
	partially_refunded: 'note'
};
