// the three presses on a gift's employer match in /admin: each form's id and schema, which the
// route's action and the gift detail screen each state their `defineForm` with — the form-id gate
// (../../../form-rules.ts) reads a form's id where the form is declared, so each module declares
// its own over the one id and schema here, as $lib/page/edit-forms.ts does for the page editor.
//
// each posts to the gift's own address with the hidden `intent` box naming the act, beside the
// `WHICH_FORM` box `whichForm` in $lib/admin/use-admin-form.ts writes. pure and not under
// `$lib/server/**`, so a component may import every name here.
import { z } from 'zod';
import { REQUIRED } from '../forms/input-schema';

/** the box a match press names its act in. */
export const MATCH_INTENT = 'intent';

/** each press's form id. */
export const MATCH_FORMS = {
	filed: 'match-filed',
	matched: 'match-matched',
	void: 'match-void'
} as const;

/** the donor filed the claim with their employer, as staff heard it. */
export const MARK_FILED_INPUT = z.object({ [MATCH_INTENT]: z.literal('filed') });

/** the employer's money arrived. */
export const MARK_MATCHED_INPUT = z.object({ [MATCH_INTENT]: z.literal('matched') });

/**
 * the match closed, with a reason only staff see. blank after trimming is refused here as well as
 * by `voidMatch` in $lib/server/matching/match.ts, so a browser says it before a round trip.
 */
export const VOID_MATCH_INPUT = z.object({
	[MATCH_INTENT]: z.literal('void'),
	reason: z.string({ error: REQUIRED }).trim().min(1, REQUIRED)
});
