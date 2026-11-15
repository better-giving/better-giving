// the three presses on a gift's employer match in /admin, as `defineForm` statements the route's
// action and the gift detail screen both read ($lib/forms/definition.ts says why one statement and
// not two literals).
//
// each posts to the gift's own address with the hidden `intent` box naming the act, beside the
// `WHICH_FORM` box `whichForm` in $lib/admin/use-admin-form.ts writes. pure and not under
// `$lib/server/**`, so a component may import every name here.
import { z } from 'zod';
import { defineForm } from '../forms/definition';
import { REQUIRED } from '../forms/input-schema';

/** the box a match press names its act in. */
export const MATCH_INTENT = 'intent';

/** the donor filed the claim with their employer, as staff heard it. */
export const MARK_FILED_FORM = defineForm({
	id: 'match-filed',
	schema: z.object({ [MATCH_INTENT]: z.literal('filed') })
});

/** the employer's money arrived. */
export const MARK_MATCHED_FORM = defineForm({
	id: 'match-matched',
	schema: z.object({ [MATCH_INTENT]: z.literal('matched') })
});

/**
 * the match closed, with a reason only staff see. blank after trimming is refused here as well as
 * by `voidMatch` in $lib/server/matching/match.ts, so a browser says it before a round trip.
 */
export const VOID_MATCH_FORM = defineForm({
	id: 'match-void',
	schema: z.object({
		[MATCH_INTENT]: z.literal('void'),
		reason: z.string({ error: REQUIRED }).trim().min(1, REQUIRED)
	})
});
