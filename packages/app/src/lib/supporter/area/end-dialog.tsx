import { useId, useRef } from 'react';
import { Form } from 'react-router';
import { INTENT, INTENTS } from './forms';
import { Mark } from './glyph';
import { Modal } from './modal';

// "End this fundraiser?": the question End fundraiser asks before it posts `intent=end`. Cancel
// takes focus, so Enter never ends a page by accident; Escape and Cancel close it with nothing sent.
// a refusal is said inside the card, which stays up, and while the post is in flight the destructive
// press reads busy and takes no second press.

export const END_CONSEQUENCE =
	'Your page stops taking gifts and shows that it has ended. The total stays on the page. You can’t reopen it.';

export type EndDialogProps = {
	readonly title: string;
	/** `$3,240 from 41 gifts`. */
	readonly raised: string;
	/** the last end was refused; said in the card. */
	readonly refused: boolean;
	readonly sending: boolean;
	readonly onCancel: () => void;
};

export function EndDialog({ title, raised, refused, sending, onCancel }: EndDialogProps) {
	const id = useId();
	const cancel = useRef<HTMLButtonElement>(null);
	return (
		<Modal
			role="alertdialog"
			labelledBy={`${id}-title`}
			describedBy={`${id}-body`}
			onDismiss={onCancel}
			initialFocus={cancel}
		>
			<h2 className="sa-dialog-title" id={`${id}-title`}>
				End this fundraiser?
			</h2>
			<p className="sa-quote">
				<b>{title}</b>
				{raised}
			</p>
			<p id={`${id}-body`}>{END_CONSEQUENCE}</p>
			{refused && !sending ? (
				<p className="sa-refused" role="alert">
					<Mark name="alert" />
					Couldn’t end it. Try again.
				</p>
			) : null}
			<Form method="post" className="sa-dialog-actions">
				<input type="hidden" name={INTENT} value={INTENTS.end} />
				<button ref={cancel} type="button" className="ds-btn ds-btn-secondary" onClick={onCancel}>
					Cancel
				</button>
				<button
					type="submit"
					className="ds-btn ds-btn-destructive"
					aria-busy={sending || undefined}
					onClick={(event) => {
						if (sending) event.preventDefault();
					}}
				>
					End fundraiser
				</button>
			</Form>
		</Modal>
	);
}
