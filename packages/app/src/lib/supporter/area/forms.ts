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
