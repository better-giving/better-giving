// every word a donor reads on a supporter's fundraiser and on the entry card that starts one. the
// donor page's own words stay in $lib/donate/copy.ts; these are the supporter feature's.

import { NO_FORM } from '../../donate/copy';

/** where the entry card and the footer send a supporter to start a fundraiser. */
export const START_HREF = '/fundraise';

export function entryHeading(orgName: string): string {
	return `Raise money for ${orgName}`;
}

export function entryBody(orgName: string): string {
	return `Start your own page with your story and a goal, then share the link with friends and family. Every gift goes straight to ${orgName}, which sends the receipt.`;
}

export const ENTRY_ACTION = 'Start a fundraiser';
export const ENTRY_NOTE = 'Takes about two minutes. No password.';
export const START_YOUR_OWN = 'Start your own fundraiser';

export const FOR_LEAD = 'A fundraiser for ';

/** the byline's date line: "today" on the day it went live, by the UTC calendar day of `now`. */
export function startedOn(startedAt: string, now: string, locale: string): string {
	const day = (iso: string) => iso.slice(0, 10);
	if (day(new Date(startedAt).toISOString()) === day(new Date(now).toISOString())) {
		return 'Started this fundraiser today';
	}
	const date = new Intl.DateTimeFormat(locale, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(Date.parse(startedAt));
	return `Started this fundraiser on ${date}`;
}

/** a count of gifts: "1 gift", "41 gifts". */
export function giftCount(gifts: number, locale: string): string {
	return gifts === 1 ? '1 gift' : `${new Intl.NumberFormat(locale).format(gifts)} gifts`;
}

export const AMOUNT_RAISED = 'Amount raised';
export const GOAL_REACHED = 'Goal reached';
export const NO_GIFTS_YET = 'No gifts yet. Yours could be the first.';
export const STILL_OPEN = 'Thank you. Gifts are still open.';

export function ofGoal(percent: number): string {
	return `${percent}% of goal`;
}

export function giveTo(firstName: string): string {
	return `Give to ${firstName}'s fundraiser`;
}

export const GOES_TO = 'Your gift goes to';

export function goesToNotTo(orgName: string, firstName: string): string {
	return `It goes to ${orgName}, not to ${firstName}. ${orgName} sends your receipt.`;
}

export function about(orgName: string): string {
	return `About ${orgName}`;
}

export function story(firstName: string): string {
	return `${firstName}'s story`;
}

export const SHARE_HEADING = 'Share this page';

/** the notice over a hidden fundraiser's staff preview; a visitor gets `NO_FORM` in its place. */
export const HIDDEN_TITLE = 'Hidden from visitors';
export const HIDDEN_BODY = `Visitors see “${NO_FORM}” instead of this page.`;
export const HIDDEN_NOTE_LABEL = 'Note for the supporter:';
