import type { WidgetLevel } from '../api/types';

// what a site-list save has to say about the half of it that did not reach a screen.
//
// **saving the list is two writes and both of them are reported.** the list goes onto the
// deployment, and cloudflare's copy of the hostnames — the one the spam protection checks a donor's
// page against — is brought level with it behind that (`packages/console/internal/widget`). a fold
// drawing the first alone would leave every way the levelling did not happen landing nowhere: the
// operator adds a site, the fold says saved, and a donor on that site meets a challenge issued for
// a host the widget does not list.
//
// **it is a module and not an expression in the fold, so that the covering is a case rather than a
// reading.** every arm of `WidgetLevel` that is not level has somewhere to go and a different way
// out, and this package has no DOM pool (../../vite.config.ts) — a sentence written inside
// ./sites-fold.tsx is one nothing here can hold. ./widget-level.spec.ts is what asserts that no arm
// says nothing, and tsc holds the covering itself: the switch below is exhaustive, so a kind added
// to `WidgetLevel` is a compile error rather than a state that silently draws nothing.
//
// **nothing here is a claim about a donor passing a challenge.** what is reported is what this
// console read and wrote, which is the rule `packages/console/internal/widget` states and this
// keeps: a levelling that could not be made says it could not be made, and never that the form is
// broken.

/** what to say about a levelling that did not happen, and cloudflare's own words where it has any. */
export type WidgetTrouble = {
	/** why the two lists are not level, and what the operator does about it. */
	readonly said: string;
	/** cloudflare's own words about it, or `null` where there are none to quote. */
	readonly detail: string | null;
};

/**
 * what the fold says over every arm of a levelling, drawn once.
 *
 * it names the consequence rather than the mechanism: an operator on this fold has just pressed
 * Save sites and is not thinking about a widget. the clause about a site just added is what keeps
 * it true of a press that only dropped one — a widget still covering a host nothing is served on
 * costs nothing, which is why the write goes in that order (`packages/console/internal/widget`).
 *
 * **it carries no "your sites were saved" of its own.** that sentence is shared with the wallet
 * levelling this same press also reports (./wallet-level.ts), so ./sites-fold.tsx draws it once,
 * ahead of whichever of the two outcomes has something to say, rather than each repeating it.
 */
export const WIDGET_LEAD =
	'The spam protection’s own list of sites was not brought level with them, so a donation form on a site you have just added turns every donor away until it is.';

/**
 * what one levelling left to say, or nothing where it left nothing.
 *
 * the three silent arms are silent for three different reasons and none of them is an omission.
 * `level` and `levelled` are the two that end with the two lists the same, which the button's own
 * confirmation already reports. `unasked` is a save the deployment turned down, so the sites it
 * serves did not change and there was nothing to level — and what the press did is already being
 * reported by `SitesOutcome` in ./sites-fold.tsx. `nothing` is a stored list with no host in it: a
 * widget covering none challenges nobody, so there is no state to repair.
 */
export function widgetTrouble(level: WidgetLevel): WidgetTrouble | null {
	switch (level.kind) {
		case 'level':
		case 'levelled':
		case 'unasked':
		case 'nothing':
			return null;

		case 'no-widget':
			return {
				said: 'No spam protection widget in this account carries this deployment’s name, so there was nothing to bring level. Look for it at dash.cloudflare.com under Turnstile.',
				detail: null
			};

		// worded as ../routes/_index.tsx words the same finding for a first deploy: two folds wording
		// one fact differently is what sends two operators to two different places out of it.
		case 'many':
			return {
				said: 'Two or more widgets in this account carry this deployment’s name, so this console won’t guess which of them is its own. Delete the one that isn’t this deployment’s at dash.cloudflare.com under Turnstile, then save again.',
				detail: null
			};

		case 'unread':
			return {
				// `read` is written on this kind alone and on every answer that carries it, so a
				// levelling arriving without one is a binary answering in a shape nothing here was
				// written against — which is the sentence a cloudflare that said nothing gets.
				said:
					level.read === null
						? 'Cloudflare didn’t answer, so this account’s widgets couldn’t be read. Check this machine’s connection, then save again.'
						: level.read.kind === 'refused'
							? 'Cloudflare won’t tell this sign-in about the widgets in this account. Ask an administrator of that account for administrator access, or switch account.'
							: level.read.kind === 'no-credential'
								? 'This machine isn’t signed in to Cloudflare any more, so the account was never asked. Reload this page to sign in again, then save again.'
								: 'Cloudflare didn’t answer, so this account’s widgets couldn’t be read. Check this machine’s connection, then save again.',
				detail: level.read?.detail ?? null
			};

		case 'refused':
			return {
				said: 'Cloudflare won’t let this sign-in change this account’s widgets. Ask an administrator of that account for administrator access, or switch account.',
				detail: level.detail
			};

		case 'failed':
			return {
				said: 'Cloudflare wouldn’t change the widget’s list of sites.',
				detail: level.detail
			};

		// the request went and nothing came back, so the widget may or may not carry the new list.
		// claiming either would be a reading this console did not take.
		case 'unreachable':
			return {
				said: 'Cloudflare didn’t answer, so it isn’t known whether the widget’s list changed. Check this machine’s connection, then save again.',
				detail: level.detail
			};

		// it carries no detail and may not be given one: the body of a successful widget request is
		// the widget whole, the secret included, so a sentence built out of it would put a credential
		// on the screen (`packages/console/internal/widget`).
		case 'unreadable':
			return {
				said: 'Cloudflare answered about the widget in a shape this console isn’t written against, so it can’t say whether the list changed. Check it at dash.cloudflare.com under Turnstile.',
				detail: null
			};

		default: {
			const unread: never = level.kind;
			return unread;
		}
	}
}
