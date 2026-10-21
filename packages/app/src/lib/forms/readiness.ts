// what stands between a donation form and a donor and how bad it is, in the one place both the
// judgement and the component may import from.
//
// not under `$lib/server/**`, for the reason `./offered-rails.ts` beside it is not: the union is
// what `$lib/server/forms/readiness.ts` assigns and what the block on the donation-form screens
// renders, and a component cannot import from `$lib/server/**` at all — so keeping it there would
// mean the words being re-declared in a component with nothing tying the two lists together.
//
// the dependency runs server -> shared and never back: the judgement imports this, this imports
// nothing but the status union beside it.

import type { FormStatus } from './statuses';

/**
 * what one unresolved thing costs on a donation-form screen.
 *
 * this screen's own word and never a status read off somewhere else. a saved organisation row with
 * a blank EIN is a row somebody filled in, and any surface reporting on the row itself would say
 * so; `publishedConfig` in `$lib/server/forms/published-config.ts` refuses to serve *any* form
 * without one. on a donation-form screen that is not something to look into at leisure, it is the
 * reason nothing appears on the org's own website — so what a screen renders is decided here,
 * against what a donor would see.
 */
export const FORM_READINESS_SEVERITIES = ['blocker', 'warning', 'resolved'] as const;
export type FormReadinessSeverity = (typeof FORM_READINESS_SEVERITIES)[number];

/**
 * what a line is about: the three things that stand between a donation form and a donor.
 *
 *   organisation — the registered name and the EIN a form states while asking.
 *   processor    — the keys of at least one payment processor, without which no gift is charged.
 *   notices      — the value a processor's payment notices are verified with, for each processor
 *                  whose keys are set. without it a gift is charged and never heard to settle, so
 *                  it warns and never blocks.
 *
 * a closed list, because the screens word each line by its job and by who is reading — the
 * person who deployed the site can fix all three, and a member can only ask them — so the server
 * sends no sentence for any of them.
 */
export const FORM_READINESS_JOBS = ['organisation', 'processor', 'notices'] as const;
export type FormReadinessJob = (typeof FORM_READINESS_JOBS)[number];

/**
 * one thing a donation form needs, and where this deployment stands on it.
 *
 * a job and a severity, and no member saying where to go about it or what it costs: both are the
 * screen's to word, from the job (`FORM_READINESS_JOBS`).
 */
export interface FormReadinessLine {
	readonly job: FormReadinessJob;
	/**
	 * a resolved line keeps its place in the list while a sibling is unresolved, so a list an
	 * operator is working through does not renumber itself as they fix things.
	 */
	readonly severity: FormReadinessSeverity;
}

/**
 * whether any line in the block is a blocker, which is the one thing about it a control depends
 * on rather than only reports.
 *
 * a blocker means `publishedConfig` in `$lib/server/forms/published-config.ts` serves nothing, so
 * the status box on the screens that write a form does not offer a draft Live while one stands and
 * the action behind it refuses one anyway (`liveOffered`). a warning never stops a write — that is
 * the whole difference between the two words.
 *
 * `null` is the resolved deployment: `formsReadiness` answers `null` once every line is done, so
 * the absence of a block is the absence of a blocker.
 *
 * here rather than in either caller because both ends of that rule read it — the `load` that
 * decides what the select renders and the action that re-checks what was posted, since a filtered
 * `<option>` list is not a control.
 */
export function anyBlocker(lines: readonly FormReadinessLine[] | null): boolean {
	return lines?.some((line) => line.severity === 'blocker') ?? false;
}

/**
 * whether a form stored as `stored` may be saved Live against this block: always for a form that
 * is already live, and otherwise only while nothing blocks.
 *
 * a blocker withholds the move to Live and never takes Live away. the status box is seeded with
 * the stored status, and a box seeded `live` with no Live option draws Draft — so withholding the
 * option from a live form makes every save of its group an unpublish that outlasts the blocker.
 *
 * read by the editor's `load` for what the select offers and by its action against the status the
 * submitted version was drawn from.
 */
export function liveOffered(
	stored: FormStatus,
	lines: readonly FormReadinessLine[] | null
): boolean {
	return stored === 'live' || !anyBlocker(lines);
}

/**
 * what to say when Live was posted while a blocker stands, keyed to the status box on both screens
 * that write a form.
 *
 * the select does not offer Live in that state, so reaching this means a stale tab, a hand-built
 * body, or a blocker that arrived between the page being drawn and the save being pressed. a
 * filtered `<option>` list is not a control, and the enum is not enough on its own here: `live` is
 * a member of `EDITABLE_FORM_STATUSES` whatever the deployment is doing.
 *
 * it names the block above rather than a job: the block says which line stands, and a second
 * account of it inside a field message would be one to keep in step.
 */
export const LIVE_WITHHELD =
	'This form cannot be set live while a blocker above stands: nothing would be served to a ' +
	'donor. Clear it and choose Live again.';
