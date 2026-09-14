import { z } from 'zod';
import { AMOUNT_TEXT, FORM_CURRENCY, readAmount } from '../forms/amounts';
import { redact } from '../redact';

// what one box of a hand-posted correcting entry may hold, in the one place a server action and a
// browser may both import from.
//
// not under `$lib/server/**`, and it may not be: `src/routes/_app.admin.books.tsx` hands this
// schema to `$lib/admin/use-admin-form.ts`, so it runs in the browser before the screen submits as
// well as on the Worker after — and a component cannot import from `$lib/server/**` at all. that is
// the general rule and `$lib/forms/input-schema.ts` is where it is argued at length; the chart of
// accounts a correction picks from stays under the server tree and reaches the browser as loader
// data rather than as an import.
//
// every refusal lands on a box, the pair rule included: `postCorrection` in
// `$lib/server/ledger/correct.ts` throws on a figure that is not positive and on one account on
// both sides, so both are refused here first, where there is a box to say it under.
//
// the dependency runs server -> shared and never back: the action imports this, and nothing here
// imports from `$lib/server/**`.

/**
 * what the screen writes over each box.
 *
 * held beside the rules so `SAME_ACCOUNT`, the one message here that has to name a box other than
 * its own, names it in the screen's own words; `src/routes/_app.admin.books.tsx` draws from
 * these.
 */
export const CORRECTION_FIELD_LABELS = {
	occurred_on: 'Dated',
	amount: 'Amount',
	out_of: 'Out of',
	into: 'Into',
	note: 'Note'
} as const;

/**
 * what a correction of nothing is told.
 *
 * exported so ./input-schema.spec.ts asserts the sentence rather than a copy of it.
 */
export const ZERO_AMOUNT = 'must not be zero';

/**
 * what a required box left blank is told, in the shape `REQUIRED` in ../forms/input-schema.ts
 * states for every field message: the predicate of the label over it, and never the label.
 */
const REQUIRED = 'required';

/**
 * what a correction with nothing written on it is told.
 *
 * exported so ./input-schema.spec.ts asserts the sentence rather than a copy of it, and stated on
 * the type
 * constructor as well as on the length check: conform strips an empty box to `undefined` before a
 * schema sees it, so a message written only on `.min(1)` is answered with zod's own "expected
 * string, received undefined" — a library sentence in front of an operator whose box is blank.
 */
export const NOTE_MISSING = REQUIRED;

/**
 * how long the note may be.
 *
 * exported so ./input-schema.spec.ts asserts the boundary rather than a number copied out of this
 * file, which is how a cap silently stops being tested when it is raised.
 */
export const MAX_CORRECTION_NOTE = 500;

/**
 * what a body carrying no usable posting id is told.
 *
 * exported so ./input-schema.spec.ts asserts the sentence rather than a copy of it. it names a
 * reload and nothing else, because the box is hidden and filled by the loader: there is no input an
 * operator can correct, and the whole of the repair is a page that mints a fresh id.
 */
export const STALE_PAGE =
	'This page did not submit an id for the correction. Reload it and enter the correction again.';

/**
 * the canonical uuid form, which is what `uuidv7()` writes and the only shape this box takes.
 *
 * checked rather than accepted as any string, because the value is the half of
 * `entry_group_source_idx` that makes a second press a duplicate: an arbitrary string would be
 * filed as a posting id, would collide with nothing, and would leave the pair's grain — a uuidv7
 * minted for the correction — true of every entry but the ones this screen wrote.
 */
const POSTING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** the shape `<input type="date">` submits, and the only one this box takes. */
const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** what a date box holds, or the one sentence saying why it holds nothing. */
export type AccountingDateRead =
	| { readonly at: Date; readonly problem: null }
	| { readonly at: null; readonly problem: string };

/**
 * the accounting date a correction carries, as the instant it is stored at.
 *
 * midnight UTC, and the zone is pinned rather than left to the runtime: a bare day carries none,
 * `new Date('2026-03-31')` is already UTC while `new Date(2026, 2, 31)` is the host's, and the two
 * put a correction dated the last of March in two different accounting periods. the Worker runs in
 * UTC and every other `occurred_at` in this app is an instant, so the day is read as the UTC one.
 *
 * the round trip is what refuses a day the calendar does not have. `Date.UTC` rolls `2026-02-30`
 * forward to the 2nd of March rather than failing, so a correction would land in the wrong month
 * with nothing looking wrong; comparing the parts back is the whole of the check.
 *
 * a discriminated pair rather than a nullable date, so a caller cannot read the day without having
 * answered the refusal — the shape `readAmount` in ../forms/amounts.ts hands back, for the reason
 * stated there. it is read twice for two answers: the check below reads the sentence, and the
 * action reads the instant.
 *
 * one of the two sentences names the value and the other does not, and the split is what each is
 * about. the shape refusal is about the box, which is drawn right above it holding what was typed.
 * the calendar refusal is about a day — one the operator wrote down and the calendar does not have
 * — so the sentence has a subject the screen shows nowhere.
 */
