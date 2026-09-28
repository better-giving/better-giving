import { GIFT_ORDERS, type GiftPageQuery, readGiftPage } from '$lib/server/integrations/gift';
import {
	encodeCursor,
	readCursor,
	readLimit,
	readUpdatedSince,
	unknownParameters
} from '$lib/server/integrations/paging';
import { integrationsJson } from '$lib/server/integrations/surface';
import { database } from '../context';
import type { Route } from './+types/integrations.v1.gifts';

// the organisation's gifts, a page at a time, for its own systems to read with a key. the method
// and the key were checked by ./integrations.v1.ts before this runs.
//
// **the answer is a list envelope, `{ data, next_cursor }`, and stays one**: a bare array could
// never grow a cursor. what one entry holds is `ApiGift` in $lib/server/integrations/gift.ts, and
// how a list pages is $lib/server/integrations/paging.ts's header.

export async function loader({ request, context }: Route.LoaderArgs): Promise<Response> {
	const query = readQuery(new URL(request.url));
	if (query instanceof Response) return query;
	const page = await readGiftPage(context.get(database), query);
	return integrationsJson({
		data: page.rows,
		next_cursor: page.next === null ? null : encodeCursor(GIFT_ORDERS[query.order], page.next)
	});
}

const PARAMETERS = ['limit', 'cursor', 'updated_since'] as const;

function readQuery(url: URL): GiftPageQuery | Response {
	const unknown = unknownParameters(url, PARAMETERS);
	if (unknown !== null) return unknown;
	const limit = readLimit(url.searchParams.get('limit'));
	if (limit instanceof Response) return limit;
	const since = readUpdatedSince(url.searchParams.get('updated_since'));
	if (since instanceof Response) return since;
	const after = readCursor(
		url.searchParams.get('cursor'),
		since === null ? GIFT_ORDERS.newest : GIFT_ORDERS.changed
	);
	if (after instanceof Response) return after;
	return since === null
		? { order: 'newest', limit, after }
		: { order: 'changed', limit, after, since };
}
