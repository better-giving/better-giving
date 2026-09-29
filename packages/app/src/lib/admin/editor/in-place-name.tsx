import { type KeyboardEvent, useState } from 'react';

// a campaign's name, edited where it stands in the publish bar: the words at rest, a box only once
// it is pointed at or holds the caret (`.adm-inplace`). the Donation page has no name to edit and
// draws its word instead (./publish-bar.tsx).
//
// the name is committed when the box is left or on Enter, and only when it changed — or when the
// last rename was refused, so the same words can be sent again once the refusal lands. a box emptied
// and left goes back to the stored name: a campaign always has one, and nothing typed is lost that
// was not already the stored value. Escape puts the stored name back without committing.
//
// it has no label on the screen — the bar's name is what the words already say — so it carries its
// name for a screen reader, and a refusal of the last rename is described into it by the bar.

type InPlaceNameProps = {
	/** the name as stored. */
	readonly value: string;
	/** a changed, non-empty name was committed. */
	readonly onRename: (name: string) => void;
	/** the box's accessible name. */
	readonly label?: string;
	/** the last rename was refused. */
	readonly invalid?: boolean;
	/** the refusal the box is described by. */
	readonly 'aria-describedby'?: string | undefined;
};

export function InPlaceName({
	value,
	onRename,
	label = 'Campaign name',
	invalid = false,
	'aria-describedby': describedBy
}: InPlaceNameProps) {
	const [draft, setDraft] = useState(value);
	// the stored name the box was last drawn against: a rename answered, or one made in the Name
	// sheet, moves the box to the new name.
	const [seed, setSeed] = useState(value);
	// the last name handed to `onRename`, so Enter and the blur after it are one rename and not two.
	const [sent, setSent] = useState(value);
	if (seed !== value) {
		setSeed(value);
		setDraft(value);
		setSent(value);
	}
	// a refusal landing clears what was sent: the guard below keeps Enter and the blur after it one
	// rename, and a refused one stored nothing to guard.
	const [refused, setRefused] = useState(invalid);
	if (refused !== invalid) {
		setRefused(invalid);
		if (invalid) setSent(value);
	}

	const commit = () => {
		const name = draft.trim();
		if (name === '') {
			setDraft(value);
			return;
		}
		if (name !== draft) setDraft(name);
		if (name === value || name === sent) return;
		setSent(name);
		onRename(name);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			commit();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			setDraft(value);
		}
	};

	return (
		<input
			className="adm-inplace"
			type="text"
			aria-label={label}
			aria-invalid={invalid || undefined}
			aria-describedby={describedBy}
			value={draft}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={commit}
			onKeyDown={onKeyDown}
		/>
	);
}
