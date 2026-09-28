import { readGiftPage } from '$lib/server/integrations/gift';
import { integrationsJson } from '$lib/server/integrations/surface';
import { database } from '../context';
import type { Route } from './+types/integrations.v1.gifts';

// the organisation's gifts, newest first, for its own systems to read with a key. the method and
// the key were checked by ./integrations.v1.ts before this runs.
//
// **the answer is a list envelope, `{ data, next_cursor }`, and stays one**: a bare array could
// never grow a cursor. this route serves the first page only, so `next_cursor` is always null here.
// what one entry holds is `ApiGift` in $lib/server/integrations/gift.ts.

export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
	return integrationsJson({ data: await readGiftPage(context.get(database)), next_cursor: null });
}
