import type { Db } from '../db/client';
import type { ApiKey } from '../db/schema';
import { API_KEY_SHAPE, findKeyByPresented } from './keys';

// the read API an organisation's own systems call — a CRM, a warehouse, a script — to read the
// organisation's records: what "under `/integrations/v1`" means and what every answer on it
// carries.
//
// **key-authenticated.** every request presents an API key minted by ./keys.ts in
// `Authorization: Bearer`, and nothing else admits one: no cookie is read, no session is made. a
// `zapier` key is refused like a key never minted, because it is Zapier's credential for its own
// surface and a leak of it reads nothing here.
//
// **read-only.** every route answers GET and HEAD, and the layout refuses any other method with a
// 405 before the key is read. writes through this surface would touch the books, and none exists.
//
// **server to server, so no CORS.** no `Access-Control-*` header is sent and there is no preflight
// branch: a key that runs in a browser has already leaked, and without CORS a page holding one
// cannot read the answer anyway.
//
// **never under `/api/v1`.** that surface is public, unauthenticated and payment-initiating, and
// every rule CLAUDE.md holds it to — CORS from a form's `allowed_origins`, Turnstile, amount
// bounds — is for a donor's browser. none fits a system reading donor records with a key, so this
// surface has its own prefix and its own check.
//
// every answer is `no-store`: a refusal because it is about one request, and a success because it
// carries donors' names and addresses.

/**
 * the URL prefix of the read API.
 *
 * a route joins it by nesting under `src/routes/integrations.v1.ts`, whose `middleware` checks the
 * method and the key; `src/routes.spec.ts` fails on a route served under this prefix that sits anywhere else.
 */
export const INTEGRATIONS_BASE_PATH = '/integrations/v1';

/**
 * every value a refusal's `error` holds on this surface: what an integrator's code switches on,
 * where `message` and `fix` are for whoever reads the body. **add a member, never rename one**; a
 * client reads a code it does not know by the status it came with.
 */
export const INTEGRATIONS_REFUSALS = [
	'missing_key',
	'malformed_key',
	'unknown_key',
	'revoked_key',
	'not_found',
	'method_not_allowed',
	'rate_limited',
	'invalid_limit',
	'invalid_cursor',
	'invalid_updated_since',
	'unknown_parameter'
] as const;
export type IntegrationsRefusalCode = (typeof INTEGRATIONS_REFUSALS)[number];

/** an answer from this surface. */
export function integrationsJson(
	body: unknown,
	status = 200,
	headers: Readonly<Record<string, string>> = {}
): Response {
	return Response.json(body, { status, headers: { ...headers, 'cache-control': 'no-store' } });
}

/** a refusal in the shape `/api/v1`'s refusals take (`ApiError` in packages/form/src/v1.ts). */
export function integrationsRefusal(
	status: number,
	error: IntegrationsRefusalCode,
	message: string,
	fix: string,
	headers: Readonly<Record<string, string>> = {}
): Response {
	return integrationsJson({ error, message, fix }, status, headers);
}

/** the 405 this surface answers a method other than GET or HEAD with. */
export function readOnlyRefusal(method: string): Response {
	return integrationsRefusal(
		405,
		'method_not_allowed',
		`${method} is not a method this endpoint answers. The read API at ${INTEGRATIONS_BASE_PATH} only reads.`,
		'Send it as GET, or HEAD for the headers alone. Nothing on this surface writes.',
		{ allow: 'GET, HEAD' }
	);
}

/**
 * each bucket a request on this surface is charged against: `INTEGRATIONS_KEY_RATE_LIMITER` per
 * key, and `API_RATE_LIMITER` per address ahead of the key lookup.
 *
 * literals because the bindings' are, in wrangler.jsonc, and nothing in the language joins them:
 * `../api/rate-limit.config.spec.ts` holds both refusals below to the limit and period every block
 * there declares, and `./openapi.spec.ts` holds the published document to the same. `requests` is
 * per minute in every sentence that names it, which that spec holds the period to.
 */
export const KEY_RATE_LIMIT = { requests: 120, periodSeconds: 60 } as const;
export const ADDRESS_RATE_LIMIT = { requests: 600, periodSeconds: 60 } as const;

/**
 * the 429 a key that has spent its own bucket is answered with, charged per key against
 * `INTEGRATIONS_KEY_RATE_LIMITER` (`integrationsKeyRateLimitKey` in ../api/rate-limit.ts). the
 * wait is the whole period, which is the longest the bucket can hold a key.
 */
