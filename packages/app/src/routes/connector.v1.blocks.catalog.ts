import { replacedAction, unknownAction } from '$lib/server/connector/surface';
import type { Route } from './+types/connector.v1.blocks.catalog';

// `blocks.catalog`, retired: answered as `replaced`, pointing at `content.catalog`.

export function loader(): Response {
	return replacedAction('blocks.catalog', 'content.catalog');
}

export function action({ request }: Route.ActionArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}
