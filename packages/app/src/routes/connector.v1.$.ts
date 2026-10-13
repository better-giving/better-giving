import { unknownAction } from '$lib/server/connector/surface';
import type { Route } from './+types/connector.v1.$';

// any address under `/connector/v1` that no action of this release serves, by any method: the
// contract's `unknown_action`, which the connector reads as "update Better Giving" for that tool.

export function loader({ request }: Route.LoaderArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}

export function action({ request }: Route.ActionArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}
