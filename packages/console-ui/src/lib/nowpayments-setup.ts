import { z } from 'zod';
import type {
	DeployVarName,
	NowpaymentsPress,
	NowpaymentsSaved,
	PaymentsRead,
	RailLine,
	VarsWritten
} from '../api/types';
import { configuredStanding, processorStanding } from './processor-payments';
import type { StatedForm } from './use-console-form';

// what one press of ./nowpayments-section.tsx carries, the rule its three boxes are read against,
// when it asks first, and where each way it is answered reports.
//
// **a save and not a run.** the binary checks the key and the payout currency against NOWPayments
// and writes the three in the request that made the press (`packages/console/internal/server/nowpayments.go`),
// so there is no run to poll and no card reporting one: the answer lands at the button, or at the
// box it is about.
//
// a module beside the section rather than expressions inside it, for ./paypal-setup.ts's reason:
// ../../vite.config.ts pins one node pool and no dom, so this is the part a suite here can hold.

/** what the press posts, which is the submitting button's own value. */
export const NOWPAYMENTS_SAVE_INTENT = 'nowpayments:save';

/** the three boxes, in the order the screen draws them. */
export const NOWPAYMENTS_BOXES = [
	'apiKey',
	'ipnSecret',
	'outcomeCurrency'
] as const satisfies readonly (keyof NowpaymentsPress)[];

export type NowpaymentsBox = (typeof NOWPAYMENTS_BOXES)[number];

/** the value each box is stored under on the deployment. */
export const NOWPAYMENTS_NAME: Readonly<Record<NowpaymentsBox, DeployVarName>> = {
	apiKey: 'NOWPAYMENTS_API_KEY',
	ipnSecret: 'NOWPAYMENTS_IPN_SECRET',
	outcomeCurrency: 'NOWPAYMENTS_OUTCOME_CURRENCY'
};

/** the field one box is posted under. */
export const NOWPAYMENTS_FIELD = <B extends NowpaymentsBox>(box: B): `nowpayments:${B}` =>
	`nowpayments:${box}`;

/** what a box left empty says under it. */
export const NOWPAYMENTS_BLANK = 'required';

/** what the key box says where NOWPayments turned the key down. */
export const KEY_REFUSED = 'Invalid key.';

/** what the currency box says where NOWPayments names no coin by that code. */
export const CURRENCY_UNKNOWN = 'Not a coin NOWPayments offers.';

/*
 * the message sits on the type because conform hands an empty box over as `undefined`. the trim is
 * what makes a box of spaces count as empty here; the value that is sent is trimmed by
 * {@link nowpaymentsPosted}, since the binary refuses one with space around it (`filled` in
 * packages/console/internal/server/nowpayments.go).
 */
const filled = z.string(NOWPAYMENTS_BLANK).trim().min(1, NOWPAYMENTS_BLANK);

const nowpaymentsBoxes = z.object({
	[NOWPAYMENTS_FIELD('apiKey')]: filled,
	[NOWPAYMENTS_FIELD('ipnSecret')]: filled,
	[NOWPAYMENTS_FIELD('outcomeCurrency')]: filled
});

/**
 * the section's form: its id and the one rule its press runs first.
 *
 * **all three, every press.** the binary refuses a press short of any of them, and each is a var the
 * account hands back, so the boxes arrive seeded (./held-values.ts) and pressing again over the seeds
 * is the check made again.
 */
export const NOWPAYMENTS_FORM: StatedForm<typeof nowpaymentsBoxes> = {
	id: 'nowpayments',
	schema: nowpaymentsBoxes
};

/**
 * the boxes a press posted, read by the same rule the boxes were, or the boxes it refuses by field.
 *
 * the route's reading of the body, so a press that reaches the action without the form's own pass
 * sends the binary nothing it would turn down.
 */
export function nowpaymentsPosted(
	posted: FormData
):
	| { readonly ok: true; readonly press: NowpaymentsPress }
	| { readonly ok: false; readonly errors: Record<string, string> } {
	const read = (box: NowpaymentsBox) => {
		const value = posted.get(NOWPAYMENTS_FIELD(box));
		return typeof value === 'string' ? value.trim() : '';
	};
	const press: NowpaymentsPress = {
		apiKey: read('apiKey'),
		ipnSecret: read('ipnSecret'),
		outcomeCurrency: read('outcomeCurrency')
	};
	const errors: Record<string, string> = {};
	for (const box of NOWPAYMENTS_BOXES) {
		if (press[box] === '') errors[NOWPAYMENTS_FIELD(box)] = NOWPAYMENTS_BLANK;
	}
	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return { ok: true, press };
}

/**
 * what one of the form's controls is holding, trimmed as {@link nowpaymentsPosted} trims it, and
 * empty where the form draws no such control.
 *
 * **it reads the value rather than the element**, because the three boxes are not all one element:
 * the payout currency is a `<select>` (./nowpayments-coins.ts) and the two credentials are
 * `<input>`s. narrowed to one of those tags, the other reads as empty and every press it makes is
 * refused as blank.
 */
export function nowpaymentsHeld(control: unknown): string {
	const value = (control as { readonly value?: unknown } | null)?.value;
	return typeof value === 'string' ? value.trim() : '';
}

/** one line of the confirm: a box the press changes, and what it does to what is held there. */
export type NowpaymentsLine = { readonly box: NowpaymentsBox; readonly act: 'Set' | 'Replaced' };

