import { MAX_DONOR_SEARCH } from '$lib/contacts/input-schema';
import { searchDonors } from '$lib/server/contacts/queries';
import { database } from '../context';
import type { Route } from './+types/_app.admin.donors.search';

// the donor search the Add donation screen's donor box asks as the operator types
// (./_app.admin.donations.new.tsx): a `loader` and nothing else, so it renders no screen and is
// asked by a fetcher. a read, and a route of its own rather than that screen's loader: a
// loader answering two shapes is a page handed a union for the one it draws.
//
// under the protected layout by its name, so the session gate runs for it like any screen.

/**
 * the donors matching `q`, and `q` beside them so the box can tell an answer to what it now holds
 * from one to what it held a keystroke ago.
 *
 * `matches` is `null` where the read failed, never `[]`: the box would draw an empty answer as
 * nobody matching, which sends the operator to create a donor who is already on file.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
	const q = (new URL(request.url).searchParams.get('q') ?? '').slice(0, MAX_DONOR_SEARCH);
	try {
		return { q, matches: await searchDonors(context.get(database), q) };
	} catch (e) {
		console.error('searching donors failed:', e);
		return { q, matches: null };
	}
}
