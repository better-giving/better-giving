import {
	imageRateLimitKey,
	imageRateLimitRefusal,
	isRateLimited
} from '$lib/server/api/rate-limit';
import { d1BytesPort } from '$lib/server/images/bytes';
import { servedImage } from '$lib/server/images/served';
import { database, platform } from '../context';
import type { Route } from './+types/image.$id';

// one image's bytes by its id, which is every address an image has: the path names an id and never
// where the bytes are kept, so moving them behind another adapter of the port changes nothing here
// ($lib/server/images/bytes.ts argues the port). the answer and its headers are
// $lib/server/images/served.ts's. an id matching no row, malformed ones included, is a 404 with no
// body, saying nothing about what is stored.
//
// a resource route (https://reactrouter.com/how-to/resource-routes): no default export, so the
// loader's `Response` is the answer. react router sends `GET` and `HEAD` alike to it.
//
// no gate: a page's photos are drawn by a donor's `<img>`, which carries no session, and knowing
// the id is the permission (../routes.spec.ts argues it).
//
// only a view the edge does not hold is charged: the meter protects D1, and a view answered from the
// edge cache never reaches it. so a caller over the limit is still drawn every photo already kept in
// their data centre, and is refused only the read.
export async function loader({ context, params, request }: Route.LoaderArgs): Promise<Response> {
	const { env, ctx } = context.get(platform);
	return servedImage(
		d1BytesPort(context.get(database)),
		ctx,
		{ origin: new URL(request.url).origin, id: params.id },
		{
			beforeRead: async () =>
				(await isRateLimited(env.API_RATE_LIMITER, imageRateLimitKey(request)))
					? imageRateLimitRefusal()
					: null
		}
	);
}
