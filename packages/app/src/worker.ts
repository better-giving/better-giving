import type { ServerBuild } from 'react-router';
import { createRequestHandler } from 'react-router';
import { requestContext } from './request-context';

// the worker ./wrangler.jsonc names, and every request this deployment answers enters here.
//
// one request context is built per request and seeded with what the runtime handed this handler,
// so nothing downstream reads a binding off a module. what goes into it is
// ./request-context.ts's, so that a spec can seed the same one; src/context.ts is where the rule
// is written.
//
// `import.meta.env.MODE` is what tells react router whether to serve an error to the browser or
// swallow it: `development` renders the stack, anything else does not.

const handleRequest = createRequestHandler(
	// asserted for one field. `exactOptionalPropertyTypes` (../../tsconfig.base.json) makes
	// `basename?: string` and `basename: string | undefined` different types, and react router
	// declares the first on `ServerBuild` and the second on this virtual module. the module is
	// written by the build rather than by anything here, so the difference is absorbed at the one
	// call site instead of by loosening the flag for the whole package.
	() => import('virtual:react-router/server-build') as Promise<ServerBuild>,
	import.meta.env.MODE
);

export default {
	fetch(request, env, ctx) {
		return handleRequest(request, requestContext(env, ctx));
	}
} satisfies ExportedHandler<Env>;
