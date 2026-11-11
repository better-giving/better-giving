// what a supporter's forms and staff's supporter controls post, as flat schemas (AGENTS.md → Forms):
// start a fundraiser, edit one, ask for a sign-in link, and staff's hide and the organisation
// setting. a route parses each through $lib/server/conform.ts and hands the value to
// $lib/server/supporters/; the shape, length and goal rules are said here so a browser says them
// before a round trip.
//
// pure and not under `$lib/server/**`: a component imports every name here.
import { z } from 'zod';
import { FORM_CURRENCY, readAmount } from '../forms/amounts';
import { REQUIRED } from '../forms/input-schema';
import { GOAL_MINOR_MAX } from '../page/catalog';

/** the longest page title. */
export const SUPPORTER_TITLE_MAX = 80;
/** the longest story, in characters. */
export const SUPPORTER_STORY_MAX = 1_500;
/** the longest name a supporter goes by. */
export const SUPPORTER_NAME_MAX = 100;
/** the longest note staff leave on a page they hide. */
export const SUPPORTER_HIDE_NOTE_MAX = 300;
/** the smallest goal, in minor units of `FORM_CURRENCY`: 50 of the nonprofit's currency. */
export const SUPPORTER_GOAL_MIN_MINOR = 5_000;

const atMost = (max: number) => `must be at most ${max.toLocaleString('en-US')} characters`;

const text = (max: number) => z.string().trim().min(1, REQUIRED).max(max, atMost(max));

/** a box that may be left blank, read as null. */
const optionalText = (max: number) =>
	z
		.string()
		.trim()
		.max(max, atMost(max))
		.optional()
		.transform((value) => (value === undefined || value === '' ? null : value));

/**
 * lowercased with `toLowerCase`, which folds every script: sqlite's `lower()` folds ASCII alone, so
 * the database cannot be the one to do it (`supporter.email` in ../server/db/schema.ts). the unicode
 * pattern, so an address with an accent in it is taken rather than refused.
 */
const EMAIL = z
	.string()
	.trim()
	.toLowerCase()
	.pipe(z.email({ pattern: z.regexes.unicodeEmail, error: 'must be an email address' }));

const NAME = text(SUPPORTER_NAME_MAX);

/** a goal as typed in the nonprofit's currency, read as minor units between the floor and the cap. */
const GOAL = z.string().transform((typed, ctx) => {
	const read = readAmount(typed.trim(), FORM_CURRENCY);
	if (read.minor === null) {
		ctx.addIssue({ code: 'custom', message: read.problem ?? REQUIRED });
		return z.NEVER;
	}
	if (read.minor < SUPPORTER_GOAL_MIN_MINOR) {
		ctx.addIssue({ code: 'custom', message: 'must be at least 50' });
		return z.NEVER;
	}
	if (read.minor > GOAL_MINOR_MAX) {
		ctx.addIssue({ code: 'custom', message: 'must be a smaller amount' });
		return z.NEVER;
	}
	return read.minor;
});

/** a stored photo by its upload's id; blank is none. whether it was stored is the write's. */
const PHOTO_ID = optionalText(200);

const PAGE_BOXES = {
	title: text(SUPPORTER_TITLE_MAX),
	goal: GOAL,
	story: text(SUPPORTER_STORY_MAX),
	photo_id: PHOTO_ID
};

/** Start a fundraiser. */
export const SUPPORTER_START_INPUT = z.object({ name: NAME, email: EMAIL, ...PAGE_BOXES });
export type SupporterStart = z.output<typeof SUPPORTER_START_INPUT>;

/** a supporter's edit of their own page: the address and the email are not boxes. */
export const SUPPORTER_EDIT_INPUT = z.object({ name: NAME, ...PAGE_BOXES });
export type SupporterEdit = z.output<typeof SUPPORTER_EDIT_INPUT>;

/** "Email me a link". */
export const SUPPORTER_SIGN_IN_INPUT = z.object({ email: EMAIL });

/** staff hiding a page, with a note for staff. */
export const SUPPORTER_HIDE_INPUT = z.object({ note: optionalText(SUPPORTER_HIDE_NOTE_MAX) });

/** the organisation setting: a checkbox, which posts `on` ticked and no key unticked. */
export const SUPPORTER_SETTING_INPUT = z.object({
	enabled: z
		.literal('on')
		.optional()
		.transform((ticked) => ticked === 'on')
});
