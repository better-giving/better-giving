// the deploy-time values an operator configures a deployment with, and the one command that sets
// one. every instruction a deployment prints or logs is built from here: a refusal's fix
// sentence, a log line's `operatorFix`.
//
// one list, and every value on it is an environment variable, set in `.env` (`.env.example` names
// them). no screen writes one (AGENTS.md → Boundaries).
//
// **it is here rather than beside the readers because it is one enumeration.** the deployment reads
// every name below and builds the instruction beside each one, and a second list anywhere would be
// a name too many, a missing name, or a command spelled the other way round, with nothing able to
// see the disagreement. DEPLOY.md's "Configuration values" section is this list written for an
// operator.
//
// the rule is asserted rather than reviewed:
// `packages/app/src/lib/server/config/deploy-split.spec.ts` checks the command built for every
// name, sweeps the sources of `packages/app` and this package and the operator documents beside
// them for a literal that spells one by hand as a secret, and holds this list to the names the app
// actually reads — in both directions, which is more than a `satisfies` could say, and this leaf
// can name no env type to write one against anyway.
//
// QuickBooks put three names on the list: the two keys, for the reason every other processor's
// keys are there, and `QUICKBOOKS_API_URL` beside them for the reason `CHARIOT_API_URL` is —
// which of Intuit's two addresses this deployment talks to is typed, because nothing here reads
// which deployment it is. off the list is the sign-in token the deployment holds for a connected
// company: Intuit rotates that one on every refresh, so the deployment rewrites its own copy, which
// an environment variable cannot be. it is a row instead, and `quickbooksConnection` in
// `packages/app/src/lib/server/db/schema.ts` argues it.

/**
 * every name, in the order the app reads them — `CONFIG_VAR_NAMES` in
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
	'PAYPAL_API_URL',
	'PAYPAL_WEBHOOK_ID',
	'PAYPAL_CHARITY_RATE_APPROVED',
	'CHARIOT_API_KEY',
	'CHARIOT_API_URL',
	'CHARIOT_CONNECT_ID',
	'CHARIOT_WEBHOOK_SECRET',
	'NOWPAYMENTS_API_KEY',
	'NOWPAYMENTS_IPN_SECRET',
	'NOWPAYMENTS_OUTCOME_CURRENCY',
	'QUICKBOOKS_CLIENT_ID',
	'QUICKBOOKS_CLIENT_SECRET',
	'QUICKBOOKS_API_URL',
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
