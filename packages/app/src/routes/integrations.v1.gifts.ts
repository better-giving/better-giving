import { GIFT_ORDERS, readGiftPage } from '$lib/server/integrations/gift';
import { listAnswer, readPageQuery } from '$lib/server/integrations/paging';
import { database } from '../context';
import type { Route } from './+types/integrations.v1.gifts';

// the organisation's gifts, a page at a time, for its own systems to read with a key. the method
// and the key were checked by ./integrations.v1.ts before this runs.
//
// what one entry holds is `ApiGift` in $lib/server/integrations/gift.ts, and how a list pages and
// what it answers is $lib/server/integrations/paging.ts's header.

export async function loader({ request, context }: Route.LoaderArgs): Promise<Response> {
	const query = readPageQuery(new URL(request.url), GIFT_ORDERS);
	if (query instanceof Response) return query;
	return listAnswer(await readGiftPage(context.get(database), query), GIFT_ORDERS, query);
}
