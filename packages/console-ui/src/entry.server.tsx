import { renderToReadableStream } from 'react-dom/server';
import type { EntryContext } from 'react-router';
import { ServerRouter } from 'react-router';

// the one document, rendered once while the build runs.
//
// **this is a build step's own input and not a server.** ../react-router.config.ts says
// `ssr: false`, so react router calls this while `react-router build` writes
// build/client/index.html and never again: the go binary serves that file
// (packages/console/ui/embed.go), and every read and press under it is a call to the same binary
// on the loopback address (src/api/client.ts). src/never-deployed.spec.ts holds the absences that
// keep it that way.
//
// **the entry is this repository's own.** the default @react-router/dev writes in place of a
// missing one adds `isbot` to this package's manifest under a caret range, which CLAUDE.md
// refuses, and carries a bot branch for a document nothing crawls.
//
// nothing streams and nothing is deferred: no route module here carries a `loader`, and a
// `clientLoader` runs in the browser after the document is already written. so there is no
// deadline to set, no abort to tell from a failure, and no shell already flushed to keep a status
// open for — an error in this render rejects, and the build stops.
export default async function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: EntryContext
) {
	const body = await renderToReadableStream(
		<ServerRouter context={routerContext} url={request.url} />
	);

	responseHeaders.set('Content-Type', 'text/html');
	return new Response(body, { headers: responseHeaders, status: responseStatusCode });
}
