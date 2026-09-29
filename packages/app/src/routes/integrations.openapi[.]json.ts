import { DOCS_HEADERS, openApiDocument, publishedOrigin } from '$lib/server/integrations/openapi';
import type { Route } from './+types/integrations.openapi[.]json';

// the OpenAPI 3.1 document for the read API and the webhooks, built by
// $lib/server/integrations/openapi.ts with the address it was asked at as its server.
//
// **served without a key**, outside ./integrations.v1.ts's layout: it is documentation, it names
// nothing read from the database, and a reader needs it before they hold a key. ../routes.spec.ts
// lists it as public for that reason. it is readable from any page, so a viewer hosted elsewhere
// can load it; the keyed surface beside it sends no CORS header at all.

export function loader({ url }: Route.LoaderArgs): Response {
	return Response.json(openApiDocument(publishedOrigin(url)), { headers: DOCS_HEADERS });
}
