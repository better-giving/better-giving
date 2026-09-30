import { notFoundRefusal } from '$lib/server/integrations/surface';
import type { Route } from './+types/integrations.v1.$';

// every path beneath `/integrations/v1` that no list serves — `/gifts/{id}`, a list's name
// misspelt — answered with the surface's JSON 404 naming the path and the lists, where the root's
// HTML error page would answer otherwise. it nests under ./integrations.v1.ts, so the method and
// the key are checked before it answers, as they are before a list does.

export function loader({ request }: Route.LoaderArgs): Response {
	return notFoundRefusal(new URL(request.url).pathname);
}