/**
 * the lines a press asks through, or `null` where it goes without asking.
 *
 * **only a replaced key asks.** status reads of a payment are made with the key the deployment holds,
 * so a payment made under the old key stops being read the moment another is stored — and that is
 * the one thing about this press nothing on the page says. a first save takes nothing away, and a
 * changed secret or currency under the same key is the operator's own values changed in place.
 *
 * **a held name is compared against its seed, and a withheld one has none**, so any key typed over a
 * key held in a form nothing can read back replaces it (./held-values.ts).
 */
export function nowpaymentsAsks(
	typed: NowpaymentsPress,
	seeds: Readonly<Record<string, string>>,
	held: ReadonlySet<string>
): readonly NowpaymentsLine[] | null {
	const act = (box: NowpaymentsBox): NowpaymentsLine['act'] | null => {
		const name = NOWPAYMENTS_NAME[box];
		if (!held.has(name)) return 'Set';
		return typed[box] === (seeds[name] ?? '') ? null : 'Replaced';
	};
	if (act('apiKey') !== 'Replaced') return null;
	return NOWPAYMENTS_BOXES.flatMap((box) => {
		const which = act(box);
		return which === null ? [] : [{ box, act: which }];
	});
}

/** what the route hands the section about the last press. */
export type NowpaymentsAnswer = {
	/** the boxes the route's own reading of the body refused, by field, so nothing was sent. */
	readonly refused: Record<string, string> | null;
	/** how the binary answered the press, or `null` where it was never asked. */
	readonly saved: NowpaymentsSaved | null;
};

/** where each part of an answer is drawn. */
export type NowpaymentsStanding = {
	/** the sentence under each box the answer is about, by field. */
	readonly boxes: Record<string, string> | null;
	/** NOWPayments' own words, under the box they are about. */
	readonly said: { readonly box: NowpaymentsBox; readonly detail: string } | null;
	/** NOWPayments' own words where nothing was found out, at the press. */
	readonly unanswered: string | null;
	/** the write, at the press, where the check passed. */
	readonly written: VarsWritten | null;
	/** the write left the three on the deployment. */
	readonly stored: boolean;
};

const BOX_REFUSALS = {
	key_refused: { box: 'apiKey', sentence: KEY_REFUSED },
	currency_unknown: { box: 'outcomeCurrency', sentence: CURRENCY_UNKNOWN }
} as const satisfies Record<string, { box: NowpaymentsBox; sentence: string }>;

/**
 * an answer, cut to where each part of it reports.
 *
 * **a check that names a box reports at that box**, which is what puts the operator back in it and
 * holds the next press until it is edited (./use-console-form.ts). NOWPayments not answering names
 * neither, so it reports at the press.
 */
export function nowpaymentsAnswer(answer: NowpaymentsAnswer): NowpaymentsStanding {
	const { saved } = answer;
	const none: NowpaymentsStanding = {
		boxes: answer.refused,
		said: null,
		unanswered: null,
		written: null,
		stored: false
	};
	if (saved === null) return none;
	switch (saved.kind) {
		case 'written':
			return { ...none, written: saved.written, stored: saved.written.kind === 'set' };
		case 'unanswered':
			return { ...none, unanswered: saved.detail };
		case 'key_refused':
		case 'currency_unknown': {
			const { box, sentence } = BOX_REFUSALS[saved.kind];
			return {
				...none,
				boxes: { [NOWPAYMENTS_FIELD(box)]: sentence },
				said: { box, detail: saved.detail }
			};
		}
	}
}

/**
 * where this form's own press stands, and whether its boxes are closed.
 *
 * **an answer that stored nothing reopens the boxes on the render it lands in**, while the page is
 * still being read again over it: a box closed then is one the focus move to a refused box cannot
 * reach. a stored write keeps them closed until the reading it left behind lands (./reseed.ts), so a
 * box is never typed in over a value about to be put back.
 */
export function nowpaymentsPhase(press: {
	/** this form's own press is the one in flight, both phases of it. */
	readonly own: boolean;
	/** the router has the answer and is reading the page again over it. */
	readonly revalidating: boolean;
	/** a press anywhere on the page is in flight. */
	readonly busy: boolean;
	/** the answer standing says the write landed. */
	readonly stored: boolean;
	/** the reading after that write is on the screen. */
	readonly spent: boolean;
}): { readonly inFlight: boolean; readonly underway: boolean; readonly closed: boolean } {
	const inFlight = press.own && !press.revalidating;
	const underway = inFlight || (press.own && press.stored) || (press.stored && !press.spent);
	return { inFlight, underway, closed: underway || (press.busy && !press.own) };
}

/**
 * the rail lines the page draws: those the deployment read and did not report approved.
 *
 * **an approved rail draws nothing**, because working is the silent default. the deployment reports
 * one `crypto` rail, approved where the account has a coin selected and `not_approved` where it has
 * none (`readAccountChargeability` in packages/app/src/lib/server/payments/nowpayments.ts), and the
 * line it draws carries the deployment's own note on what to do.
 */
export function railsToDraw(read: PaymentsRead | null): readonly RailLine[] {
	const standing = configuredStanding(processorStanding(read, 'nowpayments'));
	if (standing?.rails.state !== 'read') return [];
	return standing.rails.rails.filter((line) => line.standing !== 'approved');
}
