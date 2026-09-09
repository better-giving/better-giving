import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';

/*
 * the four states SaveButton takes, and the two words each one may be re-spelled with.
 *
 * three of the four set the button's own `disabled` attribute — a save in flight takes no second
 * press, a button reporting one stands over a group with nothing left in it to save, and `disabled`
 * is that same group before any press — so all three reach `.adm-btn--primary:disabled` in
 * packages/operator/src/styles/adm.css. only `disabled` is left there: `.adm-save.is-pending` and
 * `.adm-save.is-done` tie it on specificity and stand later, so each keeps a ground of its own and
 * the three read apart. neither restates the border, which stays the closed rung's — the done
 * tone's own line is too near the page to hold the button's boundary at the moment it reports
 * success. `idle` writes no name at all — resting is what the primary button already is.
 *
 * a press in flight has no words of its own: the resting label stays where it is and the three
 * dots of `.adm-btn__dots` stand over it, so the specimen beside `idle` is the same size as it.
 *
 * the ring on a button still reporting a save is a pair of states and not one, and the pin is the
 * only way to it: the confirmation closes the press, so no keyboard lands on this specimen. it is
 * drawn because `.adm-save.is-done:focus-visible` is in the sheet, pinned the way every other state
 * on this page is (`.is-focus` in packages/operator/src/styles/base.css).
 */
export default function ControlsSaveButtonPreview() {
	return (
		<>
			<SaveButton state="idle" />
			<SaveButton state="pending" />
			<SaveButton state="done" />
			<SaveButton state="disabled" />
			<SaveButton state="idle" label="Save receipt settings" doneLabel="Receipt settings saved" />
			<SaveButton
				state="pending"
				label="Save receipt settings"
				doneLabel="Receipt settings saved"
			/>
			<SaveButton state="done" label="Save receipt settings" doneLabel="Receipt settings saved" />
			<SaveButton state="done" className="is-focus" />
		</>
	);
}
