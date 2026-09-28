import { d1BytesPort } from '$lib/server/images/bytes';
import { database } from '../context';
import type { Route } from './+types/image.$id';

// one image's bytes by its id, which is every address an image has: the path names an id and never
// where the bytes are kept, so moving them behind another adapter of the port changes nothing here
// ($lib/server/images/bytes.ts argues the port).
//
// a resource route (react-router/docs/how-to/resource-routes.md): no default export, so the loader's
// `Response` is the answer. react router sends `GET` and `HEAD` alike to it.
//
// no gate. a page's photos are drawn by a donor's `<img>`, and a donor holds no session. an image
// on a draft page is exactly as reachable as one on a live page, and that is the rule rather than a
// gap: the id is a uuidv7 minted by `createImage` in $lib/server/images/queries.ts, whose random
// bits nobody outside this deployment can enumerate, so knowing the address is the permission.
//
// cached for a year and marked immutable because the bytes under an id never change — the port
// refuses a second put, and a replaced photo is a new id. `nosniff` holds the browser to the stored
// type, one of `IMAGE_CONTENT_TYPES` in $lib/server/db/schema.ts. an id matching no row — malformed
// ones included, which the same read answers — is a 404 with no body, saying nothing about what
// is stored.

export async function loader({ context, params }: Route.LoaderArgs): Promise<Response> {
	const stored = await d1BytesPort(context.get(database)).get(params.id);
	if (stored === null) return new Response(null, { status: 404 });
	// copied because a body must be ArrayBuffer-backed and the port promises only `Uint8Array`.
	return new Response(new Uint8Array(stored.bytes), {
		headers: {
			'content-type': stored.contentType,
			'cache-control': 'public, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff',
			'content-disposition': 'inline'
		}
	});
}
