import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';

/*
 * the four states SaveButton takes, and the two words each one may be re-spelled with.
 *
 * the button is packages/operator/src/components/controls/Button.jsx's primary rank. three of the
 * four close the press with `aria-disabled` — a save in flight takes no second press, a button
 * reporting one stands over a group with nothing left in it to save, and `disabled` is that same
 * group before any press. a press in flight is the registry's `aria-busy` look, the disabled fill
 * with the resting label still in it; done and disabled are the closed press
 * `.adm-btn[aria-disabled='true']` draws in packages/operator/src/styles/adm.css, done with the tick
 * and its own words in place of the label.
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
		</>
	);
}
