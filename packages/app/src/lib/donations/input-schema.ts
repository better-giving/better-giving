import { z } from 'zod';
import {
	bounded,
	CHOOSE_KIND,
	CONTACT_FIELD_RULES,
	CONTACT_KIND,
	REQUIRED
} from '../contacts/input-schema';
import { AMOUNT_TEXT, FORM_CURRENCY, readAmount } from '../forms/amounts';
import {
	FUTURE_DATE,
	latestAccountingDay,
	readAccountingDate,
	ZERO_AMOUNT
} from '../ledger/input-schema';
import { IN_HAND_METHODS } from './methods';

// what one box of a gift entered by hand may hold, in the one place a server action and a browser
// may both import from.
//
// not under `$lib/server/**`, for the reason ../ledger/input-schema.ts is not:
// `src/routes/_app.admin.donations.new.tsx` hands this schema to `$lib/admin/use-admin-form.ts`, so
// it runs in the browser before the confirm opens as well as on the Worker after.
//
// the donor is one region with three arms — searching, a donor attached, creating one — and the
// schema is flat all the same: `donor` names the arm, and every box of the arms not drawn arrives
// empty, because every box a form states must arrive (`$lib/server/conform.ts`). which name a new
// donor's kind requires is `parseContact` in `$lib/server/contacts/contact-input.ts`, run by the
// action beside this; what is here is the half decidable box by box, plus that a donor was given.
//
// the dependency runs server -> shared and never back.

/** what the screen writes over each box that is the gift's rather than the donor's. */
export const GIFT_FIELD_LABELS = {
	donor_search: 'Find the donor',
	amount: 'Amount',
	received_on: 'Received',
	method: 'How it arrived',
	program_id: 'Program',
	source: 'Source',
	send_receipt: 'Send a receipt'
} as const;

/** which arm of the donor region a body was submitted from. */
export const DONOR_ARMS = ['existing', 'new'] as const;
export type DonorArm = (typeof DONOR_ARMS)[number];

/**
 * what a body carrying no usable gift id, or no arm, is told.
 *
 * it names a reload and nothing else: the boxes are hidden and filled by the page, so there is no
 * input an operator can correct.
 */
export const STALE_PAGE =
	'This page did not submit an id for the gift. Reload it and enter the gift again.';

/** what a gift with nobody attached is told, under the search box. */
export const NO_DONOR = REQUIRED;

/** how long the source line may be. */
export const MAX_SOURCE = 200;

/** the canonical uuid form, which is what `uuidv7()` writes and the only shape either id takes. */
const GIFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const giftId = z
	.string({ error: STALE_PAGE })
	.trim()
	.min(1, { error: STALE_PAGE, abort: true })
	.regex(GIFT_ID, { error: STALE_PAGE });

/** the boxes `donorRule` reads. */
type DonorBoxes = {
	readonly donor: DonorArm;
	readonly contact_id: string;
	readonly kind?: string | undefined;
};

/**
 * refuses a gift filed under nobody.
 *
 * on the existing arm the refusal is keyed to the search box rather than to `contact_id`: with
 * nobody picked, `contact_id` is a hidden box, and conform's focus walk stops at the first named
 * element in the error map whether or not it can take focus. on the new arm a kind has to be chosen,
 * which only a hand-built body can fail to do.
 *
 * it runs whenever the arm itself was read, so it is marked on the first press beside every other
 * refusal rather than after them.
 */
const donorRule = z.superRefine<DonorBoxes>(
	(boxes, ctx) => {
		if (boxes.donor === 'existing' && boxes.contact_id === '') {
			ctx.addIssue({ code: 'custom', input: '', path: ['donor_search'], message: NO_DONOR });
		}
		if (boxes.donor === 'new' && boxes.kind === undefined) {
			ctx.addIssue({ code: 'custom', input: '', path: ['kind'], message: CHOOSE_KIND });
		}
	},
	{ when: ({ issues }) => !issues.some((issue) => issue.path?.[0] === 'donor') }
);

/** every box of the form, each still as the text a body carried. */
const GIFT_FIELD_RULES = {
	/**
	 * the gift's id and its payment's, minted by the loader and carried hidden.
	 *
	 * they are what makes a second press of one gift a refusal at the database rather than a second
	 * gift — `recordGiftInHand` in `$lib/server/donations/record-in-hand.ts`.
	 */
	donation_id: giftId,
	payment_id: giftId,
	donor: z.enum(DONOR_ARMS, { error: STALE_PAGE }),
	/** what was typed to find the donor. nothing is written from it; it is where a missing donor is said. */
	donor_search: z.string().default(''),
	/** the donor picked, on the existing arm. whether it names a donor on file is the action's read. */
	contact_id: z.string().trim().default(''),
	/** the new donor's boxes, empty on the other two arms. */
	kind: CONTACT_KIND.optional(),
	first_name: CONTACT_FIELD_RULES.first_name.default(''),
	last_name: CONTACT_FIELD_RULES.last_name.default(''),
	legal_name: CONTACT_FIELD_RULES.legal_name.default(''),
	display_name: CONTACT_FIELD_RULES.display_name.default(''),
	primary_email: CONTACT_FIELD_RULES.primary_email.default(''),
	primary_phone: CONTACT_FIELD_RULES.primary_phone.default(''),
	/** the figure, positive. `AMOUNT_TEXT` is the rule, and the action reads `readAmount` for the integer. */
	amount: z
		.string({ error: REQUIRED })
		.min(1, { error: REQUIRED, abort: true })
		.pipe(AMOUNT_TEXT)
		.check((ctx) => {
			if (readAmount(ctx.value, FORM_CURRENCY).minor === 0) {
				ctx.issues.push({ code: 'custom', input: ctx.value, message: ZERO_AMOUNT });
			}
		}),
	/**
	 * the day the donor gave — business time, freely backdated, and the month the gift counts and
	 * posts in. read as the UTC midnight of that day by `readAccountingDate`, the books' own reader,
	 * so a gift and a correction dated one day land in one period. ahead of tomorrow is refused, for
	 * the reason `latestAccountingDay` states.
	 */
	received_on: z
		.string({ error: REQUIRED })
		.min(1, { error: REQUIRED, abort: true })
		.check((ctx) => {
			const { at, problem } = readAccountingDate(ctx.value);
			if (problem !== null) {
				ctx.issues.push({ code: 'custom', input: ctx.value, message: problem });
				return;
			}
			if (at.getTime() > latestAccountingDay()) {
				ctx.issues.push({ code: 'custom', input: ctx.value, message: FUTURE_DATE });
			}
		}),
	method: z.enum(IN_HAND_METHODS, { error: REQUIRED }),
	/** the cause, or blank for none. whether it names a cause still offered is the action's read. */
	program_id: z.string().trim().default(''),
	/** how the gift came in, in the operator's words — `donation.source`, never `donation.note`. */
	source: bounded(MAX_SOURCE).default(''),
	/** absent when unticked, which is what a checkbox submits. */
	send_receipt: z.boolean().default(false)
};

/**
 * a gift entered by hand as it is submitted, and as the browser checks it before the confirm opens.
 *
 * flat, for the reason `$lib/forms/definition.ts` holds at both ends.
 */
export const GIFT_IN_HAND_INPUT = z.object(GIFT_FIELD_RULES).check(donorRule);
