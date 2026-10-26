import { contentCatalog } from '$lib/server/connector/catalog';
import { connectorJson, unknownAction } from '$lib/server/connector/surface';
import type { Route } from './+types/connector.v1.content.catalog';

// `content.catalog`.

export function loader(): Response {
	return connectorJson(contentCatalog());
}

export function action({ request }: Route.ActionArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}