export function keyRateLimitRefusal(): Response {
	const { requests, periodSeconds } = KEY_RATE_LIMIT;
	return integrationsRefusal(
		429,
		'rate_limited',
		`This API key has used its limit of ${requests} requests a minute, which is counted per key. Nothing about the request is wrong.`,
		`Wait ${periodSeconds} seconds, as \`Retry-After\` says, and send it again; then pace this system under ${requests} requests a minute. Another system’s key has a limit of its own and is not slowed by this one.`,
		{ 'retry-after': String(periodSeconds) }
	);
}

/**
 * the 429 an address that has spent its own bucket is answered with, charged against
 * `API_RATE_LIMITER` before the key is looked up (`integrationsCallerRateLimitKey` in
 * ../api/rate-limit.ts). it says a per-key limit is not what refused it, so an integrator pacing
 * one key under its limit is not sent looking at the wrong number.
 */
export function callerRateLimitRefusal(): Response {
	const { requests, periodSeconds } = ADDRESS_RATE_LIMIT;
	return integrationsRefusal(
		429,
		'rate_limited',
		`This address has used its limit of ${requests} requests a minute, which is counted per address before any key is checked. Nothing about the request is wrong.`,
		`Wait ${periodSeconds} seconds, as \`Retry-After\` says, and send it again. Several systems behind one address share this limit, whatever keys they hold; a key’s own limit is ${KEY_RATE_LIMIT.requests} requests a minute and is not what refused this.`,
		{ 'retry-after': String(periodSeconds) }
	);
}

const WHERE_KEYS_COME_FROM =
	'API keys are made by the organisation that runs this deployment, one per system, and each is shown once when it is made.';

/**
 * the key a request presents, admitted: its row when it is a live `api` key, and otherwise the 401
 * that says which of the four ways it fell short.
 *
 * the header's shape is checked before any read, so a request carrying no key, or something that
 * is not one, costs no database read. the presented value is never echoed back: a caller who
 * pasted the wrong secret into the header would get it printed into whatever logs the body.
 */
export async function admitKey(db: Db, authorization: string | null): Promise<ApiKey | Response> {
	if (authorization === null)
		return keyRefusal(
			'missing_key',
			`This request carries no \`Authorization\` header. The read API at ${INTEGRATIONS_BASE_PATH} answers only a request presenting an API key.`,
			`Send the key in an \`Authorization: Bearer <key>\` header on every request. ${WHERE_KEYS_COME_FROM}`
		);

	const presented = bearerValue(authorization);
	if (presented === null || !API_KEY_SHAPE.test(presented))
		return keyRefusal(
			'malformed_key',
			presented === null
				? 'The `Authorization` header does not use the `Bearer` scheme, so it carries no API key.'
				: 'The value after `Bearer` is not an API key: a key is `bgk_` followed by 43 letters and digits, 47 characters in all.',
			'Send `Authorization: Bearer <key>` with the whole key and nothing else: a key cut short, or with a quote or a space inside it, is the usual cause.'
		);

	const key = await findKeyByPresented(db, presented);
	if (key === null || key.kind !== 'api')
		return keyRefusal(
			'unknown_key',
			'The API key presented is not one this deployment made.',
			`Check the key was copied whole, and from this deployment rather than another. A lost key cannot be shown again. ${WHERE_KEYS_COME_FROM}`
		);

	if (key.revokedAt !== null)
		return keyRefusal(
			'revoked_key',
			`The API key presented was revoked at ${key.revokedAt.toISOString()}, and admits nothing since.`,
			'Ask the organisation that runs this deployment for a new key, and replace this one wherever your system stores it.'
		);

	return key;
}

/**
 * a 401. `WWW-Authenticate` names the scheme, which a 401 is required to carry
 * (https://www.rfc-editor.org/rfc/rfc9110#name-401-unauthorized).
 */
function keyRefusal(error: IntegrationsRefusalCode, message: string, fix: string): Response {
	return integrationsRefusal(401, error, message, fix, { 'www-authenticate': 'Bearer' });
}

/**
 * the value after a `Bearer` scheme, or `null` for another scheme. the scheme is case-insensitive,
 * as HTTP says every scheme is, and must be followed by whitespace, so `Bearerish x` is another
 * scheme rather than this one.
 */
function bearerValue(authorization: string): string | null {
	const match = /^bearer(?:\s+(.*))?$/i.exec(authorization.trim());
	return match === null ? null : (match[1] ?? '').trim();
}
