import { listAnswer, readPageQuery } from '$lib/server/integrations/paging';
import {
	RECURRING_GIFT_ORDERS,
	readRecurringGiftPage
} from '$lib/server/integrations/recurring-gift';
import { database } from '../context';
import type { Route } from './+types/integrations.v1.recurring-gifts';

// the organisation's recurring gifts, a page at a time, for its own systems to read with a key.
// the method and the key were checked by ./integrations.v1.ts before this runs.
//
// what one entry holds and which commitments are listed is
// $lib/server/integrations/recurring-gift.ts's header, and how a list pages and what it answers is
// $lib/server/integrations/paging.ts's.

export async function loader({ request, context }: Route.LoaderArgs): Promise<Response> {
	const query = readPageQuery(new URL(request.url), RECURRING_GIFT_ORDERS);
	if (query instanceof Response) return query;
	return listAnswer(
		await readRecurringGiftPage(context.get(database), query),
		RECURRING_GIFT_ORDERS,
		query
	);
}
