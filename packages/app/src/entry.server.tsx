import { renderToReadableStream } from 'react-dom/server';
import type { EntryContext } from 'react-router';
import { ServerRouter } from 'react-router';
import { mintNonce, setDocumentHeaders } from './document-policy';

// the server render, revealed for `streamTimeout` and for the document's security headers.
//
// react router calls this for documents and for nothing else, which is what makes it the one place
// those headers are set: ./document-policy.ts says what they are and why every document carries
// them. the nonce is handed to both halves that write a `<script>` — `ServerRouter` for react
// router's own (`<Scripts>`, `<ScrollRestoration>`), `renderToReadableStream` for react's streaming
// ones.
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
	const nonce = mintNonce();
	let shellRendered = false;
	const body = await renderToReadableStream(
		<ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
		{
			nonce,
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
	setDocumentHeaders(responseHeaders, routerContext, nonce);
	return new Response(body, { headers: responseHeaders, status: responseStatusCode });
}
