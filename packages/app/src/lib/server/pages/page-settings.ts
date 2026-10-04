import { z } from 'zod';
import { defineForm } from '../../forms/definition';
import { GOAL_MINOR_MAX } from '../../page/catalog';
import { dayWords, endOfDay, isTimeZone } from '../../page/end-date';
import {
	PAGE_END_DATE_FORM_ID,
	PAGE_GOAL_FORM_ID,
	type PageSettingFormId
} from '../../page/page-settings-form';
import { invalid, type ParsedForm, parseForm, submittedVersion } from '../conform';
import type { Db } from '../db/client';
import { type DraftKeys, type SettingsTarget, updateDraftKeys } from './queries';

// the Settings sheet's goal and end date, for both editors: each press parsed here and written to
// the draft alone (`updateDraftKeys` in ./queries.ts) against the version the editor was drawn at,
// so the live page moves only at Publish. a page's look and share message are its own and set only
// through its editor's chat (../../page/accept-reply.ts).
//
// **the goal** is minor units in the page's currency, and an emptied box removes it. **the end
// date** is a day and the IANA zone of the browser that chose it: the draft stores the day's end in
// that zone (`endOfDay` in ../../page/end-date.ts) beside the zone, both or neither, and a day
// already over is refused naming it. both are a campaign's alone, and the Donation page refuses
// them.
//
// a press drawn before any other write to the page — a chat turn, a rename, another setting — is
// refused at 409 rather than putting back what that write moved.

const GOAL_EDIT = defineForm({
	id: PAGE_GOAL_FORM_ID,
	schema: z.object({ goal_minor: z.string().trim().optional() })
});

const END_DATE_EDIT = defineForm({
	id: PAGE_END_DATE_FORM_ID,
	schema: z.object({
		end_date: z.string().trim().optional(),
		time_zone: z.string().trim().optional()
	})
});

/** a goal as the sheet posts it: whole minor units above zero. `readGoal` holds it to `GOAL_MINOR_MAX`. */
const GOAL_MINOR = /^[1-9]\d*$/;

const STALE =
	'Nothing was changed: this page has been saved since the editor was opened. Reload it, then make this change again.';
const FAILED = 'Saving this setting failed and nothing was changed. Try again.';

type Read =
	| { readonly ok: true; readonly keys: DraftKeys; readonly reject: RejectOf }
	| { readonly ok: false; readonly refusal: ReturnType<typeof invalid> };

type RejectOf = ParsedForm<unknown>['reject'];

/** what a press sets or removes, and the rejection it answers with should the write not land. */
function taken(submission: ParsedForm<unknown>, keys: DraftKeys): Read {
	return { ok: true, keys, reject: submission.reject };
}

/** a body the form's own rule refused. */
function unparsed(submission: ParsedForm<unknown>): Read {
	return { ok: false, refusal: invalid(400, submission.reject()) };
}

/** the rejection of a submission whose boxes each carry the sentence refusing them. */
function refusedBoxes(submission: ParsedForm<unknown>, boxes: Record<string, string>): Read {
	const fieldErrors = Object.fromEntries(
		Object.entries(boxes).map(([box, sentence]) => [box, [sentence]])
	);
	return { ok: false, refusal: invalid(400, submission.reject({ fieldErrors })) };
}

function readGoal(body: FormData, target: SettingsTarget): Read {
	const submission = parseForm(body, GOAL_EDIT);
	if (!submission.ok) return unparsed(submission);
	if (target.type !== 'campaign') return campaignsOnly(submission, 'goal');
	const sent = submission.value.goal_minor;
	if (sent === undefined) return taken(submission, { goalMinor: undefined });
	if (!GOAL_MINOR.test(sent) || Number(sent) > GOAL_MINOR_MAX) {
		return refusedBoxes(submission, {
			goal_minor: `a whole number of minor units above zero, not ${JSON.stringify(sent)}`
		});
	}
	return taken(submission, { goalMinor: Number(sent) });
}

function readEndDate(body: FormData, target: SettingsTarget): Read {
	const submission = parseForm(body, END_DATE_EDIT);
	if (!submission.ok) return unparsed(submission);
	if (target.type !== 'campaign') return campaignsOnly(submission, 'end date');
	const { end_date: day, time_zone: zone } = submission.value;
	if (day === undefined) {
		return taken(submission, { endsAt: undefined, endsZone: undefined });
	}
	if (zone === undefined || !isTimeZone(zone)) {
		return refusedBoxes(submission, {
			time_zone:
				zone === undefined
					? 'required with an end date: the IANA time zone its day ends in'
					: `${JSON.stringify(zone)} is not a time zone`
		});
	}
	// the day's end is read whatever the clock says, so a day already over is told apart from one
	// that is no day at all.
	const ends = endOfDay({ day, timeZone: zone, now: Number.NEGATIVE_INFINITY });
	if (!ends.ok) return refusedBoxes(submission, { end_date: ends.reason });
	if (ends.endsAt <= Date.now()) {
		return refusedBoxes(submission, {
			end_date: `today or later; ${dayWords(day)} is already over`
		});
	}
	return taken(submission, { endsAt: ends.endsAt, endsZone: zone });
}

/** the Donation page's refusal of what only a campaign carries, in ../../page/catalog.ts's words. */
function campaignsOnly(submission: ParsedForm<unknown>, what: string): Read {
	return {
		ok: false,
		refusal: invalid(
			400,
			submission.reject({
				formErrors: [`the Donation page has no ${what}; only a campaign does`]
			})
		)
	};
}

function read(form: PageSettingFormId, body: FormData, target: SettingsTarget): Read {
	switch (form) {
		case PAGE_GOAL_FORM_ID:
			return readGoal(body, target);
		case PAGE_END_DATE_FORM_ID:
			return readEndDate(body, target);
	}
}

/**
 * one of the two presses, for the page `target` names. `gone` is what a press on a page that is
 * not there is told.
 */
export async function savePageSetting(
	db: Db,
	target: SettingsTarget,
	form: PageSettingFormId,
	body: FormData,
	gone: string
) {
	const parsed = read(form, body, target);
	if (!parsed.ok) return parsed.refusal;
	const seen = submittedVersion(body);
	let written: Awaited<ReturnType<typeof updateDraftKeys>>;
	try {
		written = await updateDraftKeys(db, target, seen, parsed.keys);
	} catch (e) {
		console.error(`saving ${form} for ${JSON.stringify(target)} failed:`, e);
		return invalid(500, parsed.reject({ formErrors: [FAILED] }));
	}
	switch (written) {
		case 'written':
			return { saved: form };
		case 'stale':
			return invalid(409, parsed.reject({ formErrors: [STALE] }));
		case 'gone':
			return invalid(404, parsed.reject({ formErrors: [gone] }));
	}
}
