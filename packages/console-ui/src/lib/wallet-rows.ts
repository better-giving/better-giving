import type { PaymentsRead, Wallet, WalletHostLine, WalletsLevel } from '../api/types';

// what one wallet's panel on the payments fold is drawn from: which sites it is asked about,
// where each of them stands for that one wallet, and — for the row that has no rail standing of its
// own — what the whole list adds up to.
//
// **it is a module and not an expression in the fold**, for ./wallet-level.ts's reason: this package
// has no DOM pool (../../vite.config.ts), so a reading written inside ./payments-fold.tsx is one
// nothing here can hold — and the readings below are the whole of what decides whether an operator
// is told a wallet is missing from a site. ./wallet-rows.spec.ts is where they are asserted.
//
// **a row here is about one wallet where ../api/types.ts's line is about all of them.** the panel is
// opened off one method's own row, so a site held for the account with Apple Pay drawn and
// Google Pay held back is `showing` in one panel and `not_showing` in the next — and a row that
// carried the site's whole standing would say `Some not showing` under a heading naming the one
// wallet the operator came to look at.
//
// nothing here writes a sentence. what each standing is called and what its note says is
// ./payments-fold.tsx's, because those words are read beside the rest of that ledger.

/**
 * where one site stands for one wallet.
 *
 * the four arms are the four ways a donor is or is not offered that button there, and they are not
 * ../api/types.ts's four: `wallet_inactive` is a fact about a site's whole set and says nothing
 * about the one being asked after, so it is `showing` or `not_showing` here depending on which
 * wallet is asking.
 *
 * `switched_off` and `unregistered` stay apart because they are two different things for the one
 * press to do — switch a registration back on, and make one — and both draw no button at all
 * whatever the wallets say.
 */
export type WalletRowStanding = 'showing' | 'not_showing' | 'switched_off' | 'unregistered';

/** one site's row inside one wallet's panel. */
export type WalletRow = {
	readonly host: string;
	/** the address this deployment answers on, which at most one row carries (CLAUDE.md → Product surface). */
	readonly own: boolean;
	readonly standing: WalletRowStanding;
	/**
	 * the processor's own sentence about this wallet on this site, or `null` where it wrote none.
	 *
	 * only a registered site has one: the account holds nothing to say about a wallet on a
	 * site it does not hold, and a site switched off draws every wallet back for one reason
	 * that is the standing itself.
	 */
	readonly detail: string | null;
};

/**
 * the sites every panel is drawn from, or `null` where nothing could be.
 *
 * **the press's own answer stands in front of the reading and never beside it.** a press answers
 * with where every site stands now (`LevelledWalletHost` in ../api/types.ts), so a registration
 * that landed shows as landed without the page being read again — and the two are the same
 * sites, so a panel drawing both would draw each row twice.
 *
 * `null` is the account read that could not be made, which draws no panel anywhere: it is the same
 * one read of the same account the rails come through, and ./payments-fold.tsx says so once.
 */
export function walletHostLines(
	wallets: WalletsLevel | null,
	read: PaymentsRead
): readonly WalletHostLine[] | null {
	if (wallets?.kind === 'reported' && wallets.report.state === 'levelled') {
		return wallets.report.hosts.map((host) => host.line);
	}
	const reading = read.kind === 'read' ? read.report.wallets : null;
	if (reading === null || reading.state === 'unreadable') return null;
	return reading.hosts;
}

/** where one site stands for one wallet, off the line that reports all three. */
export function walletRow(line: WalletHostLine, wallet: Wallet): WalletRow {
	if (line.standing === 'unregistered') {
		return { host: line.host, own: line.own, standing: 'unregistered', detail: null };
	}
	if (line.standing === 'switched_off') {
		return { host: line.host, own: line.own, standing: 'switched_off', detail: null };
	}
	const said = line.wallets[wallet];
	return {
		host: line.host,
		own: line.own,
		standing: said.state === 'active' ? 'showing' : 'not_showing',
		detail: said.detail
	};
}

/**
 * one wallet's whole panel, in the order the deployment asked about them.
 *
 * nothing here sorts: the lines arrive with the deployment's own address first and the operator's
 * sites in their stored order (`WalletHostLine` in ../api/types.ts), and a panel that re-ordered
 * them would put the same sites in a different place in each of the three.
 */
export function walletRows(lines: readonly WalletHostLine[], wallet: Wallet): readonly WalletRow[] {
	return lines.map((line) => walletRow(line, wallet));
}

/**
 * whether a wallet is drawn on every site this deployment wants buttons on.
 *
 * it is what gives the Link row its word and its tone, because Link is no rail this form offers and
 * has no approval on the account to read one off (`PAYMENT_METHODS` in
 * `packages/form/src/v1.ts`) — so what its row states is the same thing its own panel states, said
 * once.
 *
 * **no sites at all is `not_everywhere` and never `everywhere`.** `every` over an empty list is
 * true, so a deployment the account was asked nothing about would read as one drawing Link
 * everywhere — a tick over an empty panel, which is the one answer here that is not merely wrong
 * but the opposite of what is true.
 */
export type LinkStanding = 'everywhere' | 'not_everywhere';

export function linkStanding(rows: readonly WalletRow[]): LinkStanding {
	if (rows.length === 0) return 'not_everywhere';
	return rows.every((row) => row.standing === 'showing') ? 'everywhere' : 'not_everywhere';
}
