import { useId, useRef, useState } from 'react';
import { majorEntry, readAmount } from '$lib/forms/amounts';
import { DoneSheet, useFocusOnRefusal } from './done-sheet';
import { MoneyField } from './money-field';

// a campaign's goal, one box and one Done, stacked over Settings. the figure travels as integer
// minor units in the campaign's currency both ways — seeded from them through `majorEntry` and read
// back through `readAmount` in `$lib/forms/amounts`, the parse every amount box on the dashboard
// takes — and an empty box is no goal, which takes the goal bar off the page.
//
// the box is checked when Done is pressed and not before; once refused it is checked again as it is
// typed in, so the predicate clears the moment the figure is good.

type GoalSheetProps = {
	/** the draft's goal, or null for none. */
	readonly goalMinor: number | null;
	/** the three-letter code the goal is in. */
	readonly currency: string;
	/** a figure that parsed, or null for an emptied box. */
	readonly onDone: (goalMinor: number | null) => void;
	readonly applying: boolean;
	/** the predicate the last apply refused the box with. */
	readonly error?: string | null | undefined;
	/** the last apply's refusal that no box carries. */
	readonly refusal?: string | null | undefined;
	readonly onDismiss: () => void;
};

/** what a goal box holds: a figure in minor units, null for none, or the predicate refusing it. */
function readGoal(text: string, currency: string) {
	const trimmed = text.trim();
	if (trimmed === '') return { minor: null, problem: null };
	return readAmount(trimmed, currency);
}

export function GoalSheet({
	goalMinor,
	currency,
	onDone,
	applying,
	error,
	refusal,
	onDismiss
}: GoalSheetProps) {
	const id = useId();
	const box = useRef<HTMLInputElement>(null);
	const [text, setText] = useState(goalMinor === null ? '' : majorEntry(goalMinor, currency));
	// the predicate a Done found, re-read as the box is typed in until it clears.
	const [checked, setChecked] = useState<string | null>(null);
	useFocusOnRefusal(error, box);

	return (
		<DoneSheet
			title="Goal"
			stacked
			onDismiss={onDismiss}
			applying={applying}
			refusal={refusal}
			onDone={() => {
				const read = readGoal(text, currency);
				if (read.problem !== null) {
					setChecked(read.problem);
					box.current?.focus();
					return;
				}
				setChecked(null);
				onDone(read.minor);
			}}
		>
			<MoneyField
				id={id}
				label="Goal"
				optional
				hint="Leave it empty for no goal bar."
				affix={currency}
				affixAt="end"
				currency={currency}
				inputRef={box}
				value={text}
				onValueChange={(next) => {
					setText(next);
					if (checked !== null) setChecked(readGoal(next, currency).problem);
				}}
				error={checked ?? error}
			/>
		</DoneSheet>
	);
}
