import type {
	LevelledWalletHost,
	Wallet as WireWallet,
	WalletHostLine
} from '@better-giving/operator/console/payments';
import { hostsOf } from '@better-giving/operator/origins';
import type { Db } from '../db/client';
import type { Wallet } from '../payments/provider';
import type { LevelledDomain, WalletDomainStanding } from '../payments/wallet-domains';
import { readSites } from '../sites/queries';
import type { Agreed, SameNames } from './report';

// which hostnames this deployment wants wallet buttons on, and where a reading of them stands as
// the console draws it.
//
// **the list is settled here and is never sent.** a hostname that travelled through a page would be
// a registration made on the operator's own Stripe account against whatever the page said — so it
// is the address the request reached plus the rows this deployment holds, and nothing else can name
// one. the two routes that use it (`packages/app/src/routes/console.payments.ts` and
// ./console.wallet-domains.ts) read and press over the same list, which is why it is assembled once
// here rather than in each of them: two derivations of "our hostnames" is a screen reporting one
// set and a press acting on another.
//
// the deployment's own address is first and is on no `site` row. the donation page a deployment
// serves is at its own address (CLAUDE.md), so it is a hostname a donor is shown a payment element
// on whether or not the operator has listed a single site — and it is the one hostname nothing an
// operator unticks can take away.
//
// hostnames and not origins. Stripe registers a hostname
// (https://docs.stripe.com/payments/payment-methods/pmd-registration), the sites are stored as
// origins, and `hostsOf` in `@better-giving/operator/origins` is the one reader that turns those
// into the other — the same one the console's binary takes a Turnstile widget's domains from, so
// the wallet registration and the spam widget cover the same names.
//
// nothing here reads the account or presses anything. what the port answers is
// ../payments/wallet-domains.ts's, and this is the half that turns it into what crosses the wire.

/** one wallet vocabulary at both ends of the wire, held the way ./report.ts holds the org's. */
export type WalletWireNames = Agreed<SameNames<Wallet, WireWallet>>;

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

/**
 * one hostname's standing as the console reads it.
 *
 * the four wire standings out of the two the port answers with: a registration the processor is not
 * honouring is `switched_off` whatever its wallets say, because it draws no button either way and a
 * screen reading the wallets first would call it a wallet's problem. `complete` is not recomputed —
 * what counts as a finished hostname is decided in ../payments/wallet-domains.ts, and a second
 * opinion here is one to keep in step.
 */
export function walletHostLine(standing: WalletDomainStanding, own: string): WalletHostLine {
	const isOwn = standing.host === own;
	if (standing.state === 'unregistered') {
		return { host: standing.host, own: isOwn, standing: 'unregistered' };
	}

	const line = { host: standing.host, own: isOwn, wallets: standing.wallets };
	if (!standing.drawing) return { ...line, standing: 'switched_off' };
	return { ...line, standing: standing.complete ? 'drawing' : 'wallet_inactive' };
}

/** one hostname after the press, as the same line plus what the press did to it. */
export function levelledWalletHost(levelled: LevelledDomain, own: string): LevelledWalletHost {
	return {
		line: walletHostLine(levelled.standing, own),
		changed: levelled.changed,
		detail: levelled.detail
	};
}