export function readAccountingDate(text: string): AccountingDateRead {
	const match = CALENDAR_DAY.exec(text);
	if (match === null) {
		return { at: null, problem: 'must be a date' };
	}

	const [, year = '', month = '', day = ''] = match;
	const at = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
	if (
		at.getUTCFullYear() !== Number(year) ||
		at.getUTCMonth() !== Number(month) - 1 ||
		at.getUTCDate() !== Number(day)
	) {
		return { at: null, problem: `There is no ${redact(text)} on the calendar.` };
	}
	return { at, problem: null };
}

/**
 * what a correction dated ahead of the day it is posted is told.
 *
 * exported so ./input-schema.spec.ts asserts the sentence rather than a copy of it. it says the
 * date is ahead, and neither the zone nor the day of slack below: both are facts about where the
 * check runs rather than about the entry being posted.
 */
export const FUTURE_DATE = 'must not be in the future';

/**
 * the latest day a correction may be dated, as the instant that day is stored at — tomorrow, UTC.
 *
 * a ceiling rather than "today or earlier", and the day of slack is the whole of the difference.
 * this schema runs in the browser as well as on the Worker, and the two read different clocks: the
 * Worker is UTC and the operator's is their own, which at UTC+14 is a calendar day ahead. a ceiling
 * of the UTC day would have the screen accept a date the action then refuses, which is the one
 * disagreement a schema both sides import exists to rule out.
 *
 * the day costs nothing it is here to catch. backdating is what the accounting date is for — a
 * correction against a closed period is dated in that period — so the only thing a ceiling can
 * refuse is a typo, and a typed year is years out rather than days.
 */
