import { useCallback, useEffect } from 'react';
import { useFetcher } from 'react-router';
import { type AdminActionData, resultFor } from '$lib/admin/use-admin-form';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import {
	PAGE_END_DATE_FORM_ID,
	PAGE_GOAL_FORM_ID,
	type PageSettingFormId
} from '$lib/page/page-settings-form';
import { EndDateSheet } from './end-date-sheet';
import { GoalSheet } from './goal-sheet';

// a campaign's goal and end date, each a sheet over Settings: each posts its form
// ($lib/page/page-settings-form.ts) through a fetcher of its own to the editor route's action
// (`savePageSetting` in $lib/server/pages/page-settings.ts), written against the page's version
// the editor was drawn at. a landed write moves that version, which reloads the preview.
//
// each sheet has one Done that closes it when the write lands and keeps what was typed when it is
// refused.
//
// each fetcher is unkeyed, so an answer does not outlive the part that asked: a reopened sheet
// starts with none.

type Answer = AdminActionData & { readonly saved?: string };

/** one form's press: what to post, how it stands, and what its last answer said. */
function usePress(form: PageSettingFormId, version: number) {
	const fetcher = useFetcher<Answer>();
	const busy = fetcher.state !== 'idle';
	const answer = busy ? undefined : fetcher.data;
	const result = resultFor({ id: form }, answer);
	const { submit } = fetcher;
	const post = useCallback(
		(fields: Record<string, string>) => {
			const body = new FormData();
			body.set(WHICH_FORM, form);
			body.set(RECORD_VERSION, String(version));
			for (const [box, value] of Object.entries(fields)) body.set(box, value);
			submit(body, { method: 'post' });
		},
		[submit, form, version]
	);
	return {
		busy,
		saved: answer?.saved === form,
		/** the first sentence the last answer refused `box` with — `''` is the form's own. */
		refused: (box: string) => result?.error?.[box]?.[0] ?? null,
		post
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
