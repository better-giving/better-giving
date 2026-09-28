import { Button } from '@better-giving/operator/components/controls/Button';
import { DateField } from '@better-giving/operator/components/forms/DateField';
import { useId } from 'react';
import { DoneSheet, useFocusOnRefusal } from './done-sheet';

// a campaign's end date, stacked over Settings: a calendar day as `YYYY-MM-DD` in and out, which the
// caller turns into the instant the campaign ends. an emptied box and Done is no end date, and so is
// Clear end date, drawn while there is one to clear — cleared, the campaign runs until it is ended
// by hand.

/** what the day box submits under, inside this sheet's own form. */
const DAY = 'end_date';

type EndDateSheetProps = {
	/** the draft's end date as `YYYY-MM-DD`, or null for none. */
	readonly endDate: string | null;
	/** the day chosen, or null for none. */
	readonly onDone: (endDate: string | null) => void;
	readonly applying: boolean;
	/** the predicate the last apply refused the day with. */
	readonly error?: string | null | undefined;
	/** the last apply's refusal that no box carries. */
	readonly refusal?: string | null | undefined;
	readonly onDismiss: () => void;
};

export function EndDateSheet({
	endDate,
	onDone,
	applying,
	error,
	refusal,
	onDismiss
}: EndDateSheetProps) {
	const id = useId();
	// the day box is found by its id, which is where packages/operator/src/components/forms/DateField.jsx
	// hands a refusal's focus on to its chunks.
	useFocusOnRefusal(error, id);

	return (
		<DoneSheet
			title="End date"
			stacked
			onDismiss={onDismiss}
			applying={applying}
			refusal={refusal}
			aside={
				endDate === null ? null : (
					<Button
						type="button"
						variant="quiet"
						aria-disabled={applying || undefined}
						onClick={() => {
							if (!applying) onDone(null);
						}}
					>
						Clear end date
					</Button>
				)
			}
			onDone={(form) => {
				const day = new FormData(form).get(DAY);
				onDone(typeof day === 'string' && day !== '' ? day : null);
			}}
		>
			<DateField
				id={id}
				name={DAY}
				label="End date"
				hint="The campaign ends at the end of this day, your time."
				defaultValue={endDate ?? ''}
				error={error}
			/>
		</DoneSheet>
	);
}
