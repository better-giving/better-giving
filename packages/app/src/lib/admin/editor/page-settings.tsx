import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { useCallback, useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { LookControl, type PageLook } from '$lib/admin/look/look-control';
import { type AdminActionData, resultFor } from '$lib/admin/use-admin-form';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import type { Corner, Shade } from '$lib/page/keys';
import {
	PAGE_END_DATE_FORM_ID,
	PAGE_GOAL_FORM_ID,
	PAGE_LOOK_FORM_ID,
	PAGE_SHARE_FORM_ID,
	type PageSettingFormId,
	type PageSettingsSeed
} from '$lib/page/page-settings-form';
import { EndDateSheet } from './end-date-sheet';
import { GoalSheet } from './goal-sheet';
import { ShareMessageSheet } from './share-message-sheet';

// the Settings sheet's look, goal, end date and share message, for both editors: each posts its
// form ($lib/page/page-settings-form.ts) through a fetcher of its own to the editor route's action
// (`savePageSetting` in $lib/server/pages/page-settings.ts), written against the page's version
// the editor was drawn at. a landed write moves that version, which reloads the preview.
//
// the look applies on pick. the goal, end date and share message are sheets over Settings, each with
// one Done that closes it when the write lands and keeps what was typed when it is refused.
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
		(fields: Record<string, string>, at: number = version) => {
			const body = new FormData();
			body.set(WHICH_FORM, form);
			body.set(RECORD_VERSION, String(at));
			for (const [box, value] of Object.entries(fields)) body.set(box, value);
			submit(body, { method: 'post' });
		},
		[submit, form, version]
	);
	return {
		busy,
		/** the press in flight's body, while there is one. */
		sending: busy ? fetcher.formData : undefined,
		answer,
		saved: answer?.saved === form,
		/** the first sentence the last answer refused `box` with — `''` is the form's own. */
		refused: (box: string) => result?.error?.[box]?.[0] ?? null,
		post
	};
}

/** a look as its form posts it: every box, blank where the Organisation's needs none. */
function lookFields(look: PageLook): Record<string, string> {
	return look.source === 'organisation'
		? { look: 'organisation', shade: '', corner: '', brand_colour: '' }
		: {
				look: 'custom',
				shade: look.shade,
				corner: look.corner,
				brand_colour: look.brandColour ?? ''
			};
}

/** the look a body or a refusal's echo holds, read box by box. */
function lookIn(box: (name: string) => unknown): PageLook | null {
	if (box('look') === 'organisation') return { source: 'organisation' };
	if (box('look') !== 'custom') return null;
	const colour = box('brand_colour');
	return {
		source: 'custom',
		shade: box('shade') as Shade,
		corner: box('corner') as Corner,
		brandColour: typeof colour === 'string' && colour !== '' ? colour : null
	};
}

type PageLookSettingsProps = {
	readonly seed: PageSettingsSeed;
	/** the page's version the editor was drawn at. */
	readonly version: number;
};

/**
 * the page's look, saved at every pick. a pick made while one is in flight waits for its answer and
 * goes at the version that answer revalidated, so quick picks land in turn rather than the second
 * reading as stale; only the latest waiting pick is sent. a refused pick stays drawn, with the
 * refusal beside it.
 */
export function PageLookSettings({ seed, version }: PageLookSettingsProps) {
	const press = usePress(PAGE_LOOK_FORM_ID, version);
	const [waiting, setWaiting] = useState<PageLook | null>(null);
	const { busy, post } = press;

	useEffect(() => {
		if (busy || waiting === null) return;
		setWaiting(null);
		post(lookFields(waiting), version);
	}, [busy, waiting, version, post]);

	const inFlight = press.sending ? lookIn((box) => press.sending?.get(box)) : null;
	const echoed = resultFor({ id: PAGE_LOOK_FORM_ID }, press.answer)?.initialValue;
	const refusedPick = echoed ? lookIn((box) => echoed[box]) : null;
	const refusal =
		press.refused('') ??
		press.refused('shade') ??
		press.refused('corner') ??
		press.refused('brand_colour');

	return (
		<>
			<LookControl
				mode="page"
				value={waiting ?? inFlight ?? refusedPick ?? seed.look}
				organisation={seed.organisationLook}
				onChange={(next) => {
					if (busy) setWaiting(next);
					else post(lookFields(next));
				}}
			/>
			{/* a row of its own under the look, as the organisation's Look draws it
			    (routes/_app.admin.organisation.tsx); mounted empty, so the answer arriving in it is
			    announced. */}
			<div className="adm-actions">
				<span role="status">
					{busy || waiting !== null ? (
						<StatusWord register="momentary" neutral>
							Saving…
						</StatusWord>
					) : refusal !== null ? (
						<StatusWord register="momentary" blocked mark="circle-alert">
							<MarkedText text={refusal} />
						</StatusWord>
					) : null}
				</span>
			</div>
		</>
	);
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

/** the page's share message: the Organisation's, which removes the page's own, or its own words. */
export function ShareMessageSettingsSheet({
	own,
	seed,
	version,
	onDismiss,
	onSaved
}: SheetProps & { readonly own: string | null; readonly seed: PageSettingsSeed }) {
	const press = usePress(PAGE_SHARE_FORM_ID, version);
	useClosesOnSave(press.saved, onSaved);
	return (
		<ShareMessageSheet
			orgMessage={
				seed.organisationShareMessage ?? 'None written yet, so the page’s title is shared.'
			}
			own={own}
			onDone={(next) => {
				if (next === own) onDismiss();
				else
					press.post(
						next === null
							? { share_message: 'organisation', message: '' }
							: { share_message: 'custom', message: next }
					);
			}}
			applying={press.busy}
			error={press.refused('message')}
			refusal={press.refused('')}
			onDismiss={onDismiss}
		/>
	);
}
