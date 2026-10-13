import { Field } from '@better-giving/operator/components/forms/Field';
import { useId, useState } from 'react';
import { DoneSheet, useFocusOnRefusal } from './done-sheet';

// what a donor's share says beside the page's address, as Settings' Share message row: stacked over
// Settings, one Done. an emptied box removes it, and a share then says the page's title; the rule on
// its length is the catalog's (`SHARE_MESSAGE_MAX` in $lib/page/catalog.ts), refused under the box.

type ShareMessageSheetProps = {
	/** the page's message, or `''` for none. */
	readonly message: string;
	/** the box as typed, trimmed: `''` removes the message. */
	readonly onDone: (message: string) => void;
	readonly applying: boolean;
	/** the predicate the last apply refused the box with. */
	readonly error?: string | null | undefined;
	/** the last apply's refusal that no box carries. */
	readonly refusal?: string | null | undefined;
	readonly onDismiss: () => void;
};

export function ShareMessageSheet({
	message,
	onDone,
	applying,
	error,
	refusal,
	onDismiss
}: ShareMessageSheetProps) {
	const id = useId();
	const [text, setText] = useState(message);
	useFocusOnRefusal(error, id);

	return (
		<DoneSheet
			title="Share message"
			stacked
			onDismiss={onDismiss}
			applying={applying}
			refusal={refusal}
			onDone={() => onDone(text.trim())}
		>
			<Field
				id={id}
				label="Share message"
				optional
				as="textarea"
				hint="Said beside the page’s address when a donor shares it. Leave it empty to say the page’s title."
				value={text}
				onChange={(event) => setText(event.target.value)}
				error={error}
			/>
		</DoneSheet>
	);
}
