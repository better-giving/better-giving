// how bad a thing is for a donation form, in the one place both the judgement and the component
// may import from.
//
// not under `$lib/server/**`, for the reason `./offered-rails.ts` beside it is not: the union is
// what `$lib/server/forms/readiness.ts` assigns and what the block on the donation-form screens
// renders, and a component cannot import from `$lib/server/**` at all — so keeping it there would
// mean the words being re-declared in a component with nothing tying the two lists together.
//
// the dependency runs server -> shared and never back: the judgement imports this, this imports
// nothing.

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
 * what a severity is called on screen.
 *
 * words, never a colour or an icon standing in for them: an operator who learns to read the colour
 * stops reading the sentence beside it. keyed by the union, so a fourth severity is a type error
 * here rather than a blank word.
 */
export const FORM_READINESS_LABELS: Record<FormReadinessSeverity, string> = {
	blocker: 'Blocker',
	warning: 'Warning',
	resolved: 'Done'
};

/**
 * one thing a donation form needs, and where this deployment stands on it.
 *
 * a name, a severity and what it costs — and no member saying where to go about it. every line is a
 * fact about a row this deployment holds, and the screen that writes that row is the one already
 * under the block, so a pointer would be a link from a screen to itself. what this deployment's own
 * capabilities are doing is not reported here at all: they are set and said back on the console
 * (`packages/console-ui/src/lib/stripe-section.tsx`).
 */
export interface FormReadinessLine {
	/** what the line is about, in the words the screen that writes the row calls it. */
	readonly label: string;
	readonly severity: FormReadinessSeverity;
	/**
	 * what it costs on this screen, or `null` once there is nothing to say.
	 *
	 * a resolved line keeps its place in the list and loses its sentence: it is there so that a
	 * list an operator is working through does not renumber itself as they fix things, and quiet
	 * so that the ones still asking for something are the only ones carrying any weight.
	 */
	readonly detail: string | null;
}

/**
 * whether any line in the block is a blocker, which is the one thing about it a control depends
 * on rather than only reports.
 *
 * a blocker means `publishedConfig` in `$lib/server/forms/published-config.ts` serves nothing, so
 * the status box on the screen that edits a form does not offer Live while one stands and the
 * action behind it refuses one anyway. a warning never stops a write — that is the whole
 * difference between the two words.
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
