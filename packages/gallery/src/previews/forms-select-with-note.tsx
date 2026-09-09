import { SelectWithNote } from '@better-giving/operator/components/forms/SelectWithNote';

/*
 * the select and the three sentences it can hold, which are three different registers: `hint` is
 * read before choosing and sits over the box, `error` is what the last press answered with and
 * `note` is a standing condition — an option that should be in the list is missing and this says
 * why. the two under the box are reachable together, and the specimen holding both is the only
 * place the order the two rows stack in is visible.
 *
 * `retired` is the case a list of options cannot express on its own: a fund no longer offered
 * stays in the list, appended and marked, until another is chosen. it is drawn selected here
 * because that is the only state it exists in.
 *
 * the empty list is what the control draws before anything has been created — a select with no
 * options, which is a control an operator can focus and cannot answer.
 *
 * the two pointer states are the whole of what the control pins: packages/operator/src/styles/adm.css
 * gives `.adm-select` a hover twin and packages/operator/src/styles/base.css draws every
 * `.is-focus`. unavailable is not pinned at all — the sheet draws `:disabled` with no twin beside
 * it — so the specimen for it is the real attribute the control passes through.
 */
const funds = [
	{ value: 'general', label: 'General fund' },
	{ value: 'winter', label: 'Winter night shelter' },
	{ value: 'kitchen', label: 'Community kitchen' }
];

export default function FormsSelectWithNotePreview() {
	return (
		<div className="adm-stack">
			<SelectWithNote
				id="forms-select-plain"
				label="Fund"
				name="fund"
				options={funds}
				defaultValue="winter"
			/>
			<SelectWithNote
				id="forms-select-hint"
				label="Region"
				name="region"
				options={funds}
				hint="Choose the one closest to your donors. It can't be changed afterwards."
			/>
			<SelectWithNote
				id="forms-select-note"
				label="Fund"
				name="fund-note"
				options={funds}
				note="A fund created in the last minute may not be here yet. Reload to fetch the list again."
			/>
			<SelectWithNote
				id="forms-select-error"
				label="Fund"
				name="fund-error"
				options={funds}
				error="That fund was closed while this page was open."
			/>
			<SelectWithNote
				id="forms-select-both"
				label="Fund"
				name="fund-both"
				options={funds}
				error="That fund was closed while this page was open."
				note="Only funds this deployment can post to are listed."
			/>
			<SelectWithNote
				id="forms-select-retired"
				label="Fund"
				name="fund-retired"
				options={funds}
				retired={{ value: 'appeal-2019', label: 'Flood appeal 2019' }}
				defaultValue="appeal-2019"
			/>
			<SelectWithNote
				id="forms-select-marked"
				label="Fund"
				name="fund-marked"
				options={funds}
				aria-invalid="true"
			/>
			<SelectWithNote
				id="forms-select-empty"
				label="Fund"
				name="fund-empty"
				note="No funds have been created yet."
			/>
			<SelectWithNote
				id="forms-select-unlabelled"
				aria-label="Fund"
				name="fund-unlabelled"
				options={funds}
			/>
			<SelectWithNote id="forms-select-hover" label="hover" options={funds} state="hover" />
			<SelectWithNote id="forms-select-focus" label="focus" options={funds} state="focus" />
			<SelectWithNote
				id="forms-select-really-disabled"
				label="disabled attribute"
				options={funds}
				disabled
			/>
			<SelectWithNote
				id="forms-select-long"
				label="Fund"
				name="fund-long"
				options={[
					{
						value: 'winter-2026',
						label: 'Winter night shelter and emergency cold-weather provision, Kirkstall and Burley'
					},
					{ value: 'general', label: 'General fund' }
				]}
				defaultValue="winter-2026"
			/>
		</div>
	);
}