export function latestAccountingDay(): number {
	const now = new Date();
	return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

/**
 * what one account on both sides is told, under the second side.
 *
 * exported so ./input-schema.spec.ts asserts the sentence rather than a copy of it. it names the
 * other box by its label because the predicate is about that box, and the label is the one word
 * the screen has for it.
 */
export const SAME_ACCOUNT = `must differ from ${CORRECTION_FIELD_LABELS.out_of}`;

/** the two boxes `sameAccountRule` reads, which is every box it is about and no other. */
const ACCOUNT_BOXES = ['out_of', 'into'] as const;
type AccountBoxes = Record<(typeof ACCOUNT_BOXES)[number], string>;

/**
 * refuses an entry whose two sides are one account.
 *
 * it posts cleanly and it has to be refused here rather than there: the two lines sum to zero, so
 * `post()` in `$lib/server/ledger/posting.ts` accepts it, and what lands in the books is a balanced
 * entry that moved nothing between two accounts whose balances are unchanged by it.
 *
 * an object-level check rather than a field rule, because the rule reads two siblings and a
 * `.check()` on the key cannot — the arrangement `suggestedAmountsRule` in
 * ../forms/input-schema.ts is under. pushed with an explicit `path`, the issue arrives keyed by
 * `into`, which is one of the two boxes that fixes it and the second one an operator filled in.
 *
 * it runs whenever both sides were read, whatever any other box was refused for, so a collision is
 * marked on the first press beside a blank note rather than after it — zod skips an object check
 * over any aborted field unless the check says when it runs. it does not run where either side
 * itself was refused, so an operator who has chosen neither account is told to choose them rather
 * than told the two they have not chosen are the same. ./input-schema.spec.ts pins all three — the
 * blank pair, the collision, and the collision beside another refusal.
 */
const sameAccountRule = z.superRefine<AccountBoxes>(
	(boxes, ctx) => {
		if (boxes.out_of === boxes.into) {
			ctx.addIssue({ code: 'custom', input: boxes.into, path: ['into'], message: SAME_ACCOUNT });
		}
	},
	{
		when: ({ issues }) =>
			!issues.some((issue) => (ACCOUNT_BOXES as readonly unknown[]).includes(issue.path?.[0]))
	}
);

/**
 * what a correcting entry's boxes hold, each one still as the text a body carried.
 *
 * named for `FORM_FIELD_RULES` in ../forms/input-schema.ts, `CONTACT_FIELD_RULES` and
 * `ORG_FIELD_RULES`, and unexported where those three are not: one screen submits this form and
 * one schema is assembled from these, so a second reader would be one this file does not have.
 */
const CORRECTION_FIELD_RULES = {
	/**
	 * the id this correction is posted under, minted by the page and carried in a hidden box.
	 *
	 * it is a box rather than a value the action mints, and that is the whole of what stops one
	 * correction being posted twice. a press reuses the id the last press was sent under only when
	 * every box holds exactly what that press submitted; any other press takes the fresh id the
	 * page holds (`postingId` in `src/routes/_app.admin.books.tsx`). so a double press, a retry after
	 * a write whose outcome could not be read, and an edit undone back to what was sent all present
	 * the same `(source_type, source_id)` pair, which `entry_group_source_idx` refuses at the
	 * database — the only place it can be refused, because a check-then-insert cannot be made atomic
	 * inside a `batch()` (`$lib/server/ledger/posting.ts`). a correction that differs in any box is a
	 * different correction and a fresh id, and the action compares what the books hold under a
	 * refused id with what was submitted, so a mismatch is never answered as already posted.
	 *
	 * an id off the wire is not trusted to be one this page minted; it is trusted to be a uuid. what
	 * a hostile value could do is post a correction under an id of its choosing, which is a
	 * correction it was already authorised to post — the gate is the session, not this box.
	 */
	source_id: z
		.string({ error: STALE_PAGE })
		.trim()
		.min(1, { error: STALE_PAGE, abort: true })
		.regex(POSTING_ID, { error: STALE_PAGE }),
	/**
	 * the accounting date — business time, which the ledger keeps beside the system time of the
	 * write itself (`entry_group` in `$lib/server/db/schema.ts`). a correction against a period
	 * that has closed is dated in that period, so it is stated rather than defaulted; `post()`
	 * refuses an Invalid Date for the same reason and would do it with no box to blame.
	 *
	 * dated ahead is the one direction that is refused, and `latestAccountingDay` above holds why.
	 */
	occurred_on: z
		.string({ error: REQUIRED })
		.min(1, { error: REQUIRED, abort: true })
		.check((ctx) => {
			const { at, problem } = readAccountingDate(ctx.value);
			if (problem !== null) {
				ctx.issues.push({ code: 'custom', input: ctx.value, message: problem });
				return;
			}
			// after the read and behind its refusal, so a day the calendar does not have is answered
			// once: `Date.UTC` rolls `2026-02-30` into March, and a ceiling asked about it would be
			// asked about a day nobody typed — the arrangement the `amount` box below is under.
			if (at.getTime() > latestAccountingDay()) {
				ctx.issues.push({ code: 'custom', input: ctx.value, message: FUTURE_DATE });
			}
		}),
	/**
	 * the account the money comes out of, as the id its option carries.
	 *
	 * whether that id names a postable account is a question about the seeded chart, which lives
	 * under the server tree — `postableIdFromSubmitted` in `$lib/server/db/accounts.ts` is the door
	 * it goes through, past this. what is here is that a side was chosen at all.
	 */
	out_of: z.string({ error: REQUIRED }).trim().min(1, { error: REQUIRED, abort: true }),
	/** the account the money goes into. the same rule, and the same door past it. */
	into: z.string({ error: REQUIRED }).trim().min(1, { error: REQUIRED, abort: true }),
	/**
	 * the amount a correction moves, which is one figure used on both sides of the entry — which is
	 * what makes the posting balanced by construction rather than by a check.
	 *
	 * `AMOUNT_TEXT` in ../forms/amounts.ts is the rule and its sentence, which is `readAmount` in
	 * that same module read for the message; the action reads the same call for the integer.
	 * the blank check aborts and carries the same sentence as the string check, so a box the request
	 * did not carry at all reads the same as one left empty — the arrangement `amountBound` is
	 * under, one module over.
	 */
	amount: z
		.string({ error: REQUIRED })
		.min(1, { error: REQUIRED, abort: true })
		.pipe(AMOUNT_TEXT)
		.check((ctx) => {
			// `post()` rejects a zero line outright — a zero records nothing and is the shape a
			// mis-computed split produces — so a box holding one is refused here, where there is a
			// box to say it under, rather than there, where the only answer left is a 500.
			//
			// after the pipe, so it never runs on a value the figure rule already refused: the read
			// below returns `null` for one, and `null === 0` would be false anyway, but the order is
			// what keeps the two sentences from arriving together.
			if (readAmount(ctx.value, FORM_CURRENCY).minor === 0) {
				ctx.issues.push({ code: 'custom', input: ctx.value, message: ZERO_AMOUNT });
			}
		}),
	/**
	 * why this correction is being posted, which is required — a correcting entry is the only kind
	 * of entry no record explains, so a blank one is a movement in the books with nothing anywhere
	 * saying what it answers. `entry_group.memo` is nullable, which is a fact about the column
	 * rather than about this box: every other posting has a payment or a donation behind it.
	 */
	note: z
		.string({ error: NOTE_MISSING })
		.trim()
		.min(1, { error: NOTE_MISSING })
		.max(MAX_CORRECTION_NOTE, { error: `must be at most ${MAX_CORRECTION_NOTE} characters` })
};

/**
 * a correcting entry as it is submitted, and as the browser checks it before it is.
 *
 * flat, with no nested object, for the reason `$lib/forms/definition.ts` holds at both ends: a
 * nested name posted against a flat schema is discarded and the form still validates.
 */
export const CORRECTION_INPUT = z.object(CORRECTION_FIELD_RULES).check(sameAccountRule);
