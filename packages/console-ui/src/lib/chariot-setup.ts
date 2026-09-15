import { z } from 'zod';
import type {
	AddressRead,
	ChariotFacts,
	ChariotFailure,
	ChariotOrganisation,
	ChariotRunRead,
	ChariotSetup,
	ChariotStage,
	NoReport,
	VarsUnwritten
} from '../api/types';
import type { StatedForm } from './use-console-form';

// what one press of ./chariot-section.tsx carries, the rules its three boxes are read against, the
// lines its run is drawn as, and where each way the run can end reports.
//
// **one press, three boxes, and nothing about the Connect or the notifications to type.** the binary
// finds the organisation by the EIN the deployment's profile holds, fetches or makes its Connect,
// settles the subscription at this deployment's address and writes the four values in one write
// (`packages/console/internal/chariot/setup.go`), so neither the Connect id nor the signing secret
// has a box.
//
// a module beside the section rather than expressions inside it, for ./paypal-setup.ts's reason:
// ../../vite.config.ts pins one node pool and no dom, so this is the part a suite here can hold.

/** what the press posts, which is the submitting button's own value. */
export const CHARIOT_SETUP_INTENT = 'chariot:set-up';

/**
 * where live Chariot answers, and what the address box holds where the deployment stores none.
 *
 * `API` in packages/console/internal/chariot/chariot.go: the binary stores this address as no value
 * at all, so a deployment on live reads back empty and the box is drawn with it rather than blank.
 */
export const CHARIOT_LIVE = 'https://api.givechariot.com';

/** the three boxes, in the order the screen draws them. */
export const CHARIOT_BOXES = ['apiKey', 'address', 'contactEmail'] as const;

export type ChariotBox = (typeof CHARIOT_BOXES)[number];

/** what the three boxes hold. */
export type ChariotBoxes = Readonly<Record<ChariotBox, string>>;

/** the field one box is posted under. */
export const CHARIOT_FIELD = <B extends ChariotBox>(box: B): `chariot:${B}` => `chariot:${box}`;

/** what a box left empty says under it. */
export const CHARIOT_BLANK = 'required';

/** what an address box holding something other than an address says under it. */
export const CHARIOT_NOT_ADDRESS = 'an https:// address with nothing after the domain';

/** what an email box holding something other than one address says under it. */
export const CHARIOT_NOT_EMAIL = 'one email address';

/**
 * whether a typed address is one the binary calls, already trimmed.
 *
 * `Address` in packages/console/internal/chariot/chariot.go, read the same way: one trailing slash
 * is dropped, and what is left is an https origin and nothing more.
 */
