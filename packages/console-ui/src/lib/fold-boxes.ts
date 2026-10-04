import type { HeldBoxes } from './ein-lookup';
import type { IdentityField } from './org-form';

// what the Organisation fold's boxes hold as they stand, and how a found value is put into one —
// for ./org-fold.tsx's IRS lookup, which fills boxes the operator may have typed in since it asked.
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
