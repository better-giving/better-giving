import { revokeConnectorKey } from '$lib/server/connector/keys';
import { unknownAction } from '$lib/server/connector/surface';
import { connection, database } from '../context';
import type { Route } from './+types/connector.v1.disconnect';

// the connector letting its own key go — an operator revoking the connection in Claude or ChatGPT,
// or the connector sweeping a connection it no longer holds — so the key stops admitting anything
// here too rather than living on until someone presses Disconnect on the dashboard. outside the
// contract's action list (no tool calls it); answered 204, and the key is refused from then on.

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'POST')
		return unknownAction(new URL(request.url).pathname, request.method);
	await revokeConnectorKey(context.get(database), context.get(connection).id, 'connector');
	return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

export function loader({ request }: Route.LoaderArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}
