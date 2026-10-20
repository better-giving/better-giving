import { EIN } from '@better-giving/operator/console/org-rules';
import { STAFF_USER_ID } from '$lib/server/auth';
import { notFound } from '$lib/server/db/load-failure';
import { lookUpNonprofit } from '$lib/server/org/nonprofits';
import { platform, staff } from '../context';
import type { Route } from './+types/_app.admin.settings_.nonprofits_.$ein';

// one organisation from the IRS files, mapped onto Settings' details boxes: what the Settings
// screen (./_app.admin.settings.tsx) asks by fetcher once a match is picked off a name search
// (./_app.admin.settings_.nonprofits.ts). a `loader` with no component, out of the search's nesting
// by the `nonprofits_` in its name. the service is $lib/server/org/nonprofits.ts's; the answer's
// shape is $lib/org/nonprofit-answers.ts's.
//
// **only the deployer's session reaches it**, and a member is answered with not-found before the
// service is asked. so is an address whose last segment is no EIN, which names no organisation.

const NOT_HERE =
	'No organisation lookup for a member’s session. The organisation’s details are the ' +
	'deployer’s: sign in with `ADMIN_PASSWORD` at /login.';

const NOT_AN_EIN =
	'No organisation at this address: it ends in an EIN, nine digits written `12-3456789`.';

export async function loader({ context, params }: Route.LoaderArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);
	if (!EIN.test(params.ein)) notFound(NOT_AN_EIN);
	return lookUpNonprofit(params.ein, context.get(platform).env.NONPROFITS_API_KEY);
}
