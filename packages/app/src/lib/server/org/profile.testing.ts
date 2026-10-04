import type { Db } from '../db/client';
import { type OrgProfileFormValues, parseOrgProfile } from './org-input';
import { saveOrgProfile } from './queries';

// the organisation's profile saved as the console saves it — through `parseOrgProfile` and
// `saveOrgProfile` — for the specs that read what a donor page or a page's chat draws from it.
//
// not a spec itself, for the reason ./org-row.testing.ts gives. nothing in the app imports it.

/**
 * the boxes the save refuses blank, and the notification address set-up waits on, so a saved
 * profile holds the organisation `writeOrgRow` (./org-row.testing.ts) writes and leaves set-up as
 * `finishSetup` (../../../webhook-routes.testing.ts) leaves it.
 */
const SET_UP: OrgProfileFormValues = {
	legal_name: 'Hope Foundation',
	tax_id: '12-3456789',
	address_line1: '12 Kigali Road',
	city: 'Kigali',
	country: 'Rwanda',
	notification_email: 'alerts@example.org'
};

/** saves the profile with `values` over `SET_UP`'s, and `socialLinks` as typed. */
export async function saveProfile(
	db: Db,
	values: OrgProfileFormValues = {},
	socialLinks: readonly string[] = []
): Promise<void> {
	const parsed = parseOrgProfile({ ...SET_UP, ...values }, socialLinks);
	if (!parsed.ok)
		throw new Error(`the fixture profile did not parse: ${JSON.stringify(parsed.errors)}`);
	await saveOrgProfile(db, parsed.value);
}