export function isChariotAddress(typed: string): boolean {
	const bare = typed.endsWith('/') ? typed.slice(0, -1) : typed;
	// no path, query, fragment or user in front of the host: any of them is past the origin.
	return /^https:\/\/[^/?#@\s]+$/.test(bare) && URL.canParse(bare);
}

const email = z.email(CHARIOT_NOT_EMAIL);

/*
 * the message sits on each type because conform hands an empty box over as `undefined`, and the trim
 * is the repair the binary would otherwise refuse the press for (`filled` in
 * packages/console/internal/server/chariot.go). an emptied address is live, which is what the binary
 * reads it as.
 */
const chariotBoxes = z.object({
	[CHARIOT_FIELD('apiKey')]: z.string(CHARIOT_BLANK).trim().min(1, CHARIOT_BLANK),
	[CHARIOT_FIELD('address')]: z
		.string()
		.trim()
		.optional()
		.refine(
			(typed) => typed === undefined || typed === '' || isChariotAddress(typed),
			CHARIOT_NOT_ADDRESS
		),
	[CHARIOT_FIELD('contactEmail')]: z.string(CHARIOT_BLANK).trim().min(1, CHARIOT_BLANK).pipe(email)
});

/**
 * the section's form: its id and the rules its press runs first.
 *
 * **every box, every press.** the key is a var the account hands back and the box is seeded with it
 * (./held-values.ts), so pressing again over the seeds is the repair — the Connect fetched again, the
 * subscription here replaced with a new one.
 */
export const CHARIOT_FORM: StatedForm<typeof chariotBoxes> = {
	id: 'chariot',
	schema: chariotBoxes
};

/**
 * the boxes a press posted, read by the same rules the boxes were, or the boxes it refuses by field.
 *
 * the route's reading of the body, so a press that reaches the action without the form's own pass
 * sends the binary nothing it would turn down.
 */
export function chariotPosted(
	posted: FormData
):
	| { readonly ok: true; readonly boxes: ChariotBoxes }
	| { readonly ok: false; readonly errors: Record<string, string> } {
	const read = (box: ChariotBox) => {
		const value = posted.get(CHARIOT_FIELD(box));
		return typeof value === 'string' ? value.trim() : '';
	};
	const boxes: ChariotBoxes = {
		apiKey: read('apiKey'),
		address: read('address'),
		contactEmail: read('contactEmail')
	};
	const errors: Record<string, string> = {};
	if (boxes.apiKey === '') errors[CHARIOT_FIELD('apiKey')] = CHARIOT_BLANK;
	if (boxes.address !== '' && !isChariotAddress(boxes.address)) {
		errors[CHARIOT_FIELD('address')] = CHARIOT_NOT_ADDRESS;
	}
	if (boxes.contactEmail === '') errors[CHARIOT_FIELD('contactEmail')] = CHARIOT_BLANK;
	else if (!email.safeParse(boxes.contactEmail).success) {
		errors[CHARIOT_FIELD('contactEmail')] = CHARIOT_NOT_EMAIL;
	}
	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return { ok: true, boxes };
}

/**
 * the five things one press establishes, one per stage and in the chain's order.
 *
 * **a line's label is its subject and never the step it is in**, which is ./stripe-run-lines.tsx's
 * rule. `note` is what the line says before the chain has found anything out about its subject;
 * ./chariot-section.tsx draws what it found in its place.
 */
export const LINES: readonly { stage: ChariotStage; label: string; note: string }[] = [
	{
		stage: 'checking',
		label: 'Checking your key',
		note: 'Chariot is asked whether the key answers at this address.'
	},
	{
		stage: 'finding',
		label: 'Finding your organisation',
		note: 'Looked up in Chariot’s directory by the EIN in Organisation.'
	},
	{
		stage: 'connecting',
		label: 'Connecting your organisation',
		note: 'A donor’s fund gift is made through your organisation’s Connect.'
	},
	{
		stage: 'subscribing',
		label: 'Setting up notifications',
		note: 'How Chariot tells this deployment that a grant has been made.'
	},
	{
		stage: 'storing',
		label: 'Saving to your deployment',
		note: 'The key, the Connect and the notification secret go onto your deployment together.'
	}
];

/** where a line stands in the chain, read off {@link LINES} rather than stated a second time. */
export const lineAt = (stage: ChariotStage): number =>
	LINES.findIndex((line) => line.stage === stage);

/**
 * which of Chariot's failures a sentence is owed for, whatever step met it.
 *
 * `refused`, `forbidden` and `unreachable` each have a way out of their own — the boxes, Chariot, and
 * trying again. `rejected` and `unreadable` have none this screen can name, so they are said as the
 * step not happening with Chariot's own words underneath.
 */
export type FailureSays = 'refused' | 'forbidden' | 'unreachable' | 'chariot';

export const failureSays = (failure: ChariotFailure): FailureSays =>
	failure.kind === 'rejected' || failure.kind === 'unreadable' ? 'chariot' : failure.kind;

/** the call a failure stopped, named for the sentence that says it did not happen. */
export type FailedCall = 'check' | 'search' | 'connect' | 'list' | 'subscribe';

/**
 * how a stopped or landed run reads, per outcome, with what the facts add to it.
 *
 * the section draws each arm; what is decided here is which arm, which is where the operator is
 * sent and whether the boxes are the thing at fault.
 */
export type ChariotStop =
	/** every step landed. `waiting` is a Connect Chariot will not process grants on yet. */
	| { readonly kind: 'landed'; readonly waiting: boolean }
	/** the key did not answer at the address: said at the boxes, with no ledger. */
	| { readonly kind: 'key' }
	| { readonly kind: 'failure'; readonly call: FailedCall; readonly failure: ChariotFailure }
	| { readonly kind: 'unprofiled'; readonly read: NoReport }
	| { readonly kind: 'no-ein' }
	| { readonly kind: 'unlisted'; readonly ein: string }
	| { readonly kind: 'ambiguous'; readonly candidates: readonly ChariotOrganisation[] }
	/** `name` is the organisation the facts found, or `null` where they carry none. */
	| { readonly kind: 'ineligible'; readonly name: string | null }
	| { readonly kind: 'nowhere'; readonly address: AddressRead }
	| { readonly kind: 'insecure'; readonly origin: string }
	| { readonly kind: 'unstored'; readonly written: VarsUnwritten }
	| { readonly kind: 'unretired' }
	| { readonly kind: 'console-stopped' };

export function chariotStop(outcome: ChariotSetup, facts: ChariotFacts): ChariotStop {
	switch (outcome.kind) {
		case 'done':
			return { kind: 'landed', waiting: facts.connect?.active === false };
		case 'unauthorized':
			return outcome.failure.kind === 'refused'
				? { kind: 'key' }
				: { kind: 'failure', call: 'check', failure: outcome.failure };
		case 'unprofiled':
			return { kind: 'unprofiled', read: outcome.read };
		case 'no-ein':
			return { kind: 'no-ein' };
		case 'unsearched':
			return { kind: 'failure', call: 'search', failure: outcome.failure };
		case 'unlisted':
			return { kind: 'unlisted', ein: outcome.ein };
		case 'ambiguous':
			return { kind: 'ambiguous', candidates: outcome.candidates };
		case 'ineligible':
			return { kind: 'ineligible', name: facts.organisation?.name ?? null };
		case 'unconnected':
			return { kind: 'failure', call: 'connect', failure: outcome.failure };
		case 'nowhere':
			return { kind: 'nowhere', address: outcome.address };
		case 'insecure':
			return { kind: 'insecure', origin: outcome.origin };
		case 'unread':
			return { kind: 'failure', call: 'list', failure: outcome.failure };
		case 'unsubscribed':
			return { kind: 'failure', call: 'subscribe', failure: outcome.failure };
		case 'unstored':
			return { kind: 'unstored', written: outcome.written };
		case 'unretired':
			return { kind: 'unretired' };
		case 'console-stopped':
			return { kind: 'console-stopped' };
	}
}

/**
 * whether a run stopped because Chariot would not accept the key at the address.
 *
 * the one stop that is the boxes being wrong rather than the errand going wrong, so it reports at
 * the boxes and draws no ledger.
 */
export const keyTurnedDown = (run: ChariotRunRead | null): boolean =>
	run?.kind === 'ended' && chariotStop(run.outcome, run.facts).kind === 'key';

/**
 * whether a Connect this deployment now holds is one Chariot has not switched on yet.
 *
 * said at the press once the run has landed, since the card that drew the run has gone by then.
 */
export const connectWaiting = (run: ChariotRunRead | null): boolean => {
	if (run?.kind !== 'ended') return false;
	const stop = chariotStop(run.outcome, run.facts);
	return stop.kind === 'landed' && stop.waiting;
};

/**
 * whether a stopped run's ledger stands under the boxes, with no card over it.
 *
 * ./paypal-setup.ts's `reportStands`: a stopped run is the binary's memory and outlives the page, a
 * run still going is the card's, one that landed is said by the button, and a turned-down key is said
 * at the boxes ({@link keyTurnedDown}).
 */
export function reportStands(live: ChariotRunRead | null, cardUp: boolean): boolean {
	if (live === null || cardUp) return false;
	if (live.kind !== 'ended' || live.outcome.kind === 'done') return false;
	return !keyTurnedDown(live);
}

/**
 * the stops a run reaches with the values written: `done`, and `unretired`, which is the write
 * landing with an older subscription left standing.
 */
const STORED: readonly ChariotSetup['kind'][] = ['done', 'unretired'];

/**
 * what the boxes are seeded from, and whether a write has put them back to it.
 *
 * `pairStanding` in ./paypal-setup.ts, over three boxes: what the press sent seeds them from the
 * answer that says it stored them until the reading after it lands.
 */
export function boxesStanding(press: {
	readonly reported: ChariotBoxes;
	readonly sent: ChariotBoxes | null;
	readonly run: ChariotRunRead | null;
	readonly reread: boolean;
}): { readonly seeded: ChariotBoxes; readonly spent: boolean } {
	const { sent, run } = press;
	if (sent === null || run?.kind !== 'ended' || !STORED.includes(run.outcome.kind)) {
		return { seeded: press.reported, spent: press.reread };
	}
	return { seeded: press.reread ? press.reported : sent, spent: true };
}
