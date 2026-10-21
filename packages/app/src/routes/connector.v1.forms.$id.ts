import { readConfigEnv } from '$lib/server/config/env';
import { readConnectorForm, updateConnectorForm } from '$lib/server/connector/forms';
import { jsonBody } from '$lib/server/connector/origin';
import {
	connectorJson,
	connectorProblem,
	notFound,
	unknownAction
} from '$lib/server/connector/surface';
import { database, platform } from '../context';
import type { Route } from './+types/connector.v1.forms.$id';

// `forms.get` (GET) and `forms.update` (PATCH).

export async function loader({ context, params }: Route.LoaderArgs): Promise<Response> {
	const form = await readConnectorForm(context.get(database), params.id);
	return form === null ? notFound(`Form ${params.id}`) : connectorJson(form);
}

export async function action({ context, params, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'PATCH')
		return unknownAction(new URL(request.url).pathname, request.method);
	const done = await updateConnectorForm(
		context.get(database),
		readConfigEnv(context.get(platform).env),
		params.id,
		await jsonBody(request)
	);
	if (!done.ok)
		return connectorProblem(done.status, done.code, 'Refused', done.detail, done.errors);
	return connectorJson(done.form);
}
