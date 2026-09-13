import { z } from 'zod';
import type { PaypalRunRead, PaypalStage } from '../api/types';
import type { StatedForm } from './use-console-form';

// what one press of ./paypal-section.tsx carries, the rule its two boxes are read against, and the
// lines its run is drawn as.
//
// **one press, two boxes, and nothing about the webhook to type.** the binary registers or keeps the
// listener at this deployment's address and writes the pair and that listener's id in one write
// (`packages/console/internal/paypal/setup.go`), so the id has no box and nobody opens PayPal's
// dashboard for it.
//
// a module beside the section rather than expressions inside it, for ./stripe-press.ts's reason:
// ../../vite.config.ts pins one node pool and no dom, so this is the part a suite here can hold.

/** what the press posts, which is the submitting button's own value. */
export const PAYPAL_SETUP_INTENT = 'paypal:set-up';

/** the two names the boxes carry, in the order the screen draws them. */
export const PAYPAL_PAIR_NAMES = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'] as const;

export type PaypalPairName = (typeof PAYPAL_PAIR_NAMES)[number];

/** what the two boxes hold. */
export type PaypalPairBoxes = Readonly<Record<PaypalPairName, string>>;

/** the field one half of the pair is posted under. */
export const PAIR_FIELD = <N extends PaypalPairName>(name: N): `pair:${N}` => `pair:${name}`;

/** what a box left empty says under it. */
export const PAIR_BLANK = 'required';

/**
 * one half of the pair.
 *
 * the message sits on the type because conform hands an empty box over as `undefined`, and the trim
 * is the repair the binary would otherwise refuse the press for (`filled` in
 * packages/console/internal/server/paypal.go turns down a value with space around it).
 */
const half = z.string(PAIR_BLANK).trim().min(1, PAIR_BLANK);

const pairBoxes = z.object({
	[PAIR_FIELD('PAYPAL_CLIENT_ID')]: half,
	[PAIR_FIELD('PAYPAL_CLIENT_SECRET')]: half
});

/**
 * the section's form: its id and the one rule its press runs first.
 *
 * **both halves, every press.** a stored secret is a var the account hands back and the box is
 * seeded with it (./held-values.ts), so pressing again over the seeds is the repair — the listener
 * found and kept, its subscription brought level — and an emptied box is refused rather than read
 * as taking PayPal off.
 */
export const PAYPAL_FORM: StatedForm<typeof pairBoxes> = { id: 'paypal', schema: pairBoxes };

/**
 * the pair a press posted, read by the same rule the boxes were, or the boxes it refuses.
 *
 * the route's reading of the body, so a press that reaches the action without the form's own pass
 * sends the binary nothing it would turn down.
 */
export function paypalPairPosted(
	posted: FormData
):
	| { readonly ok: true; readonly pair: { readonly clientId: string; readonly secret: string } }
	| { readonly ok: false; readonly errors: Record<string, string> } {
	const read = (name: PaypalPairName) => {
		const value = posted.get(PAIR_FIELD(name));
		return typeof value === 'string' ? value.trim() : '';
	};
	const clientId = read('PAYPAL_CLIENT_ID');
	const secret = read('PAYPAL_CLIENT_SECRET');
	const errors: Record<string, string> = {};
	if (clientId === '') errors.PAYPAL_CLIENT_ID = PAIR_BLANK;
	if (secret === '') errors.PAYPAL_CLIENT_SECRET = PAIR_BLANK;
	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return { ok: true, pair: { clientId, secret } };
}

/**
 * the three things one press establishes, one per stage and in the chain's order.
 *
 * one line per stage, so no line draws steps under it: `StatusLine` folds a single step into its
 * line (packages/operator/src/components/status/StatusLine.jsx). **a line's label is its subject
 * and never the step it is in**, which is ./stripe-run-lines.tsx's rule.
 */
export const LINES: readonly { stage: PaypalStage; label: string; note: string }[] = [
	{
		stage: 'authorizing',
		label: 'Checking your keys',
		note: 'The app they belong to is the one this deployment takes PayPal gifts on.'
	},
	{
		stage: 'registering',
		label: 'Setting up the webhook',
		note: 'How PayPal tells this deployment that a gift has been paid.'
	},
	{
		stage: 'storing',
		label: 'Saving to your deployment',
		note: 'The keys and the webhook go onto your deployment together.'
	}
];

/** where a line stands in the chain, read off {@link LINES} rather than stated a second time. */
export const lineAt = (stage: PaypalStage): number =>
	LINES.findIndex((line) => line.stage === stage);

/**
 * whether a run stopped because PayPal would not accept the pair.
 *
 * the one stop that is the boxes being wrong rather than the errand going wrong, so it reports at
 * the boxes and draws no ledger. PayPal not answering at the key check is not it: the pair may be
 * fine, and that stop keeps its ledger line.
 */
export const pairTurnedDown = (run: PaypalRunRead | null): boolean =>
	run?.kind === 'ended' &&
	run.outcome.kind === 'unauthorized' &&
	run.outcome.failure.kind === 'refused';

/**
 * whether a stopped run's ledger stands under the boxes, with no card over it.
 *
 * a stopped run is the binary's memory and outlives the page (`GET /api/paypal/run` in
 * packages/console/internal/server/paypal.go), so a reload brings it back with no card to draw it
 * in. a run still going is the card's, one that landed is said by the button and the readings, and a
 * turned-down pair is said at the boxes ({@link pairTurnedDown}).
 */
export function reportStands(live: PaypalRunRead | null, cardUp: boolean): boolean {
	if (live === null || cardUp) return false;
	if (live.kind !== 'ended' || live.outcome.kind === 'done') return false;
	return !pairTurnedDown(live);
}

/**
 * the pair the boxes are seeded from, and whether a write has put them back to it.
 *
 * `storing` is the last step and one write, so `done` is the only stop that leaves the pair on the
 * deployment. what the press sent seeds the boxes from that answer until the reading after it
 * lands, which reports the same two values — `keysStanding` in ./stripe-press.ts is the same
 * seeding and argues it.
 */
export function pairStanding(press: {
	readonly reported: PaypalPairBoxes;
	readonly sent: PaypalPairBoxes | null;
	readonly run: PaypalRunRead | null;
	readonly reread: boolean;
}): { readonly seeded: PaypalPairBoxes; readonly spent: boolean } {
	const { sent, run } = press;
	if (sent === null || run?.kind !== 'ended' || run.outcome.kind !== 'done') {
		return { seeded: press.reported, spent: press.reread };
	}
	return { seeded: press.reread ? press.reported : sent, spent: true };
}
