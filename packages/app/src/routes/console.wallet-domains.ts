import type { WalletLevellingReport } from '@better-giving/operator/console/payments';
import { consoleJson, consoleMethodNotAllowed } from '$lib/server/console/surface';
import { levelledWalletHost, walletHosts } from '$lib/server/console/wallet-hosts';
import { createPaymentProvider, stripeUnreadableReason } from '$lib/server/payments/factory';
import { levelWalletDomains } from '$lib/server/payments/wallet-domains';
import { database, platform } from '../context';
import type { Route } from './+types/console.wallet-domains';

// registering this deployment's own address and every site it lists on the processor account, so a
// donor is drawn the wallet buttons.
//
// a mutation and specified as one, on the same surface and behind the same check as the report: the
// check is the `middleware` on ./console.ts and this file makes no decision about who may press —
// see the header there, and $lib/server/console/surface.ts for what this surface owes.
//
// **it is here rather than in the console because only this deployment holds the key.** the call
// goes through the payment port with this deployment's own `STRIPE_SECRET_KEY`, which is
// deploy-time and lives under `$lib/server/**` (CLAUDE.md) — the same asymmetry
// ./console.webhook-repair.ts states.
//
// **it takes no body, and the hostnames are read here rather than posted.** a hostname that
// travelled through a page is a registration made on the operator's own Stripe account against
// whatever the page said: the account is the operator's, the registration is a public claim on a
// domain, and a request naming one would let anything holding a session register a domain this
// deployment has never heard of. so the list is settled by the address this request reached and by
// this deployment's own `site` rows, the same way ./console.webhook-repair.ts settles which endpoint
// it is repairing — $lib/server/console/wallet-hosts.ts assembles it, and ./console.payments.ts
// reads the account over the same list.
//
// **safe to press twice, and it is the port that makes it so.** every hostname is levelled to the
// same finished state whatever it started in, and one already registered, honoured and drawing every
// wallet is not touched at all — `levelWalletDomains` in $lib/server/payments/wallet-domains.ts
// argues both.
//
// **one hostname's failure stops no other.** the answer carries a line per hostname, each with where
// it stands now and, where the press could not move it, the port's own sentence — so a press over
// four sites reports three levelled and one to go rather than a single word covering all of them.
//
// nothing is written down here. what this press changes lives on somebody else's account, so a copy
// in a row would be a claim about a third party's state that nothing in this deployment could ever
// be told had changed.

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	const { env } = context.get(platform);

	const asked = await walletHosts(context.get(database), request.url);
	const levelled = await levelWalletDomains(createPaymentProvider(env), asked.hosts);

	const report: WalletLevellingReport =
		levelled.state === 'unreadable'
			? {
					state: 'unreadable',
					// which of the two ways it failed, off what this deployment holds rather than off the
					// sentence the port wrote — the same fact the reading beside it carries
					// (`packages/operator/src/console/stripe-read.ts`).
					reason: stripeUnreadableReason(env),
					detail: levelled.detail
				}
			: {
					state: 'levelled',
					hosts: levelled.hosts.map((host) => levelledWalletHost(host, asked.own))
				};

	// the read that opens the press is the only failure of the whole request: nothing was attempted,
	// so there is nothing per hostname to report. a hole in the deployment and a processor that would
	// not answer are both 500s rather than 400s, for ./console.webhook-repair.ts's reason — no value a
	// caller could send fixes either. a press that reached the account is a 200 whatever it found
	// there, because what it found is on the lines.
	return consoleJson(report, report.state === 'unreadable' ? 500 : 200);
}

/**
 * the read this address does not answer. which hostnames the account holds is ./console.payments.ts's.
 */
export function loader({ request }: Route.LoaderArgs): Response {
	return consoleMethodNotAllowed(request.method, 'POST');
}
