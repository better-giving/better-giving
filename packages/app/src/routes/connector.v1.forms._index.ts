import { readConfigEnv } from '$lib/server/config/env';
import { createConnectorForm, listConnectorForms } from '$lib/server/connector/forms';
import { jsonBody } from '$lib/server/connector/origin';
import { connectorJson, connectorProblem, unknownAction } from '$lib/server/connector/surface';
import { database, platform } from '../context';
import type { Route } from './+types/connector.v1.forms._index';

// `forms.list` (GET) and `forms.create` (POST).

const LIMIT_DEFAULT = 25;
const LIMIT_MAX = 100;

export async function loader({ context, request }: Route.LoaderArgs): Promise<Response> {
	const url = new URL(request.url);
	const limit = Math.min(
		Math.max(Number(url.searchParams.get('limit') ?? LIMIT_DEFAULT) || LIMIT_DEFAULT, 1),
		LIMIT_MAX
	);
	const from = Math.max(Number(url.searchParams.get('cursor') ?? 0) || 0, 0);
	const { data, more } = await listConnectorForms(context.get(database), from, limit);
	return connectorJson({ data, next_cursor: more ? String(from + limit) : null });
}

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'POST')
		return unknownAction(new URL(request.url).pathname, request.method);
	const made = await createConnectorForm(
		context.get(database),
		readConfigEnv(context.get(platform).env),
		await jsonBody(request)
	);
	if (!made.ok)
		return connectorProblem(made.status, made.code, 'Refused', made.detail, made.errors);
	return connectorJson(made.form, 201);
}
