/**
 * `pnpm setup-webhook:<name>` — registers this deployment's payment-notice endpoint on one
 * processor's account, using the keys in `.env` and the address in `BETTER_AUTH_URL`, and prints the
 * one line `.env` takes. needs no running server. what it registers, and why a re-run replaces, is
 * ../src/lib/server/payments/webhook-setup.ts's header.
 *
 * the line is the only thing on stdout, and pnpm adds its own banner there unless run as `pnpm -s`;
 * everything else is on stderr. exit status 1 is a missing value or a refusal, 2 an invocation it
 * does not read.
 */

import { setupWebhook } from '../src/lib/server/payments/webhook-setup.ts';

const result = await setupWebhook(process.argv.slice(2), process.env);
if (result.ok) {
	for (const notice of result.notices) console.error(notice);
	console.log(result.line);
} else {
	console.error(result.message);
	process.exitCode = result.status;
}
