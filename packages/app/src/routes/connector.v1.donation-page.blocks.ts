import { replacedAction, unknownAction } from '$lib/server/connector/surface';
import type { Route } from './+types/connector.v1.donation-page.blocks';

// `donation_page.update_blocks` (PATCH), retired: answered as `replaced`, pointing at `donation_page.update_content`.

export function action({ request }: Route.ActionArgs): Response {
	if (request.method !== 'PATCH')
		return unknownAction(new URL(request.url).pathname, request.method);
	return replacedAction('donation_page.update_blocks', 'donation_page.update_content');
}

export function loader({ request }: Route.LoaderArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}
