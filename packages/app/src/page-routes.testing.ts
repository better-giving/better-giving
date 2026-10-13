import { edgeCache } from '$lib/server/edge-cache.testing';
import { ORIGIN, PASSWORD } from './program-routes.testing';
import { finishSetup } from './webhook-routes.testing';

// what the page editors' route specs share beyond ./program-routes.testing.ts: a deployment whose
// set-up is finished, which the protected layout's set-up gate serves its screens on alone
// (./routes/_app.tsx).
//
// here rather than beside the routes for ./program-routes.testing.ts's reason: every file directly
// under ./routes/ is an address to `flatRoutes`, bar a spec.

/**
 * the bindings of a set-up deployment, with that module's staff password, and the organisation's
 * set-up jobs written onto whatever profile row the case holds.
 *
 * those bindings hold a Stripe secret, and an editor's loader reads the cadences offered off it
 * ($lib/server/forms/cadence-cache.ts). so one-time alone is kept for `ORIGIN` first — what a
 * deployment with no repeating processor answers — and no case sends the fixture key to Stripe. a
 * case about monthly keeps its own answer over it.
 */
export async function finishedDeployment(): Promise<Env> {
	await edgeCache().put(
		new Request(`${ORIGIN}/__recurring-cadences`),
		new Response(JSON.stringify(['one_time']), {
			headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
		})
	);
	return finishSetup(PASSWORD);
}
