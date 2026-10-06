import type { OrgProfileField } from '@better-giving/operator/console/org';
import { einEdit, type HeldBoxes } from './ein-lookup';
import { IDENTITY_BOXES, orgRequired } from './org-fields';
import type { IdentityField } from './org-form';

// what the Organisation fold's boxes hold as they stand, and how a found value is put into one —
// for ./org-fold.tsx's IRS lookup, which fills boxes the operator may have typed in since it asked —
// and how an EIN is spelled as it is typed, in the fold's EIN box and in the finder's
// (./org-finder.tsx).
//
// **a box is an input or a textarea**, and the mission is the second: a fill that read inputs alone
// would take a typed mission for an empty box and write over it, and would never reach an empty one.
//
// **a value put into a box is made to say it changed.** a value written to an element fires no
// event, and both layers that read the form count the events its boxes fire — conform's, and the
// one that arms the button — so a box filled silently would hold an organisation under a button
// nothing could press.

type Box = HTMLInputElement | HTMLTextAreaElement;

const isBox = (element: Element | RadioNodeList | null | undefined): element is Box =>
	element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;

/** the boxes named, as they stand; one the form does not hold reads as empty. */
export const heldBoxes = (
	elements: HTMLFormControlsCollection | undefined,
	fields: readonly string[]
): HeldBoxes =>
	Object.fromEntries(
		fields.map((field) => {
			const element = elements?.namedItem(field);
			return [field, isBox(element) ? element.value : ''];
		})
	);

/** boxes given values, each made to say so; answers how many took one. */
export function putBoxes(
	elements: HTMLFormControlsCollection | undefined,
	boxes: Partial<Record<IdentityField, string>>
): number {
	let took = 0;
	for (const [field, value] of Object.entries(boxes)) {
		const element = elements?.namedItem(field);
		if (!isBox(element)) continue;
		element.value = value;
		element.dispatchEvent(new Event('input', { bubbles: true }));
		took += 1;
	}
	return took;
}

/**
 * the first box the operator still owes as the boxes stand: a required one, empty, in the order the
 * fold draws them, or `null` where every required box holds something. the EIN box is first on the
 * screen and second in that list, which reads the same wherever a number has just been put in it.
 */
export const firstNeeded = (
	held: Readonly<Partial<Record<string, string>>>
): OrgProfileField | null =>
	IDENTITY_BOXES.find((field) => orgRequired(field) && (held[field] ?? '') === '') ?? null;

/**
 * an EIN being typed, spelled in its box as it is typed (`einEdit` in ./ein-lookup.ts), with the
 * caret left where the operator was typing rather than at the end. answers what the box now holds.
 */
export function spellEin(element: Box, typing: Event): string {
	const typed = element.value;
	const kind = typing instanceof InputEvent ? typing.inputType : '';
	const edit = einEdit(
		typed,
		element.selectionStart ?? typed.length,
		kind === 'deleteContentForward'
			? 'forward'
			: kind === 'deleteContentBackward'
				? 'backward'
				: null
	);
	if (edit.shown !== typed) {
		element.value = edit.shown;
		element.setSelectionRange(edit.caret, edit.caret);
	}
	return edit.shown;
}
