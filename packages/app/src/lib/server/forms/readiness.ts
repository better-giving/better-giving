import type { FormReadinessLine } from '$lib/forms/readiness';
import type { OrgProfile } from '../db/schema';
import { identityMissing } from '../org/identity';

// what stands between this deployment and a donor giving through one of its forms, as the block
// at the top of the two screens that write a form renders it — the one that makes one and the one
// that publishes one. the forms list writes nothing and carries no block, so it does not call
// this; those two routes are its only callers.
//
// every line is a fact about a row this deployment holds, and that is the whole rule for what may
// join them. whether the deployment can charge a card, send a receipt or turn away a bot is a fact
// about the deployment and not about any record: it is settled on the console at the moment the
// keys are pasted (`packages/console-ui/src/lib/payments-fold.tsx`), and it is not reported here at all.
// a screen that cannot repair a thing has nothing to offer about it but a pointer at the screen
// that can, and the pointer is the half that goes stale.
//
// so the one line is the identity a form has to state while asking, which is a row an operator
// fills in on the console (`packages/console-ui/src/lib/org-fold.tsx`), as the payment keys
// above are. it decides what the line says and never how it is repaired: the line stops at the
// consequence.
//
// **the set-up gate now stands in front of this and the block is what is left behind it.** the
// dashboard is not served while any of the five jobs is unfinished, the organisation's identity
// among them (`../config/readiness.ts`), so a screen reaching this function is a screen on a
// deployment whose identity is already filled in and the block draws nothing. it is kept as the
// deployment's own answer at the point a form is written rather than as the gate's, which is what
// keeps `publishedConfig` in ./published-config.ts and this line agreeing about one row.

/**
 * what this line is called on screen — a fundraiser's word, never the table's.
 *
 * exported so the spec beside this file names the line by the same value the block draws it under
 * rather than by a word of its own.
 */
export const ORG_LABEL = 'Organisation details';

/**
 * the organisation's identity, which is the line this module exists for.
 *
 * `identityMissing` in ../org/identity.ts and never a status word about the row, and the
 * difference is the whole point: a status word answers how far set-up has got, while this line
 * answers whether a form is served at all — `publishedConfig` in ./published-config.ts serves none
 * while either field is blank. so on this screen it is a blocker, and it is answered by the same
 * list of fields the screen holding those boxes puts on them rather than by a status word.
 */
function identityLine(profile: OrgProfile | null): FormReadinessLine {
	const blank = identityMissing(profile);
	if (blank.length === 0) return { label: ORG_LABEL, severity: 'resolved', detail: null };
	return {
		label: ORG_LABEL,
		severity: 'blocker',
		// every blank field named rather than the first, so filling them in is one trip rather than
		// one trip each. the labels are `identityMissing`'s, which are the words put on those boxes —
		// a sentence naming "Tax ID" against a box labelled "EIN" is a scavenger hunt.
		detail:
			'No form is served to anyone until your organisation’s details are filled in. Still ' +
			`blank: ${blank.join(', ')}.`
	};
}

/**
 * what is stopping this deployment's donation forms, or `null` when nothing is.
 *
 * `null` rather than a list of resolved lines, because the block is not rendered at all when
 * everything is done: a panel reporting that nothing is wrong is a panel an operator learns to
 * scroll past, and the screens under it are about forms rather than about configuration. a
 * resolved line does stay in the list while any sibling is unresolved — see `FormReadinessLine`.
 */
export function formsReadiness(profile: OrgProfile | null): FormReadinessLine[] | null {
	const lines: FormReadinessLine[] = [identityLine(profile)];
	return lines.every((line) => line.severity === 'resolved') ? null : lines;
}
