import { renderToReadableStream } from 'react-dom/server';
import type { EntryContext } from 'react-router';
import { ServerRouter } from 'react-router';

// the server render, revealed for one line: `streamTimeout`.
//
// a promise handed back from a loader is rejected once that many milliseconds have passed. the
// bound is well inside the platform's own — a worker's response has to begin before cloudflare
// gives up on it — and it is here so that a slow read is drawn as an error on the page rather than
// left to the runtime to cut off with nothing rendered at all.
export const streamTimeout = 10_000;

export default async function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: EntryContext
) {
	let shellRendered = false;
	const body = await renderToReadableStream(
		<ServerRouter context={routerContext} url={request.url} />,
		{
			// a second past the deadline above, so a promise that is going to be rejected is rejected
			// and drawn rather than taking the render down with it.
			signal: AbortSignal.timeout(streamTimeout + 1000),
			onError(error: unknown) {
				responseStatusCode = 500;
				// an error thrown while the shell itself is rendering rejects and is logged by the
				// caller; logging it here as well would print it twice.
				if (shellRendered) console.error(error);
			}
		}
	);
	shellRendered = true;

	responseHeaders.set('Content-Type', 'text/html');
	return new Response(body, { headers: responseHeaders, status: responseStatusCode });
}
