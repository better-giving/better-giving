import { readConfigEnv, type ConfigEnv } from '../config/env';
import type { Db } from '../db/client';
import { quickbooksStore } from './connection';
import { failed, type AccountingProvider } from './provider';
import { createQuickbooksProvider } from './quickbooks';

// the one place a deployment's configuration becomes an `AccountingProvider`.
//
// ../payments/factory.ts for the books, and it is here for that module's reason: which variables
// the books cannot be reached without, and what a deployment short of one answers, are one fact and
// are stated once. what is different is the scale — one provider rather than four, and no rail to
// select between them — so this is a function rather than a set.
//
// built per run from the env that run was handed, never a module-scope singleton (CLAUDE.md), and
// the store is built over the `Db` that run built too: an adapter takes a `ConnectionStore` rather
// than a database (./provider.ts argues why), so joining the two is somebody's job and this is
// where it is done. ../../../worker.ts names neither the adapter nor the store, which is what keeps
// ./sole-importer.spec.ts's rule cheap to keep.

/**
 * the variables no call to the books can be made without.
 *
 * the address is one of them, and that is the entry worth arguing. `QUICKBOOKS_PRODUCTION_URL` and
 * `QUICKBOOKS_SANDBOX_URL` in ./quickbooks.ts are what an operator's value is set *from*, never two
 * things this module picks between: nothing in this app reads which deployment it is — rehearsing
 * is a second deployment (CLAUDE.md) — so a default here would be this module deciding that an
 * unset value means a real company's books, and posting a rehearsal's gifts into them. the pair
 * beside it decides which host a token may be spent against anyway, so a deployment short of the
 * address is short of a credential in all but name.
 */
const REQUIRED = [
	'QUICKBOOKS_CLIENT_ID',
	'QUICKBOOKS_CLIENT_SECRET',
	'QUICKBOOKS_API_URL'
] as const satisfies readonly (keyof ConfigEnv)[];

/**
 * the provider this deployment sends its books to.
 *
 * `source` is the raw platform env, narrowed by `readConfigEnv` — the same entry point every other
 * reader of the deploy-time values takes, so a blank value and an unset one mean "absent" here
 * exactly as they do everywhere else.
 *
 * every path returns a provider; none throws and none returns null, so a caller's error handling is
 * `if (!result.ok)` and nothing else.
 */
export function createAccountingProvider(source: unknown, db: Db): AccountingProvider {
	const env = readConfigEnv(source);
	const clientId = env.QUICKBOOKS_CLIENT_ID;
	const clientSecret = env.QUICKBOOKS_CLIENT_SECRET;
	const apiBaseUrl = env.QUICKBOOKS_API_URL;
	if (clientId === undefined || clientSecret === undefined || apiBaseUrl === undefined) {
		return unconfigured(REQUIRED.filter((name) => env[name] === undefined));
	}
	return createQuickbooksProvider({ clientId, clientSecret, apiBaseUrl }, quickbooksStore(db));
}

/**
 * what every arm answers on a deployment that cannot reach Intuit at all.
 *
 * `not_connected` rather than a reason of its own, and it is the same answer a deployment whose
 * boxes are full but whose company nobody has connected gives. that is not a conflation: both are
 * "there are no books to send to yet", both are a person's to fix on the console, and ./deliver.ts
 * reads the reason to decide that the whole backlog is behind it — so the run ends with no row
 * marked and no email sent. a deployment that will never connect QuickBooks is the common case, and
 * a delivery that mailed about it every minute would be this app reporting a deliberate absence as
 * an outage.
 */
function unconfigured(unset: readonly (keyof ConfigEnv)[]): AccountingProvider {
	const one = unset.length === 1;
	const refusal = failed(
		'not_connected',
		`This deployment cannot reach QuickBooks: \`${unset.join('` and `')}\` ` +
			`${one ? 'is' : 'are'} not set. Open the console (\`better-giving start\`) and set ` +
			`${one ? 'it' : 'them'} under Sending gifts to QuickBooks.`
	);
	return {
		readCompany: async () => refusal,
		listAccounts: async () => refusal,
		sendGift: async () => refusal,
		sendCorrection: async () => refusal,
		authorizeUrl: async () => refusal,
		exchangeCode: async () => refusal,
		revokeTokens: async () => refusal
	};
}
