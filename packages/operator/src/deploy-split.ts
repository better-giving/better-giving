// the seventeen deploy-time values an operator configures a deployment with, and the one command
// that sets one. every instruction a deployment prints or logs is built from here: a refusal's fix
// sentence, a log line's `operatorFix`.
//
// one list, and every value on it is a plain Worker var. a var's value is handed back by the
// account, so the console draws a stored Stripe key and a stored SMTP password in their boxes as
// values and an operator can check what they pasted — which is the one thing they opened the fold
// to do. the console writes them over the Worker's settings endpoint
// (`packages/console/internal/deployment/write.go`), and from a checkout `setCommand` below builds
// the one form that sets one.
//
// what that costs is worth stating rather than hiding: a var is readable by anyone who can open the
// Cloudflare account this deployment lives in. the console runs on the operator's own machine
// against a Cloudflare session they hold and will not open without one, so the reader was already
// the account holder. storing a credential as a secret protected nobody against that reader and
// cost the operator the ability to verify it, because Cloudflare never returns a secret's value.
//
// **it is here rather than beside the readers because both ends need it.** the deployment reads all
// seventeen off `platform.env` and builds the instruction beside each one, and the operator console
// reads the same seventeen back off the Worker — one enumeration, in the leaf package the two
// already share, for the reason ./console/report.ts is here. a second list on the console side
// would be an eighteenth name, a missing name, or a command spelled the other way round, with
// nothing able to see the disagreement. DEPLOY.md's "Configuration values" section is this list
// written for an operator.
//
// nothing that *reads* one of these can tell how it was stored: a var and a secret both arrive on
// `platform.env`, and `packages/app/src/lib/server/config/env.ts` and `.../auth/env.ts` read all
// seventeen the same way. that is exactly why a wrong instruction here is silent — an operator who
// stores a value as a secret holds a working deployment whose console cannot show them what they
// set. so the rule is asserted rather than reviewed:
// `packages/app/src/lib/server/config/deploy-split.spec.ts` checks the command built for every
// name, sweeps both packages' sources and the two operator documents for a literal that spells one
// by hand as a secret, and holds this list to the names the app actually reads — in both
// directions, which is more than a `satisfies` could say, and this leaf can name no env type to
// write one against anyway. `.../config/deploy-vars.config.spec.ts` is the other half:
// `keep_vars` in wrangler.jsonc, without which a plain deploy deletes all seventeen.
//
// `CONSOLE_TOKEN` is on no list here and is not a configuration value: the console mints it for its
// own session and writes it as a Worker secret. ./console/token.ts and
// `packages/app/src/lib/server/console/access.ts` are where that one is argued.

/**
 * the seventeen, in the order the app reads them — `CONFIG_VAR_NAMES` in
 * `packages/app/src/lib/server/config/env.ts`, then `AUTH_VAR_NAMES` in `.../auth/env.ts`.
 *
 * `SMTP_PORT` is on it though its right answer is usually to leave it unset (`SMTP_PORT` in
 * `packages/app/src/lib/server/config/env.ts`).
 *
 * `PAYPAL_CHARITY_RATE_APPROVED` is the one name here holding an answer rather than a credential or
 * an address — whether PayPal has approved this organisation for its charity rate, which is a fact
 * about the account that no PayPal call reports. it is a configuration value like any other and
 * takes no exception from the rule this header states; what it picks between is two tables of
 * published rates that stay constants in the tree, so no rate is ever typed
 * (`packages/app/src/lib/server/payments/fees.ts`).
 */
export const DEPLOY_VARS = [
	'SMTP_HOST',
	'SMTP_PORT',
	'SMTP_USERNAME',
	'SMTP_PASSWORD',
	'MAIL_FROM',
	'TURNSTILE_SITE_KEY',
	'TURNSTILE_SECRET_KEY',
	'STRIPE_SECRET_KEY',
	'STRIPE_PUBLISHABLE_KEY',
	'STRIPE_WEBHOOK_SECRET',
	'PAYPAL_CLIENT_ID',
	'PAYPAL_CLIENT_SECRET',
	'PAYPAL_WEBHOOK_ID',
	'PAYPAL_CHARITY_RATE_APPROVED',
	'BETTER_AUTH_SECRET',
	'BETTER_AUTH_URL',
	'ADMIN_PASSWORD'
] as const;

/** a name this deployment is configured with. */
export type DeployValueName = (typeof DEPLOY_VARS)[number];

/**
 * the command that puts a value in `name` on this deployment, as an operator pastes it.
 *
 * a whole literal and never a fragment, because that is what the surfaces do with it: a refusal
 * prints it inside one marked span.
 *
 * `--var NAME:value` is the flag, so the value is on the line and `<value>` is what says an
 * operator has to replace it. the flag reaches `wrangler deploy` intact because it is the last
 * command in that script's chain, which is also when the value lands: a var arrives with the deploy
 * carrying it and not before.
 *
 * `pnpm run` and never a bare `wrangler` (CLAUDE.md, Permanent contracts): the scripts are
 * forwarded from the repo root, so the operator never changes directory into packages/app and the
 * command resolves the wrangler version this app was tested against. `pnpm run` does not walk up to
 * the workspace root, so from inside a package directory the spelling is `pnpm -w run`, which pnpm
 * itself says when it lists the root's commands.
 */
export function setCommand(name: DeployValueName): string {
	return `pnpm run deploy --var ${name}:<value>`;
}
