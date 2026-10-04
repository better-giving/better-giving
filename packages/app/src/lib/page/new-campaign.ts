// what New campaign takes: the kind of campaign it is and its name. the name becomes the campaign's
// name, so it is held to the name's own limit (`HEADING_MAX` in ./catalog.ts); the type is one of
// `CAMPAIGN_TYPES` (./campaign-types.ts), and a value off that list is refused by the value sent.
//
// pure and not under `$lib/server/**`: the dialog validates with it in the browser
// (`$lib/admin/use-admin-form.ts`), and a component cannot import from there.
import { z } from 'zod';
import { CAMPAIGN_TYPES } from './campaign-types';
import { HEADING_MAX } from './catalog';

const TYPES_LISTED = `${CAMPAIGN_TYPES.slice(0, -1).join(', ')} or ${CAMPAIGN_TYPES.at(-1)}`;

export const NEW_CAMPAIGN_SCHEMA = z.object({
	// a box left blank arrives absent, since conform strips "" before the schema reads it.
	type: z.enum(CAMPAIGN_TYPES, {
		error: (issue) =>
			issue.input === undefined
				? 'required'
				: `"${String(issue.input)}" is no campaign type: ${TYPES_LISTED}`
	}),
	name: z
		.string({ error: 'required' })
		.trim()
		.min(1, { error: 'required' })
		.max(HEADING_MAX, { error: `at most ${HEADING_MAX} characters` })
});
