import type { PaymentProvider, Wallet, WalletDomain, WalletStanding } from './provider';
import { WALLETS } from './provider';

// what a caller asks the payment port about the hostnames a deployment wants wallet buttons drawn
// on, and the press that levels them up.
//
// Stripe draws Apple Pay, Google Pay and Link inside the payment element only on a hostname
// registered on the account for them
// (https://docs.stripe.com/payments/payment-methods/pmd-registration), so a site that is not
// registered offers a donor whatever is left and says nothing about the difference. this is the
// module that turns "which of our sites are registered" into something a screen can draw and a
// button can fix.
//
// a module rather than a handful of calls in a caller: what lives here is the part with a decision
// in it — which of the account's registrations is this deployment's site, whether it is actually
// drawing anything, and which of them a press has to touch — and it is here because it is testable
// as a value: the port is an argument, so ./wallet-domains.spec.ts covers every state with no
// network, no account and no platform to stand in for.
//
// it imports no SDK and names no processor. ./provider.ts is the whole of what it knows, which is
// the rule ./sole-importer.spec.ts holds over the tree.
//
// hostnames arrive already bare. deriving them is the caller's — a deployment stores its sites as
// origins, and `hostsOf` in `@better-giving/operator/origins` is what turns those into the argument
// this module takes — so nothing here parses, lowercases, or adds or strips a `www.`. Stripe holds
// one registration per hostname and treats `www.example.org` as its own, so a deployment serving
// both is a deployment that hands both over.
//
// nothing here writes anything down, and nothing here is cached. what the account holds is read
// fresh on every view because it lives on somebody else's account: a copy in a row would be a claim
// about a third party's state that nothing in this deployment could ever be told had changed. the
// edge cache in ../forms/rail-cache.ts is not a precedent for one either — it holds the form config
// a donor's browser asks for, and this is an operator's reading of an account.

/**
 * where one hostname stands on the account, as a screen has to draw it.
 *
 *   unregistered — the account holds nothing for this hostname. the fresh-fork state, and the one
 *                  the setup button belongs to.
 *   registered   — the account holds it. `complete` is whether a donor on that site actually sees
 *                  the wallet buttons; what it is short of is on the two fields under it.
 *
 * no processor id on either arm. the press finds the registration from the hostname on the far side
 * of the port (`registerWalletDomain` in ./provider.ts), so an id has no reader in a browser — and
 * one that travelled there would be a value a form could post back, which is a button acting on
 * whichever registration the request named rather than on this deployment's own site.
 *
 * no `unreadable` arm, because a hostname is not what fails: the account is read once for all of
 * them, so a read that did not land is a state of the whole reading rather than of any one
 * hostname — see `WalletDomainsReading` below.
 */
export type WalletDomainStanding =
	| { readonly host: string; readonly state: 'unregistered' }
	| {
			readonly host: string;
			readonly state: 'registered';
			/**
			 * whether the processor honours this registration at all.
			 *
			 * a hostname registered and switched off draws no wallet whatever its wallets say, which is
			 * the shape that reads as a finished setup: the account holds the site, the buttons are
			 * missing, and nothing on the account says why.
			 */
			readonly drawing: boolean;
			/**
			 * where each drawn wallet stands, as the processor reports it, each carrying the
			 * processor's own sentence about a wallet it is not drawing.
			 *
			 * the sentence is what a screen draws under an inactive wallet, and it is the only thing
			 * either side of this port can say about what to do — what such a wallet is short of is a
			 * requirement on the operator's own domain, settled somewhere this deployment cannot see.
			 * `WalletStanding` in ./provider.ts is where that is argued.
			 */
			readonly wallets: Readonly<Record<Wallet, WalletStanding>>;
			/**
			 * the drawn wallets that are not active, in `WALLETS`' own order.
			 *
			 * the order is that list's rather than the answer's, so the same gap always reads the same
			 * way on the screen.
			 */
			readonly inactiveWallets: readonly Wallet[];
			/** drawing, and every drawn wallet active. the only state that needs no press. */
			readonly complete: boolean;
	  };

/**
 * what the account holds for the hostnames it was asked about.
 *
 * the failing arm is the whole reading rather than one hostname's, because one read of the account
 * answers for all of them: a port that could not answer says nothing about any hostname, and an
 * arm per hostname would be the same sentence repeated once per site.
 *
 * `detail` is the port's own sentence, which names the value to fix. it is a state of this block and
 * never of the page — every other capability goes on rendering.
 */
export type WalletDomainsReading =
	| { readonly state: 'unreadable'; readonly detail: string }
	| { readonly state: 'read'; readonly hosts: readonly WalletDomainStanding[] };

/**
 * what the account holds for each hostname it was asked about, in the order it was asked.
 *
 * never throws and never rejects: every arm of the port answers with a value, and this turns the
 * failing one into a state rather than passing it up. that is what keeps a processor nobody can
 * reach from taking the screen down — the screen it takes down is the screen an operator opened to
 * find out why.
 */
export async function readWalletDomains(
	provider: PaymentProvider,
	hosts: readonly string[]
): Promise<WalletDomainsReading> {
	const registered = await provider.listWalletDomains();
	if (!registered.ok) return { state: 'unreadable', detail: registered.detail };

	return { state: 'read', hosts: hosts.map((host) => standingOf(host, registered.value)) };
}

