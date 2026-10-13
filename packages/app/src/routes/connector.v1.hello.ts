import {
	CONNECTOR_ACTIONS,
	CONNECTOR_CONTRACT,
	connectorJson,
	connectorRelease,
	unknownAction
} from '$lib/server/connector/surface';
import { readOrgProfile } from '$lib/server/org/queries';
import { database } from '../context';
import type { Route } from './+types/connector.v1.hello';

// the probe the central connector sends to an address an operator typed, before sign-in and with
// no key: is a Better Giving speaking contract 1 here, which release, what is the organisation
// called, and which actions does it serve. nothing in it is more than the donation page shows.

export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
	const profile = await readOrgProfile(context.get(database));
	return connectorJson({
		service: 'better-giving',
		contract: CONNECTOR_CONTRACT,
		release: connectorRelease(),
		name: profile?.legalName ?? '',
		actions: CONNECTOR_ACTIONS
	});
}

export function action({ request }: Route.ActionArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}
