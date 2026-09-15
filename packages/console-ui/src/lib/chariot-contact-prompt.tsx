import type { AskProps } from '@better-giving/operator/behaviour/Ask';
import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Field } from '@better-giving/operator/components/forms/Field';
import type { ReactNode } from 'react';
import { CHARIOT_CONTACT_FORM, CHARIOT_FIELD } from './chariot-setup';
import { useConsoleForm } from './use-console-form';

// the card ./chariot-section.tsx's press asks the contact email in, awaited through
// packages/operator/src/behaviour/Ask.tsx: it answers the typed address, or nothing where the
// operator backed out, and posts nothing itself.
//
// **the form goes around the dialog and the submit is in its actions row**, the arrangement
// packages/operator/src/components/shell/Dialog.jsx states — so Enter in the box is Proceed.

export type ChariotContactPromptProps = {
	/** the last email this page sent, or empty. */
	readonly seed: string;
};

export function ChariotContactPrompt({
	seed,
	resolve
}: ChariotContactPromptProps & AskProps<string>): ReactNode {
	/* the seam's pass and nothing it reports: no press of this card reaches the far end, so there is
	   no answer to stand beside the box and no write to put it back after. */
	const contact = useConsoleForm(CHARIOT_CONTACT_FORM, {
		report: null,
		landed: false,
		spent: false,
		busy: false,
		pending: false,
		defaultValue: { [CHARIOT_FIELD('contactEmail')]: seed }
	});
	const box = contact.box(contact.fields[CHARIOT_FIELD('contactEmail')]);

	return (
		<form
			{...contact.mount}
			onSubmit={(event) => {
				contact.mount.onSubmit(event);
				if (event.defaultPrevented) return;
				event.preventDefault();
				const typed = event.currentTarget.elements.namedItem(box.name);
				// the schema's trim, applied to what goes out
				resolve(typed instanceof HTMLInputElement ? typed.value.trim() : '');
			}}
		>
			<Modal
				title="Where should Chariot reach you?"
				onDismiss={() => resolve()}
				exit="Proceed"
				exitProps={{ type: 'submit' as const }}
				cancel="Cancel"
				cancelProps={{ type: 'button' as const, onClick: () => resolve() }}
			>
				<Field
					id={box.id}
					name={box.name}
					label="Contact email"
					type="email"
					autoComplete="email"
					required
					spellCheck={false}
					// the card leaves the screen at Proceed, so no write is ever in flight behind this box
					disabled={false}
					defaultValue={box.defaultValue}
					onInput={box.onInput}
					error={box.error}
				/>
			</Modal>
		</form>
	);
}
