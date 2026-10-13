import { useEffect } from 'react';
import { BLOCK_FORMS, BOXES } from '$lib/page/block-edit';
import { PAGE_END_DATE_FORM_ID, PAGE_GOAL_FORM_ID } from '$lib/page/page-settings-form';
import { useDraftPresses } from './draft-presses';
import { EndDateSheet } from './end-date-sheet';
import { GoalSheet } from './goal-sheet';
import { ShareMessageSheet } from './share-message-sheet';

// a campaign's goal and end date, and any page's share message, each a sheet over Settings: each
// posts its form ($lib/page/page-settings-form.ts, $lib/page/block-edit.ts) to the editor route's
// action through ./draft-presses.ts, the sheet's own owner, so an answer does not outlive the sheet
// that asked: a reopened sheet starts with none.
//
// each sheet has one Done that closes it when the write lands and keeps what was typed when it is
// refused.

/** one form's press: what to post, how it stands, and what its last answer said. */
function usePress(form: string, version: number) {
	const presses = useDraftPresses(version);
	return {
		busy: presses.busy,
		saved: presses.landed(form),
		/** the first sentence the last answer refused `box` with — `''` is the form's own. */
		refused: (box: string) => presses.refused(form, box),
		post: (fields: Record<string, string>) => presses.press(form, Object.entries(fields))
	};
}

type SheetProps = {
	/** the page's version the editor was drawn at. */
	readonly version: number;
	/** X or Escape. */
	readonly onDismiss: () => void;
	/** a Done landed: the draft holds what was chosen. */
	readonly onSaved: () => void;
};

/** closes the sheet on the render its landed write's answer arrives in. */
function useClosesOnSave(saved: boolean, onSaved: () => void) {
	useEffect(() => {
		if (saved) onSaved();
	}, [saved, onSaved]);
}

/** a campaign's goal, in minor units of the draft's currency; an emptied box removes it. */
export function GoalSettingsSheet({
	goalMinor,
	currency,
	version,
	onDismiss,
	onSaved
}: SheetProps & { readonly goalMinor: number | null; readonly currency: string }) {
	const press = usePress(PAGE_GOAL_FORM_ID, version);
	useClosesOnSave(press.saved, onSaved);
	return (
		<GoalSheet
			goalMinor={goalMinor}
			currency={currency}
			onDone={(next) => {
				if (next === goalMinor) onDismiss();
				else press.post({ goal_minor: next === null ? '' : String(next) });
			}}
			applying={press.busy}
			error={press.refused('goal_minor')}
			refusal={press.refused('')}
			onDismiss={onDismiss}
		/>
	);
}

/**
 * a campaign's end date: the day chosen, and the browser's own time zone, which the day ends in.
 * cleared, the campaign runs until it is ended by hand.
 */
export function EndDateSettingsSheet({
	endDate,
	version,
	onDismiss,
	onSaved
}: SheetProps & { readonly endDate: string | null }) {
	const press = usePress(PAGE_END_DATE_FORM_ID, version);
	useClosesOnSave(press.saved, onSaved);
	return (
		<EndDateSheet
			endDate={endDate}
			onDone={(day) => {
				if (day === endDate) onDismiss();
				else
					press.post({
						end_date: day ?? '',
						time_zone: day === null ? '' : Intl.DateTimeFormat().resolvedOptions().timeZone
					});
			}}
			applying={press.busy}
			error={press.refused('end_date') ?? press.refused('time_zone')}
			refusal={press.refused('')}
			onDismiss={onDismiss}
		/>
	);
}

/** what a donor's share says beside the page's address; an emptied box removes it. */
export function ShareMessageSettingsSheet({
	message,
	version,
	onDismiss,
	onSaved
}: SheetProps & { readonly message: string }) {
	const press = usePress(BLOCK_FORMS.shareMessage, version);
	useClosesOnSave(press.saved, onSaved);
	return (
		<ShareMessageSheet
			message={message}
			onDone={(next) => {
				if (next === message) onDismiss();
				else press.post({ [BOXES.shareMessage]: next });
			}}
			applying={press.busy}
			error={press.refused(BOXES.shareMessage)}
			refusal={press.refused('')}
			onDismiss={onDismiss}
		/>
	);
}
