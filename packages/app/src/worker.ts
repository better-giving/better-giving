import type { ServerBuild } from 'react-router';
import { createRequestHandler } from 'react-router';
import { sendDueEntries } from '$lib/server/accounting/deliver';
import { createAccountingProvider } from '$lib/server/accounting/factory';
import { requestDb } from '$lib/server/db/client';
import { readPendingCryptoGifts } from '$lib/server/donations/pending-crypto-read';
import { createEmailProvider } from '$lib/server/email/factory';
import { createPaymentProviders } from '$lib/server/payments/factory';
import { requestContext } from './request-context';

// the worker ./wrangler.jsonc names: every request this deployment answers enters here, and every
// run of its cron `triggers`.
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

/**
 * the work each expression in ./wrangler.jsonc's `triggers` runs, keyed by the expression
 * Cloudflare hands back on `controller.cron`.
 *
 * a table rather than the `switch` Cloudflare's own example writes, for one reason: the set of
 * expressions answered is readable, so ./worker.spec.ts holds it equal to the set that file
 * declares. a schedule declared there with nothing here fires into nothing every time it comes
 * round, and a branch here for an expression nobody declares never runs at all — neither reports
 * itself anywhere else.
 *
 * each run builds what it needs from the env that run was handed, the way a request's handles are
 * built per request (./request-context.ts) — nothing built from a binding is a module-scope
 * singleton (CLAUDE.md).
 */
export const CRON_RUNS: Readonly<Record<string, (env: Env, now: Date) => Promise<void>>> = {
	'*/30 * * * *': (env, now) =>
		readPendingCryptoGifts(
			{
				db: requestDb(env),
				processors: createPaymentProviders(env),
				email: createEmailProvider(env)
			},
			now
		),

	'* * * * *': (env, now) => {
		// one handle, shared by the delivery and by the connection the provider reads its tokens
		// through: the store the factory builds is over this same database.
		const db = requestDb(env);
		return sendDueEntries(
			{ db, provider: createAccountingProvider(env, db), email: createEmailProvider(env) },
			now
		);
	}
};

export default {
	fetch(request, env, ctx) {
		return handleRequest(request, requestContext(env, ctx));
	},

	// every cron run, dispatched on the expression that fired. an expression with no entry above
	// runs nothing, which is the state ./wrangler.jsonc and ./worker.spec.ts exist to keep empty.
	scheduled(controller, env, ctx) {
		const run = CRON_RUNS[controller.cron];
		if (run === undefined) return;
		ctx.waitUntil(run(env, new Date(controller.scheduledTime)));
	}
} satisfies ExportedHandler<Env>;
