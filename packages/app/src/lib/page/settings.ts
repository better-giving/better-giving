// a page's draft donation settings: what `settings` in a page document holds, and what publish
// copies onto the page's owned form row. its keys are a form record's (`FormRecord` in
// `$lib/server/forms/form-input.ts`) but for the row's id, name and status, which the page does not
// draft; `$lib/server/forms/draft-settings.spec.ts` holds the two lists to one.
//
// the shape and the closed sets only. what a saved row must also be — bounds the right way round,
// suggested amounts inside them, a pinned program named — is the form row's rule
// (`$lib/forms/input-schema.ts`) and not a draft's: a draft may sit half-edited.
//
// pure and not under `$lib/server/**`: ./catalog.ts parses a page with it, and a component renders
// what that returns.
import { z } from 'zod';
import { MAX_SUGGESTED_AMOUNTS } from '../forms/amounts';
import { PROGRAM_MODES } from '../forms/program-modes';

const AMOUNT = 'an amount is a whole number of minor units above zero';
const amount = z.int({ error: AMOUNT }).positive({ error: AMOUNT });

export const draftSettings = z.strictObject({
	/** the fund the page's gifts post to. */
	revenueAccountId: z.string().min(1, { error: 'a fund is named by its account id' }),
	minMinor: amount.nullable(),
	maxMinor: amount.nullable(),
	currency: z.string().regex(/^[A-Z]{3}$/, { error: 'a currency is three uppercase letters' }),
	programMode: z.enum(PROGRAM_MODES, {
		error: `a program mode is ${PROGRAM_MODES.join(', ')}`
	}),
	programId: z.string().min(1, { error: 'a program is named by its id' }).nullable(),
	suggestedAmounts: z.array(amount).max(MAX_SUGGESTED_AMOUNTS, {
		error: `a page suggests at most ${MAX_SUGGESTED_AMOUNTS} amounts`
	}),
	allowedOrigins: z.array(z.string())
});
