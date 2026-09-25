import { z } from 'zod';
import type { PaypalRunRead, PaypalSetup, PaypalStage } from '../api/types';
import type { StatedForm } from './use-console-form';

// what one press of ./paypal-section.tsx carries, the rules its three boxes are read against, and
// the lines its run is drawn as.
//
// **one press, three boxes, and nothing about the webhook to type.** the pair, and the address it is
// sent to. the binary registers or keeps the listener at this deployment's address and writes the
// pair, the address and that listener's id in one write (`packages/console/internal/paypal/setup.go`),
// so the id has no box and nobody opens PayPal's dashboard for it.
//
// a module beside the section rather than expressions inside it, for ./stripe-press.ts's reason:
// ../../vite.config.ts pins one node pool and no dom, so this is the part a suite here can hold.

/** what the press posts, which is the submitting button's own value. */
export const PAYPAL_SETUP_INTENT = 'paypal:set-up';

/**
 * where live PayPal answers, and what the address box holds where the deployment stores none.
 *
 * the deployment reads an unset `PAYPAL_API_URL` as this address, so a deployment on live reads back
 * empty and the box is drawn with it rather than blank.
 */
export const PAYPAL_LIVE = 'https://api-m.paypal.com';

/** the three names the boxes carry, in the order the screen draws them. */
export const PAYPAL_BOX_NAMES = [
	'PAYPAL_CLIENT_ID',
	'PAYPAL_CLIENT_SECRET',
	'PAYPAL_API_URL'
] as const;

export type PaypalBoxName = (typeof PAYPAL_BOX_NAMES)[number];

/** what the three boxes hold. */
export type PaypalBoxes = Readonly<Record<PaypalBoxName, string>>;

/** the field one box is posted under. */
export const PAYPAL_FIELD = <N extends PaypalBoxName>(name: N): `paypal:${N}` => `paypal:${name}`;

/** what a box left empty says under it. */
export const PAIR_BLANK = 'required';

/** what an address box holding something other than an address says under it. */
export const PAYPAL_NOT_ADDRESS = 'an https:// address with nothing after the domain';

/**
 * whether a typed address is one the binary calls, already trimmed: one trailing slash dropped, and
 * what is left an https origin and nothing more — the reading ./chariot-setup.ts's
 * `isChariotAddress` makes of Chariot's box, held apart because each follows its own binary door.
 */
export function isPaypalAddress(typed: string): boolean {
	const bare = typed.endsWith('/') ? typed.slice(0, -1) : typed;
	// no path, query, fragment or user in front of the host: any of them is past the origin.
	return /^https:\/\/[^/?#@\s]+$/.test(bare) && URL.canParse(bare);
}

/**
 * one half of the pair.
 *
 * the message sits on the type because conform hands an empty box over as `undefined`, and the trim
 * is the repair the binary would otherwise refuse the press for (`filled` in
 * packages/console/internal/server/paypal.go turns down a value with space around it).
 */
const half = z.string(PAIR_BLANK).trim().min(1, PAIR_BLANK);

/* an emptied address is live, which is what the binary reads it as. */
const paypalBoxes = z.object({
	[PAYPAL_FIELD('PAYPAL_CLIENT_ID')]: half,
	[PAYPAL_FIELD('PAYPAL_CLIENT_SECRET')]: half,
	[PAYPAL_FIELD('PAYPAL_API_URL')]: z
		.string()
		.trim()
		.optional()
		.refine(
			(typed) => typed === undefined || typed === '' || isPaypalAddress(typed),
			PAYPAL_NOT_ADDRESS
		)
});

/**
 * the section's form: its id and the rules its press runs first.
 *
 * **both halves, every press.** a stored secret is a var the account hands back and the box is
 * seeded with it (./held-values.ts), so pressing again over the seeds is the repair — the listener
 * found and kept, its subscription brought level — and an emptied box is refused rather than read
 * as taking PayPal off.
 */
export const PAYPAL_FORM: StatedForm<typeof paypalBoxes> = { id: 'paypal', schema: paypalBoxes };

/**
 * the pair a press posted and the address it goes to, read by the same rules the boxes were, or the
 * boxes it refuses by the value's own name.
 *
 * the route's reading of the body, so a press that reaches the action without the form's own pass
 * sends the binary nothing it would turn down. the three travel as one body, and an emptied address
 * goes as an empty string, which the binary reads as live.
 */
export function paypalPairPosted(posted: FormData):
	| {
			readonly ok: true;
			readonly pair: {
				readonly clientId: string;
				readonly secret: string;
				readonly address: string;
			};
	  }
	| { readonly ok: false; readonly errors: Record<string, string> } {
	const read = (name: PaypalBoxName) => {
		const value = posted.get(PAYPAL_FIELD(name));
		return typeof value === 'string' ? value.trim() : '';
	};
	const clientId = read('PAYPAL_CLIENT_ID');
	const secret = read('PAYPAL_CLIENT_SECRET');
	const address = read('PAYPAL_API_URL');
	const errors: Record<string, string> = {};
	if (clientId === '') errors.PAYPAL_CLIENT_ID = PAIR_BLANK;
	if (secret === '') errors.PAYPAL_CLIENT_SECRET = PAIR_BLANK;
	if (address !== '' && !isPaypalAddress(address)) errors.PAYPAL_API_URL = PAYPAL_NOT_ADDRESS;
	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return { ok: true, pair: { clientId, secret, address } };
}

/**
 * the four things one press establishes, one per stage and in the chain's order.
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
	},
	{
		stage: 'repeating',
		label: 'Setting up repeating gifts',
		note: 'PayPal collects a monthly or yearly gift against a billing plan on your account.'
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

/** the stops a run reaches with the pair written, which is every one past `storing`. */
const STORED: readonly PaypalSetup['kind'][] = ['done', 'unrepeating'];

/**
 * what the boxes are seeded from, and whether a write has put them back to it.
 *
 * `storing` is one write and the only one, so the stops past it — `done`, and `unrepeating` after
 * it — are the boxes on the deployment. what the press sent seeds the boxes from that answer until
 * the reading after it lands, which reports the same values — `keysStanding` in
 * ./stripe-press.ts is the same seeding and argues it.
 *
 * a run the press started that has not stored them keeps the boxes holding what was sent,
 * `boxesStanding` in ./chariot-setup.ts's rule and reason.
 */
export function boxesStanding(press: {
	readonly reported: PaypalBoxes;
	readonly sent: PaypalBoxes | null;
	readonly run: PaypalRunRead | null;
	readonly reread: boolean;
}): { readonly seeded: PaypalBoxes; readonly spent: boolean } {
	const { sent, run } = press;
	if (sent === null || run === null) return { seeded: press.reported, spent: press.reread };
	if (run.kind === 'running' || !STORED.includes(run.outcome.kind)) {
		return { seeded: sent, spent: press.reread };
	}
	return { seeded: press.reread ? press.reported : sent, spent: true };
}

/**
 * whether Save is armed over boxes nobody has changed: a run that stopped before the pair was stored,
 * whose repair is the same press over the same boxes. a stop past the write is not — `unrepeating`
 * is finished by the recurring donation block's own press.
 */
export const pairArmed = (run: PaypalRunRead | null): boolean =>
	run?.kind === 'ended' && !STORED.includes(run.outcome.kind);
