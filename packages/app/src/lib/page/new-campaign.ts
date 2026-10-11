// what New campaign takes: the campaign's name, held to the name's own limit (`HEADING_MAX` in
// ./catalog.ts). a body carrying any other box has it dropped by the form layer
// ($lib/server/conform.ts), a `type` among them: New campaign sets no campaign type.
//
// pure and not under `$lib/server/**`: the dialog validates with it in the browser
// (`$lib/admin/use-admin-form.ts`), and a component cannot import from there.
import { z } from 'zod';
import { HEADING_MAX } from './catalog';

export const NEW_CAMPAIGN_SCHEMA = z.object({
	name: z
		.string({ error: 'required' })
		.trim()
		.min(1, { error: 'required' })
		.max(HEADING_MAX, { error: `at most ${HEADING_MAX} characters` })
});
