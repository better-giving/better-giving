import {
	connectorCallerRateLimitKey,
	connectorKeyRateLimitKey,
	isRateLimited
} from '$lib/server/api/rate-limit';
import { touchConnectorKey } from '$lib/server/connector/keys';
import {
	admitConnectorKey,
	CONNECTOR_BASE_PATH,
	connectorProblem,
	UNKEYED,
	unknownAction
} from '$lib/server/connector/surface';
import { connection, database, platform } from '../context';
import type { Route } from './+types/connector.v1';

// `/connector/v1`, the surface Better Giving's central connector speaks to this deployment on:
// $lib/server/connector/surface.ts states the contract's side here. this layout is the gate every
// action beneath it passes — a caller rate limit, then the connector key, then the key's own rate
// limit — except `hello` and `exchange`, which take no key. an address beneath it no action serves
// is the splat's (./connector.v1.$.ts), answered as `unknown_action` so the connector reads it as
// "update Better Giving".

const tooMany = () =>
	connectorProblem(
		429,
		'rate_limited',
		'Too many requests',
		'This deployment is answering this connection too often right now. Wait a minute and try again.'
	);

const gate: Route.MiddlewareFunction = async ({ context, request }, next) => {
	const { env, ctx } = context.get(platform);
	const db = context.get(database);
	if (await isRateLimited(env.API_RATE_LIMITER, connectorCallerRateLimitKey(request)))
		return tooMany();
	const { pathname } = new URL(request.url);
	// a `.data` address is react router's single-fetch, a second format nothing here publishes.
	if (pathname.endsWith('.data')) return unknownAction(pathname, request.method);
	if (UNKEYED.has(pathname)) return next();
	const admitted = await admitConnectorKey(db, request.headers.get('authorization'));
	if (admitted instanceof Response) return admitted;
	if (await isRateLimited(env.INTEGRATIONS_KEY_RATE_LIMITER, connectorKeyRateLimitKey(admitted.id)))
		return tooMany();
	context.set(connection, admitted);
	const answer = await next();
	ctx.waitUntil(touchConnectorKey(db, admitted));
	return answer;
};

export const middleware: Route.MiddlewareFunction[] = [gate];

/** the bare surface address: no action, so the contract's `unknown_action`. */
export function loader({ request }: Route.LoaderArgs): Response {
	return unknownAction(CONNECTOR_BASE_PATH, request.method);
}

export function action({ request }: Route.ActionArgs): Response {
	return unknownAction(CONNECTOR_BASE_PATH, request.method);
}
