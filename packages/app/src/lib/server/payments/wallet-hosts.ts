import { hostsOf } from '@better-giving/operator/origins';
import type { Db } from '../db/client';
import { readSites } from '../sites/queries';

// which hostnames this deployment wants wallet buttons on.
//
// **the list is settled here and is never sent.** a hostname that travelled through a page would be
// a registration made on the operator's own Stripe account against whatever the page said — so it
// is the address the request reached plus the rows this deployment holds, and nothing else can name
// one. the Payments screen reads over it and the site list's save and Register all sites press over
// it (src/routes/_app.admin.payments.tsx, src/routes/_app.admin.forms._index.tsx), which is why it
// is assembled once here: two derivations of "our hostnames" is a screen reporting one set and a
// press acting on another.
//
// the deployment's own address is first and is on no `site` row. the donation page a deployment
// serves is at its own address (AGENTS.md → Product surface), so it is a hostname a donor is shown a
// payment element on whether or not the operator has listed a single site — and it is the one
// hostname nothing an operator unticks can take away.
//
// hostnames and not origins. Stripe registers a hostname
// (https://docs.stripe.com/payments/payment-methods/pmd-registration), the sites are stored as
// origins, and `hostsOf` in `@better-giving/operator/origins` is the one reader that turns those
// into the other.
//
// nothing here reads the account or presses anything; that is ./wallet-domains.ts's.

/** the hostnames this deployment wants wallet buttons on, and which of them is its own address. */
export interface WalletHosts {
	/** the address this request reached, which is the hostname a donor is served a form on. */
	readonly own: string;
	/** the own address first, then the listed sites in the operator's own stored order. */
	readonly hosts: readonly string[];
}

/**
 * every hostname this deployment wants wallet buttons on, in the order a screen draws them.
 *
 * the own address is deduplicated rather than repeated: an operator who has listed the address the
 * deployment answers on has listed one hostname the account holds once, and a second line for it
 * would be a row a press could report as changed while nothing moved.
 *
 * the order is the deployment's and no consumer sorts it. `readSites` returns the operator's own
 * order, and a list re-sorted anywhere reads as the screen having eaten an edit.
 */
export async function walletHosts(db: Db, requestUrl: string): Promise<WalletHosts> {
	const own = new URL(requestUrl).hostname;
	const listed = hostsOf(await readSites(db));
	return { own, hosts: [own, ...listed.filter((host) => host !== own)] };
}
