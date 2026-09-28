import { DONOR_ORDERS, readDonorPage } from '$lib/server/integrations/donor';
import { listAnswer, readPageQuery } from '$lib/server/integrations/paging';
import { database } from '../context';
import type { Route } from './+types/integrations.v1.donors';

// the organisation's donors, a page at a time, for its own systems to read with a key. the method
// and the key were checked by ./integrations.v1.ts before this runs.
//
// what one entry holds and which donors are listed is $lib/server/integrations/donor.ts's header,
// and how a list pages and what it answers is $lib/server/integrations/paging.ts's.

export async function loader({ request, context }: Route.LoaderArgs): Promise<Response> {
	const query = readPageQuery(new URL(request.url), DONOR_ORDERS);
	if (query instanceof Response) return query;
	return listAnswer(await readDonorPage(context.get(database), query), DONOR_ORDERS, query);
}
