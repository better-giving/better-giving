import { DateField } from '@better-giving/operator/components/forms/DateField';
import { PairedFieldset } from '@better-giving/operator/components/forms/PairedFieldset';

/*
 * the one box on either operator surface whose label stands inside it, in the states nobody opens.
 *
 * the label has two positions. resting it is centred in the box, on the line the day will be drawn
 * on; floated its middle sits on the box's own top border, straddling it, knocking the border out
 * behind the words in the two fills that meet there. the pair under "Date range" below is the one
 * specimen that shows both at once, at one width, and says the thing neither of them says alone:
 * the two boxes are the same height, because neither position reserves any room in the box.
 *
 * the float itself is the one state a specimen cannot pin, and that is the component rather than a
 * gap here: a box is floated while it holds a day or holds the caret, and the caret is not
 * something a page can put anywhere. so the two ends of it are drawn as the two things that really
 * produce them — an empty box, which is resting, and a seeded box, which is floated on its first
 * paint with nothing animating on arrival — and the move between them is reached by clicking into
 * the first one, which is what a reader of this page can do and a screenshot cannot.
 *
 * the pinned focus below is therefore the ring and not the float: `.is-focus` is a class and the
 * float is state, so that specimen is what the box looks like while the ring is on it, with the
 * label still where an empty unfocused box leaves it.
 *
 * the box is drawn at the height a box with no label at all is drawn at, and what is left over the
 * `.adm-input` in ./forms-field.tsx is the press at the end of the row rather than anything the
 * label asked for. no screen stands one of these beside a plain box — it stands them beside each
 * other, which is every pair at the foot of this page.
 *
 * the calendar is drawn by nothing here and opens from the press at the end of each box. it is
 * three views deep — days, then the months of a year, then the years of a decade — and the middle
 * of its head is what climbs between them, so a day two years back is two presses rather than
 * twenty-four of the step beside it.
 *
 * the seeds are real days rather than round ones and the range is a real financial year, so that
 * what is on the screen is what an operator would be looking at. every day in this format is the
 * same width, so the string that is a layout constraint here is the label rather than the value —
 * which is what the last specimen is for.
 */
export default function FormsDateFieldPreview() {
	return (
		<div className="adm-stack">
			<DateField id="forms-date-plain" name="plain" label="From" />
			<DateField id="forms-date-seeded" name="seeded" label="From" defaultValue="2025-04-06" />
			<DateField
				id="forms-date-hint"
				name="hinted"
				label="To"
				hint="The last day the export covers. Gifts settled after it are on the next one."
				defaultValue="2026-04-05"
			/>
			<DateField
				id="forms-date-error"
				name="refused"
				label="From"
				defaultValue="2026-12-31"
				error="There are no books before this deployment took its first gift."
			/>
			<DateField
				id="forms-date-needed"
				name="wanted"
				label="From"
				needed="A journal cannot be downloaded until both ends are set."
			/>
			{/* the two rows are reachable together and neither replaces the other, which is the pair
			    ./forms-field.tsx draws for the same reason: a field holding both is the one specimen
			    that says whether two message rows stack legibly under a box this tall. */}
			<DateField
				id="forms-date-all"
				name="both"
				label="To"
				hint="The last day the export covers."
				defaultValue="2024-02-29"
				error="That day is before the one this range starts on."
				needed="A journal cannot be downloaded until both ends are set."
			/>
			{/* marked from outside with no message of its own: the pair below holds the sentence. */}
			<DateField
				id="forms-date-marked"
				name="marked"
				label="From"
				defaultValue="2026-04-05"
				aria-invalid="true"
			/>
			<DateField
				id="forms-date-disabled"
				name="unavailable"
				label="From"
				disabled
				defaultValue="2025-04-06"
			/>
			<DateField id="forms-date-disabled-empty" name="unavailable-empty" label="To" disabled />
			<DateField id="forms-date-hover" name="hovered" label="hover" state="hover" />
			<DateField id="forms-date-focus" name="focused" label="focus" state="focus" />
			{/* the arrangement the dashboard's export actually draws: two ends of one decision, side
			    by side, with the rule about the pair belonging to neither box — so the fieldset draws
			    the one sentence and marks both boxes from out here. */}
			<PairedFieldset
				id="forms-date-range"
				legend="The days the journal covers"
				side
				error="The first day has to come before the last."
			>
				<DateField
					id="forms-date-range-from"
					name="from"
					label="From"
					defaultValue="2026-04-05"
					aria-describedby="forms-date-range-err"
					aria-invalid="true"
				/>
				<DateField
					id="forms-date-range-to"
					name="to"
					label="To"
					defaultValue="2025-04-06"
					aria-describedby="forms-date-range-err"
					aria-invalid="true"
				/>
			</PairedFieldset>
			{/* the same pair with nothing wrong with it, which is what an operator opens the screen
			    to: two boxes at one height, both floated, both holding a day. */}
			<PairedFieldset id="forms-date-range-ok" legend="The days the journal covers" side>
				<DateField
					id="forms-date-range-ok-from"
					name="ok-from"
					label="From"
					defaultValue="2025-04-06"
				/>
				<DateField id="forms-date-range-ok-to" name="ok-to" label="To" defaultValue="2026-04-05" />
			</PairedFieldset>
			{/* the two positions side by side, which is the arrangement a screen draws them in and the
			    one reading that has both in it at once. */}
			<PairedFieldset id="forms-date-both" legend="Date range" side>
				<DateField id="forms-date-both-from" name="both-from" label="From" />
				<DateField id="forms-date-both-to" name="both-to" label="To" defaultValue="2025-04-06" />
			</PairedFieldset>
			{/* a label long enough to run past the box it stands in. it is cut where the day it names
			    would be cut rather than wrapped: a second line inside the box would push the line the
			    operator types on out of the box altogether. floated, it is also the widest the
			    knockout behind it ever gets — the top border of this box is out for nearly its whole
			    run. */}
			<DateField
				id="forms-date-long"
				name="long"
				label="The first day of the period this journal is being drawn for"
				defaultValue="2025-04-06"
			/>
		</div>
	);
}
