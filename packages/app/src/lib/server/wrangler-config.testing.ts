/**
 * `wrangler.jsonc`, parsed, for the specs that hold this app's code to the config it is
 * deployed with.
 *
 * two of them read it — src/lib/server/api/rate-limit.config.spec.ts, which holds the
 * refusal a caller is given to the bucket that really refused them, and
 * src/lib/server/config/deploy-vars.config.spec.ts, which holds `keep_vars` on. the parser
 * itself is `$lib/jsonc.testing.ts`, shared with the specs that read this package's other
 * config files.
 *
 * `unknown` on the way out, deliberately: each caller narrows to the handful of fields it
 * actually reads, and a shared shape would grow every field either of them ever wants.
 */

import { resolve } from 'node:path';
import { readJsonc } from '$lib/jsonc.testing';

export function readWranglerConfig(): unknown {
	// packages/app/wrangler.jsonc, from packages/app/src/lib/server.
	return readJsonc(resolve(import.meta.dirname, '../../../wrangler.jsonc'));
}
