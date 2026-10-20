import { EIN } from '@better-giving/operator/console/org-rules';
import { STAFF_USER_ID } from '$lib/server/auth';
import { notFound } from '$lib/server/db/load-failure';
import { lookUpNonprofit, searchNonprofits } from '$lib/server/org/nonprofits';
import { platform, staff } from '../context';
import type { Route } from './+types/_app.admin.settings_.nonprofits';

// what Settings' "Find your charity" box asks with `?q=`: a name search of the IRS files, or, where
// the box holds an EIN, the one lookup by it. a `loader` with no component, which the Settings
// screen (./_app.admin.settings.tsx) asks by fetcher, out of that screen's layout nesting by the
// `settings_` in its name. the service, its limits and its answers are
// $lib/server/org/nonprofits.ts's; what each answer looks like is $lib/org/nonprofit-answers.ts's.
//
// **an EIN is looked up, never searched and then looked up**, because the service's keyless
// allowance is a request a minute: a whole EIN in the box is one call, and the lookup is what
// carries the address a search does not. a name search answers EINs, and the screen asks the one
// it picked at ./_app.admin.settings_.nonprofits_.$ein.ts. anything that is not an EIN is a name,
// digits and all: `211 LA County` is a search.
//
// **only the deployer's session reaches it**, the predicate the Settings screen reads, and a member
// is answered with not-found before the service is asked.

const NOT_HERE =
	'No organisation search for a member’s session. The organisation’s details are the ' +
	'deployer’s: sign in with `ADMIN_PASSWORD` at /login.';

export async function loader({ context, request }: Route.LoaderArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);
	const key = context.get(platform).env.NONPROFITS_API_KEY;
	const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
	return EIN.test(q) ? lookUpNonprofit(q, key) : searchNonprofits(q, key);
}
