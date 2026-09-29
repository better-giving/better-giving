import { readAuthEnv, readPin } from '$lib/server/auth';
import { DOCS_HEADERS, openApiDocument, publishedOrigin } from '$lib/server/integrations/openapi';
import { platform } from '../context';
import type { Route } from './+types/integrations.openapi[.]json';

// the OpenAPI 3.1 document for the read API and the webhooks, built by
// $lib/server/integrations/openapi.ts with this deployment's origin as its server: the one
// `BETTER_AUTH_URL` pins, or the address it was asked at where none is (`publishedOrigin`).
//
// **served without a key**, outside ./integrations.v1.ts's layout: it is documentation, it names
// nothing read from the database, and a reader needs it before they hold a key. ../routes.spec.ts
// lists it as public for that reason. it is readable from any page, so a viewer hosted elsewhere
// can load it; the keyed surface beside it sends no CORS header at all.

export function loader({ context, url }: Route.LoaderArgs): Response {
	const origin = publishedOrigin(url, readPin(readAuthEnv(context.get(platform).env)));
	return Response.json(openApiDocument(origin), { headers: DOCS_HEADERS });
}