/**
 * one hostname after the press, and whether the press did anything to it.
 *
 * `detail` is the port's own sentence for a press that failed on this hostname, and null where it
 * did not. one hostname's failure stops no other, so a press over four sites can come back with
 * three levelled and one carrying a reason — which is why the sentence is per hostname rather than
 * on the answer as a whole.
 *
 * `standing` is where the hostname stands now: what the press left behind where it landed, and what
 * was already there where it failed. so a screen redraws from this answer without reading the
 * account again, and a failed hostname still shows what it is rather than going blank.
 */
export type LevelledDomain = {
	readonly standing: WalletDomainStanding;
	/**
	 * whether this press changed anything at the processor for this hostname.
	 *
	 * false covers both "it was already right" and "the press failed", which are told apart by
	 * `detail`. it is compared rather than claimed — what the account held before the press against
	 * what came back — because the arm behind it is a find-or-create and cannot say by itself which
	 * of the two it did.
	 */
	readonly changed: boolean;
	readonly detail: string | null;
};

/**
 * what the press left behind, per hostname it was asked about.
 *
 * `unreadable` is the account read that opens the press rather than any hostname's own failure: the
 * press has to know what was already there before it can say what it changed, so a read that did
 * not land means nothing was attempted at all.
 */
export type WalletDomainsLevelling =
	| { readonly state: 'unreadable'; readonly detail: string }
	| { readonly state: 'levelled'; readonly hosts: readonly LevelledDomain[] };

/**
 * registers every hostname the account does not hold, switches back on the ones it holds and is not
 * honouring, and leaves the rest alone.
 *
 * the press behind the reading above, and safe to press twice by construction: every hostname is
 * levelled to the same finished state whatever it started in, and one already there is not touched.
 *
 * one hostname at a time rather than all at once. a press over an operator's sites is a handful of
 * calls against an account that rate limits, and the ordering is what makes the answer legible: the
 * hostnames come back in the order they were asked about, and one that failed carries its own
 * reason while every hostname after it is still attempted.
 */
export async function levelWalletDomains(
	provider: PaymentProvider,
	hosts: readonly string[]
): Promise<WalletDomainsLevelling> {
	const registered = await provider.listWalletDomains();
	if (!registered.ok) return { state: 'unreadable', detail: registered.detail };

	const levelled: LevelledDomain[] = [];
	for (const host of hosts) {
		const before = standingOf(host, registered.value);

		// a hostname that is registered, switched on and drawing every wallet is left alone. the arm
		// would answer it harmlessly — it is a find-or-create — but it would spend a call per site on
		// every press, and a press that writes nothing is one that can honestly report changing
		// nothing.
		if (before.state === 'registered' && before.complete) {
			levelled.push({ standing: before, changed: false, detail: null });
			continue;
		}

		const pressed = await provider.registerWalletDomain(host);
		if (!pressed.ok) {
			// what was already there rather than nothing, so the row goes on saying where the hostname
			// stands underneath the reason the press did not move it.
			levelled.push({ standing: before, changed: false, detail: pressed.detail });
			continue;
		}

		const after = standing(pressed.value);
		levelled.push({ standing: after, changed: !settled(before, after), detail: null });
	}

	return { state: 'levelled', hosts: levelled };
}

/**
 * whether the press found the hostname exactly as it left it.
 *
 * an unregistered hostname is never that, whatever came back: the account holds something it did
 * not hold before. past that it is the two facts a press can move — whether the processor honours
 * the registration, and where each drawn wallet stands.
 */
function settled(before: WalletDomainStanding, after: WalletDomainStanding): boolean {
	if (before.state !== 'registered' || after.state !== 'registered') return false;

	// the state and never the sentence. Stripe is free to reword what it says about a wallet it is
	// still not drawing, and a press that reported that as a change would tell an operator something
	// moved when nothing did.
	return (
		before.drawing === after.drawing &&
		WALLETS.every((wallet) => before.wallets[wallet].state === after.wallets[wallet].state)
	);
}

/**
 * where one hostname stands among what the account holds.
 *
 * matched on the hostname and on nothing else, because that is the only fact this deployment holds
 * about its own sites. an account may carry a second deployment's registrations, or the same
 * organisation's marketing site, and reporting one of those would be a screen saying a site is set
 * up while the donor on it sees no wallet.
 */
function standingOf(host: string, registered: readonly WalletDomain[]): WalletDomainStanding {
	const found = registered.find((candidate) => candidate.host === host);
	return found ? standing(found) : { host, state: 'unregistered' };
}

/** one registration read as a standing. */
function standing(domain: WalletDomain): WalletDomainStanding {
	const inactiveWallets = WALLETS.filter((wallet) => domain.wallets[wallet].state !== 'active');

	return {
		host: domain.host,
		state: 'registered',
		drawing: domain.enabled,
		wallets: domain.wallets,
		inactiveWallets,
		// both halves, because either alone is a green screen over a site drawing no wallet button.
		// a wallet active on the account that this deployment does not draw is neither counted nor
		// carried — `WALLETS` in ./provider.ts.
		complete: domain.enabled && inactiveWallets.length === 0
	};
}
