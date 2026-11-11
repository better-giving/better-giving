import { defineForm } from '$lib/forms/definition';
import {
	SUPPORTER_EDIT_INPUT,
	SUPPORTER_SIGN_IN_INPUT,
	SUPPORTER_START_INPUT
} from '$lib/supporters/input';

// the supporter's forms as stated once: the action parses each through `parseForm` in
// $lib/server/conform.ts and the screen mounts the same statement, so the id, the schema and the
// boxes that must arrive are one fact on both sides.
//
// pure and not under `$lib/server/**`: the screens import every name here.

export const START_FORM = defineForm({ id: 'supporter-start', schema: SUPPORTER_START_INPUT });
export const EDIT_FORM = defineForm({ id: 'supporter-edit', schema: SUPPORTER_EDIT_INPUT });
export const SIGN_IN_FORM = defineForm({
	id: 'supporter-sign-in',
	schema: SUPPORTER_SIGN_IN_INPUT
});

/**
 * the hidden box a start's spam check posts its answer in — a Turnstile token or an ALTCHA payload,
 * whichever the deployment runs. no schema states it: the check reads it, and never the form's
 * parse.
 */
export const CHALLENGE_FIELD = 'challenge';

/** the hidden box each post names what it asks for in; no schema states it. */
export const INTENT = 'intent';

/** every value `INTENT` carries, one per post the supporter's screens make. */
export const INTENTS = {
	start: 'start',
	requestLink: 'request-link',
	resend: 'resend',
	save: 'save',
	end: 'end',
	signOut: 'sign-out'
} as const;

export type Intent = (typeof INTENTS)[keyof typeof INTENTS];

/**
 * the file part a start posts its cropped photo in, beside the boxes. no schema states it: the
 * start's write reads it, and never the form's parse.
 */
export const PHOTO_FILE_FIELD = 'photo';
