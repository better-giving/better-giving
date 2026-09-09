import { FOLD_LABELS } from '@better-giving/operator/setup-folds';
import type { WalletsLevel } from '../api/types';
import { listed } from './org-form';

// what a site-list save has to say about the wallet buttons on the sites it just stored.
//
// **a site arriving is a site Stripe holds nothing for.** Apple Pay, Google Pay and Link are
// drawn inside the payment element only on a site registered on the account
// (`packages/app/src/lib/server/payments/wallet-domains.ts`), so a site added and saved offers a
// donor whatever is left and says nothing about the difference — which is the failure this module
// exists to put on the screen. the save levels the registrations behind the list it stored
// (../routes/_index.tsx), and every way that levelling did not happen lands here.
//
// **it is a module and not an expression in the fold**, for ./widget-level.ts's reason: this
// package has no DOM pool (../../vite.config.ts), so a sentence written inside ./sites-fold.tsx is
// one nothing here can hold. ./wallet-level.spec.ts asserts that no arm which is drawn says
// nothing, and tsc holds the covering — the switch below is exhaustive.
//
// **nothing here repairs anything, and every arm names the fold where a repair lives.** the press
// stands inside the panel each wallet row opens on the payments fold (./payments-fold.tsx and
// ./wallets-press.ts), which is where the whole reading is: a second control here would be a press
// on a fold that draws none of the sites it acts on. `no_key` is the one arm the press itself
// cannot answer — that fold draws no ledger and no press for it either, so what points there
// instead is the deployment's own sentence, which already names the box the key goes in.

/** what to say about a registration that did not happen, and the deployment's words where it has any. */
export type WalletTrouble = {
	/** why a donor sees no wallet button there, and what the operator does about it. */
	readonly said: string;
	/** the deployment's own sentence about it, or `null` where there is none to quote. */
	readonly detail: string | null;
};

/**
 * the one door out of every arm below, named the same way in each.
 *
 * the press is on another fold and the fold is named rather than pointed at by position: which
 * order the folds stand in is ./home-sections.ts's, so a sentence saying "above" is one that goes
 * wrong when that list is reordered and nothing fails.
 */
const REGISTER = `Open Apple Pay, Google Pay or Link under Donation methods, in ${FOLD_LABELS.payments}, and press Register all sites.`;

/**
 * what the fold says over every arm of a levelling, drawn once.
 *
 * it names the consequence rather than the mechanism: an operator on this fold has just pressed
 * Save sites and is not thinking about an account registration. the clause about a site just added
 * is what keeps it true of a press that only dropped one — a registration held for a site nobody
 * is served on draws nothing and costs nothing.
 *
 * **it carries no "your sites were saved" of its own**, for ./widget-level.ts's reason: the same
 * press reports both levellings, and ./sites-fold.tsx draws that clause once for whichever of them
 * has trouble to report.
 */
export const WALLET_LEAD =
	'Stripe draws Apple Pay, Google Pay and Link only on sites registered on your account, so a donor on a site you have just added is offered none of them until it is registered.';

/**
 * what one levelling left to say, or nothing where it left nothing.
 *
 * the two silent arms are silent for two different reasons and neither is an omission. `null` is a
 * press the deployment turned the list down on, so the sites it serves did not change and there was
 * nothing to level — and what that press did is already being reported by `SitesOutcome` in
 * ./sites-fold.tsx. a levelling where every site ends up drawing is the press working, which
 * the button's own confirmation already reports.
 */
export function walletTrouble(level: WalletsLevel | null): WalletTrouble | null {
	if (level === null) return null;

	switch (level.kind) {
		// nothing came back that says, so what is not known is which sites draw them — never that
		// none does. the press below is what asks again.
		case 'unanswered':
			return {
				said: `This console didn’t hear back whether your sites were registered. ${REGISTER}`,
				detail: null
			};

		case 'reported': {
			const report = level.report;
			// the account read the press opens with, so nothing was attempted on any site. a
			// deployment holding no key yet is not sent to Register: the payments fold draws no
			// ledger and no press for `no_key`, for {@link rails}'s reason in ./payments-fold.tsx, so
			// the deployment's own sentence — which already names the box to paste the key into — is
			// what stands in the press's place.
			if (report.state === 'unreadable') {
				return report.reason === 'no_key'
					? {
							said: 'This deployment holds no Stripe key yet, so nothing was registered.',
							detail: report.detail
						}
					: {
							said: `This deployment couldn’t read your Stripe account, so nothing was registered. ${REGISTER}`,
							detail: report.detail
						};
			}
			const short = report.hosts.filter((host) => host.line.standing !== 'drawing');
			if (short.length === 0) return null;
			return {
				said: `No wallet button is drawn on ${listed(short.map((host) => host.line.host))} yet. ${REGISTER}`,
				// one sentence and not one per site: they are the same account refusing the same
				// press, and a paragraph per site is the same words as many times as there are sites.
				detail: short.find((host) => host.detail !== null)?.detail ?? null
			};
		}

		default: {
			const unread: never = level;
			return unread;
		}
	}
}
