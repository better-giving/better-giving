import { CheckboxGroup } from '@better-giving/operator/components/forms/CheckboxGroup';
import { Field } from '@better-giving/operator/components/forms/Field';
import { useId, useState } from 'react';
import { DoneSheet, useFocusOnRefusal } from './done-sheet';

// the message a page is shared with, stacked over Settings: the Organisation's, or one written for
// this page. the pick and the words are applied together by the one Done.

type ShareMessageSheetProps = {
	/** the Organisation's share message, shown under its choice. */
	readonly orgMessage: string;
	/** the page's own message, or null while it takes the Organisation's. */
	readonly own: string | null;
	/** the page's own message, trimmed, or null for the Organisation's. */
	readonly onDone: (own: string | null) => void;
	readonly applying: boolean;
	/** the predicate the last apply refused the page's own message with. */
	readonly error?: string | null | undefined;
	/** the last apply's refusal that no box carries. */
	readonly refusal?: string | null | undefined;
	readonly onDismiss: () => void;
};

export function ShareMessageSheet({
	orgMessage,
	own,
	onDone,
	applying,
	error,
	refusal,
	onDismiss
}: ShareMessageSheetProps) {
	const id = useId();
	const textId = `${id}-text`;
	const [writing, setWriting] = useState(own !== null);
	const [text, setText] = useState(own ?? '');
	// the predicate a Done found the page's own message empty with, until something is typed.
	const [empty, setEmpty] = useState(false);
	useFocusOnRefusal(error, textId);

	return (
		<DoneSheet
			title="Share message"
			stacked
			onDismiss={onDismiss}
			applying={applying}
			refusal={refusal}
			onDone={() => {
				if (!writing) {
					onDone(null);
					return;
				}
				const trimmed = text.trim();
				if (trimmed === '') {
					setEmpty(true);
					document.getElementById(textId)?.focus();
					return;
				}
				onDone(trimmed);
			}}
		>
			<CheckboxGroup
				id={id}
				type="radio"
				name="share_message"
				legend="Share message"
				legendHidden
				items={[
					{
						id: `${id}-org`,
						label: 'The Organisation’s',
						sub: orgMessage,
						value: 'org',
						checked: !writing,
						onChange: () => setWriting(false)
					},
					{
						id: `${id}-own`,
						label: 'Write one for this page',
						value: 'own',
						checked: writing,
						onChange: () => setWriting(true)
					}
				]}
			/>
			{writing ? (
				<Field
					id={textId}
					label="Message"
					as="textarea"
					rows={3}
					value={text}
					onChange={(event) => {
						setText(event.target.value);
						if (empty && event.target.value.trim() !== '') setEmpty(false);
					}}
					error={empty ? 'required, or pick the Organisation’s' : error}
				/>
			) : null}
		</DoneSheet>
	);
}
