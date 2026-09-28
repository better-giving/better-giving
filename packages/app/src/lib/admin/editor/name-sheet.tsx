import { Field } from '@better-giving/operator/components/forms/Field';
import { useId, useState } from 'react';
import { DoneSheet, useFocusOnRefusal } from './done-sheet';

// a campaign's name, as Settings' Name row: the same value the publish bar edits in place
// (./in-place-name.tsx), in a box with a label for a reader who came to it from the list. stacked
// over Settings, one Done.

type NameSheetProps = {
	/** the name as stored. */
	readonly name: string;
	/** a non-empty name, trimmed. */
	readonly onDone: (name: string) => void;
	readonly applying: boolean;
	/** the predicate the last apply refused the box with. */
	readonly error?: string | null | undefined;
	/** the last apply's refusal that no box carries. */
	readonly refusal?: string | null | undefined;
	readonly onDismiss: () => void;
};

export function NameSheet({ name, onDone, applying, error, refusal, onDismiss }: NameSheetProps) {
	const id = useId();
	const [text, setText] = useState(name);
	// `required` once a Done found the box empty, until something is typed into it.
	const [empty, setEmpty] = useState(false);
	useFocusOnRefusal(error, id);

	return (
		<DoneSheet
			title="Name"
			stacked
			onDismiss={onDismiss}
			applying={applying}
			refusal={refusal}
			onDone={() => {
				const trimmed = text.trim();
				if (trimmed === '') {
					setEmpty(true);
					document.getElementById(id)?.focus();
					return;
				}
				onDone(trimmed);
			}}
		>
			<Field
				id={id}
				label="Name"
				value={text}
				onChange={(event) => {
					setText(event.target.value);
					if (empty && event.target.value.trim() !== '') setEmpty(false);
				}}
				error={empty ? 'required' : error}
			/>
		</DoneSheet>
	);
}
