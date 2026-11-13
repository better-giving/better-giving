import { formatMinorBrief } from '$lib/donations/money';
import { SUPPORTER_GOAL_MIN_MINOR } from '$lib/supporters/input';

// every sentence the supporter's own screens say, in a fundraiser's words.

/** a figure as the screens show a total or a goal: `$3,240`, and cents only where there are some. */
export const money = (amountMinor: number, currency: string): string =>
	formatMinorBrief(amountMinor, currency);

/** `$50`, the smallest goal, in the currency every page is raised in. */
const GOAL_FLOOR = (currency: string) => money(SUPPORTER_GOAL_MIN_MINOR, currency);

/**
 * the sentence under a refused box. the schema's own messages are rules for a parser
 * ($lib/supporters/input.ts); a supporter is told what to type instead, so each box says one thing
 * whichever rule it broke, bar the goal's cap.
 */
export function boxSentence(box: string, message: string, currency: string): string {
	switch (box) {
		case 'name':
			return 'Enter your name.';
		case 'email':
			return 'Enter an email address like maya@example.org.';
		case 'title':
			return 'Enter a title for your page.';
		case 'goal':
			return message === 'must be a smaller amount'
				? 'Enter a smaller goal.'
				: `Enter a goal of at least ${GOAL_FLOOR(currency)}.`;
		case 'story':
			return 'Tell people why you’re raising money.';
		default:
			return message;
	}
}

/** the page's counter under the story: `262 of 1,500`. */
export const counted = (used: number, max: number): string =>
	`${used.toLocaleString('en-US')} of ${max.toLocaleString('en-US')}`;

/** why a start or a save did not go through, said above the press. */
export const START_REFUSED = {
	too_many: 'Too many tries. Wait a few minutes, then try again.',
	challenge_failed: 'We couldn’t check that a person sent this. Try again.',
	challenge_unavailable:
		'We couldn’t check that a person sent this just now. Try again in a few minutes.'
} as const;

export type StartRefusal = keyof typeof START_REFUSED | 'photo_missing';

/** a photo that did not arrive or was not stored, under the photo's press. */
export const PHOTO_NOT_STORED = 'That photo didn’t upload. Add it again.';

/** the photo's source refused before a crop: the banner's sentence, said of a photo. */
export const photoTooNarrow = (width: number, min: number): string =>
	`That image is only ${width} pixels wide. A photo needs at least ${min}. Choose a larger one.`;

export const photoTooShort = (height: number, min: number): string =>
	`That image is only ${height} pixels tall. A photo needs at least ${min}. Choose a taller one.`;

/**
 * what a supporter's page is to them: waiting on its confirm link, taking gifts, taken down by
 * staff, or ended for good. an ended page reads as ended whoever else has hidden it.
 */
export type PageState = 'pending' | 'live' | 'hidden' | 'ended';

/** a page's state from the columns the server reads (`OwnFundraiserListing`). */
export function pageState(status: 'pending' | 'live' | 'ended', hidden: boolean): PageState {
	if (status === 'ended') return 'ended';
	return hidden ? 'hidden' : status;
}

/** the status badge's words and tone. */
export function statusBadge(
	state: PageState,
	orgName: string
): { readonly word: string; readonly tone: 'success' | 'warning' | 'neutral' } {
	switch (state) {
		case 'live':
			return { word: 'Live', tone: 'success' };
		case 'hidden':
			return { word: `Hidden by ${orgName}`, tone: 'warning' };
		case 'ended':
			return { word: 'Ended', tone: 'neutral' };
		case 'pending':
			return { word: 'Not published yet', tone: 'neutral' };
	}
}

const DAY = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	year: 'numeric',
	timeZone: 'UTC'
});
const DAY_IN_YEAR = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	timeZone: 'UTC'
});

/**
 * `Jan 6, 2026`: the day a page ended, and a gift's day where the gifts run across two years, in UTC so
 * the server's render and the browser's agree.
 */
export const longDay = (iso: string): string => DAY.format(new Date(iso));

/** `Nov 11`: a gift's day in the table. */
export const shortDay = (iso: string): string => DAY_IN_YEAR.format(new Date(iso));

/** `41 gifts`, `1 gift`. */
export const giftCount = (gifts: number): string =>
	gifts === 1 ? '1 gift' : `${gifts.toLocaleString('en-US')} gifts`;

/** the line beside a total: `of $5,000 goal · 41 gifts`, or `· no gifts yet`. */
export const ofGoal = (goal: string, gifts: number): string =>
	`of ${goal} goal · ${gifts === 0 ? 'no gifts yet' : giftCount(gifts)}`;
