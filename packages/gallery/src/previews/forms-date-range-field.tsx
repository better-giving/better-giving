import { DateRangeField } from '@better-giving/operator/components/forms/DateRangeField';

/*
 * the two ends of one range over one calendar, in the states nobody opens.
 *
 * the boxes are the same two ./forms-date-field.tsx draws at the foot of its own page, chunks and
 * all, and this page is not a second reading of them: what it exists to show is the one thing the pair of
 * independent pickers over there cannot: one calendar, opened from either box, holding both ends
 * at once — so the second day is chosen against the first and the head reads the whole range.
 *
 * the calendar is drawn by nothing here and opens from the press at the end of either box. over a
 * whole range the first day picked starts a new one and the second closes it; over a range holding
 * a near day and no far one it resumes at the end that is missing, so one press finishes it. the
 * days between the two ends draw nothing of their own: the sheet marks the two days that were
 * chosen and has no rung for what lies between them.
 *
 * the seeds are a real financial year rather than round days, so what is on the screen is what an
 * operator would be looking at. every day in this format is the same width, so the string that is
 * a layout constraint here is the label rather than the value — the last specimen is that one.
 *
 * the refusal is drawn under the far end alone, which is where the one refusal a range can be
 * walked into belongs: `RANGE_REVERSED` in packages/app/src/lib/ledger/journal-range.ts is told to
 * the box the operator changes. the near end beside it is the specimen that says an untouched end
 * keeps its own row empty rather than reserving one.
 */
export default function FormsDateRangeFieldPreview() {
	return (
		<div className="adm-stack">
			<DateRangeField
				id="forms-range-plain"
				legend="Date range"
				from={{ id: 'forms-range-plain-from', name: 'plain-from', label: 'From' }}
				to={{ id: 'forms-range-plain-to', name: 'plain-to', label: 'To' }}
			/>
			<DateRangeField
				id="forms-range-seeded"
				legend="Date range"
				from={{
					id: 'forms-range-seeded-from',
					name: 'seeded-from',
					label: 'From',
					defaultValue: '2025-04-06'
				}}
				to={{
					id: 'forms-range-seeded-to',
					name: 'seeded-to',
					label: 'To',
					defaultValue: '2026-04-05'
				}}
			/>
			{/* the sentence and the standing note are the range's rather than either box's, which is
			    the whole reason they are drawn once above and once below the pair instead of twice
			    beside each other. */}
			<DateRangeField
				id="forms-range-said"
				legend="Date range"
				hint="Gifts settled between these two days, both of them included."
				needed="A journal cannot be downloaded until both ends are set."
				from={{
					id: 'forms-range-said-from',
					name: 'said-from',
					label: 'From',
					defaultValue: '2025-04-06'
				}}
				to={{ id: 'forms-range-said-to', name: 'said-to', label: 'To' }}
			/>
			{/* refused under the far end alone: the near end draws no message row and the two boxes
			    still stand on one line. */}
			<DateRangeField
				id="forms-range-refused"
				legend="Date range"
				from={{
					id: 'forms-range-refused-from',
					name: 'refused-from',
					label: 'From',
					defaultValue: '2026-04-05'
				}}
				to={{
					id: 'forms-range-refused-to',
					name: 'refused-to',
					label: 'To',
					defaultValue: '2025-04-06',
					error: 'must not be before the first day of the range'
				}}
			/>
			{/* marked from outside with no message of its own, which is what a box refused by a rule
			    that belongs to something larger than the pair looks like. */}
			<DateRangeField
				id="forms-range-marked"
				legend="Date range"
				from={{
					id: 'forms-range-marked-from',
					name: 'marked-from',
					label: 'From',
					defaultValue: '2025-04-06',
					'aria-invalid': 'true'
				}}
				to={{
					id: 'forms-range-marked-to',
					name: 'marked-to',
					label: 'To',
					defaultValue: '2026-04-05',
					'aria-invalid': 'true'
				}}
			/>
			{/* both ends at once and never one of them: half a range is not an answer, so neither box
			    is offered without the other. */}
			<DateRangeField
				id="forms-range-disabled"
				legend="Date range"
				disabled
				from={{
					id: 'forms-range-disabled-from',
					name: 'unavailable-from',
					label: 'From',
					defaultValue: '2025-04-06'
				}}
				to={{ id: 'forms-range-disabled-to', name: 'unavailable-to', label: 'To' }}
			/>
			{/* labels long enough to run past the boxes they stand in. floated, each is also the widest
			    the knockout behind it ever gets, and the two are cut where the days they name would be
			    cut rather than wrapped. */}
			<DateRangeField
				id="forms-range-long"
				legend="The days this journal is being drawn for"
				from={{
					id: 'forms-range-long-from',
					name: 'long-from',
					label: 'The first day of the period',
					defaultValue: '2025-04-06'
				}}
				to={{
					id: 'forms-range-long-to',
					name: 'long-to',
					label: 'The last day of the period',
					defaultValue: '2026-04-05'
				}}
			/>
		</div>
	);
}
