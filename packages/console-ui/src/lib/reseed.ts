import { useEffect, useRef } from 'react';

// when a form seeded from the deployment's own reading puts its boxes back to what is stored.
//
// **the answer, the end of the press and the reading are three different moments here, in that
// order.** react router publishes a press's answer as the re-read it sets off begins
// (`handleLoaders` in the installed `react-router`); the navigation ends when `clientLoader`
// returns; and the deployment's own reading is a promise that loader hands back unresolved, so it
// lands after both (../routes/_index.tsx). neither of the first two says the seeds on the screen
// are the ones the write left behind — only a reading that was not there when the press went does.
//
// **what putting them back any earlier costs is a stored value nobody can see.** the boxes are
// uncontrolled and are put back by `form.reset()`
// (`@better-giving/operator/saved-form-state.react`), which restores what each box was last
// rendered with, and conform's metadata is rebuilt from the same seeds in the same moment
// (`createFormMeta` in @conform-to/dom). neither is rebuilt again by a reading that lands later:
// react writes a changed `defaultValue` to the attribute alone, and conform rebuilds its metadata
// on a reset and on nothing else. so a form put back on its answer is put back to the reading its
// press was made against, and every reading after it reaches neither the box nor the metadata
// behind it — an empty box over a value the deployment is holding, with reloading the page the only
// way out of it.
//
// a fold seeded from the press's own answer states nothing here and is right not to: its seeds are
// on the screen in the same render the answer is (`storedOrg` in ./org-form.ts). the payments fold
// is in both camps — its answer carries the pair it stored and seeds the two key boxes from it, and
// what this is left holding there is every other way a press of it lands (`keysStanding` in
// ./stripe-press.ts).

/**
 * whether a landed write puts the boxes back yet.
 *
 * the readings are compared by identity and never by what they hold: a write that stores a value
 * the deployment cannot report back leaves every seed on the form exactly as it was — the mark over
 * a credential is the same mark — and a comparison of seeds would read that as a re-read that never
 * came, leaving the boxes holding a credential under a button drawing `Saved`.
 */
export const reseeded = (press: {
	/** whether this form's last answer says the write landed. */
	readonly landed: boolean;
	/** the reading its boxes are drawn from now. */
	readonly reading: unknown;
	/** the reading they were drawn from when its press went. */
	readonly pressedWith: unknown;
}): boolean => press.landed && press.reading !== press.pressedWith;

/**
 * the same reading taken over a form's own press, as the flag `useConsoleForm` takes.
 *
 * what a press was made against is read while it is in flight rather than at the submit: a reading
 * cannot be asked for while this form's own request is open — the loader that asks for one runs
 * after it — so whatever is on the screen for the length of the press is what the press was made
 * against. taking it at the submit instead would mean a second press over the same form comparing
 * against the first one's reading, which is a box put back a phase too early all over again.
 */
export function useReseeded(press: {
	readonly landed: boolean;
	/** this form's own press in flight, both phases of it. */
	readonly pending: boolean;
	readonly reading: unknown;
}): boolean {
	const pressedWith = useRef(press.reading);
	useEffect(() => {
		if (!press.pending) return;
		pressedWith.current = press.reading;
	}, [press.pending, press.reading]);

	return reseeded({
		landed: press.landed,
		reading: press.reading,
		pressedWith: pressedWith.current
	});
}
