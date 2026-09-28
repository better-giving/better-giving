// what New campaign takes: a title, an optional line saying what the campaign is for, and the
// browser's time zone, which a date in that line is a day in. the title becomes the campaign's
// name, so it is held to the name's own limit (`HEADING_MAX` in ./catalog.ts).
//
// pure and not under `$lib/server/**`: the dialog validates with it in the browser
// (`$lib/admin/use-admin-form.ts`), and a component cannot import from there.
import { z } from 'zod';
import { HEADING_MAX } from './catalog';
import { isTimeZone } from './end-date';

/** the longest "What's it for?" line: the chat's first message is the title and this together. */
export const PURPOSE_MAX = 2000;

export const NEW_CAMPAIGN_SCHEMA = z.object({
	title: z
		.string({ error: 'Give the campaign a title.' })
		.trim()
		.min(1, { error: 'Give the campaign a title.' })
		.max(HEADING_MAX, { error: `A title holds at most ${HEADING_MAX} characters.` }),
	purpose: z
		.string()
		.trim()
		.max(PURPOSE_MAX, { error: `This holds at most ${PURPOSE_MAX} characters.` })
		.optional(),
	// filled in once the page runs in a browser; a press before then sends it blank.
	time_zone: z
		.string()
		.refine(isTimeZone, {
			error: (issue) => `time_zone "${String(issue.input)}" is not an IANA time zone`
		})
		.optional()
});
