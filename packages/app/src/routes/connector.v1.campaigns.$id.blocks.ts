import { replacedAction, unknownAction } from '$lib/server/connector/surface';
import type { Route } from './+types/connector.v1.campaigns.$id.blocks';

// `campaigns.update_blocks` (PATCH), retired: answered as `replaced`, pointing at `campaigns.update_content`.

export function action({ request }: Route.ActionArgs): Response {
	if (request.method !== 'PATCH')
		return unknownAction(new URL(request.url).pathname, request.method);
	return replacedAction('campaigns.update_blocks', 'campaigns.update_content');
}

export function loader({ request }: Route.LoaderArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}
