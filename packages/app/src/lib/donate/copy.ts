import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@better-giving/form/v1';

// every donor-facing word this page states, and the whole of them.
//
// one file, so a wording is changed in one place and a screen cannot come to say two things about
// the same decision. nothing here reads the flow: a sentence that needed a predicate would be that
// predicate held twice, and `connect` in @better-giving/form/connect is where it is already held.
// what the builders below take is a figure or a name, already decided by whoever calls them.
//
// the same screens are drawn by packages/form/src/views.ts for the embedded element, and the words
// there are its own. that duplication is deliberate and bounded: the element's copy is a permanent
// contract on a stranger's page and this page's is not, so promoting the words to a form-package
// entry is a decision to make once, out loud, and not a refactor to slip in — and until it is made,
// a wording changed on one side is not changed on the other. what may not happen is a third copy:
// no sentence a donor reads belongs anywhere else under this directory.

/**
 * what each numbered step is called, in the order a donor is asked.
 *
 * one list for the three things that have to agree about it: the heading a step draws, what the
 * count says, and how many marks a head carries and what each is named for. the order is the
 * machine's own `NUMBERED_STEPS`, because the marks are drawn from `stepButtons` in the order that
 * list is projected in.
 */
export const STEP_HEADINGS = ['Your gift', 'Your details', 'Review'] as const;

/** how many numbered steps a donor is told there are, which is the length of the list above. */
export const STEP_COUNT = STEP_HEADINGS.length;

/** what a head's hidden count says, read only through the heading's description. */
export function stepCount(at: number): string {
	return `Step ${at} of ${STEP_COUNT}`;
}

/**
 * what a mark a donor may press is called.
 *
 * it names the screen and where that screen falls, because a mark is reached by tab from anywhere
 * on the step and a bare number tells a donor arriving on one out of context nothing.
 */
export function stepMark(heading: string, at: number): string {
	return `${heading}, step ${at} of ${STEP_COUNT}`;
}

// ── the amount step ──────────────────────────────────────────────────────────────────────────

export const HOW_OFTEN = 'How often';
export const HOW_MUCH = 'How much';
/** what the free entry is for, on the box itself and as its hidden label. */
export const AMOUNT = 'Amount';
/** the way past the presets, drawn as one of them. */
export const OTHER = 'Other';
export const PROGRAM = 'Program';
export const CONTINUE = 'Continue';

/** the mark the one optional decision on this card carries, so the convention is learnt once. */
export const OPTIONAL = '(optional)';

export const ADD_A_NOTE = 'Add a note ';
export const YOUR_NOTE = 'Your note';
/** two ways out, because the donor may write the note or take back the ask. */
export const NOTE_PROBLEM = 'required, or untick to skip';

export const DEDICATE = 'Dedicate this gift ';
export const TRIBUTE_KIND_LABEL = 'How this gift is dedicated';
export const TRIBUTE_HONOREE_LABEL = 'Who this gift is for';
export const TRIBUTE_HONOREE_PLACEHOLDER = 'Their name';
export const TRIBUTE_HONOREE_PROBLEM = 'required, or untick to skip';

/**
 * the notify press, in the two directions it goes.
 *
 * the same words either way and the sign is the whole of the difference, because what the press
 * does is add the pair or take it away. a minus sign rather than a hyphen: it is the arithmetic
 * glyph the plus is drawn to match.
 */
export const NOTIFY_SHUT = '+ Notify recipient';
export const NOTIFY_OPEN = '− Notify recipient';

export const NOTIFY_NAME_LABEL = 'Name of the person to tell';
export const NOTIFY_NAME_PLACEHOLDER = 'Name';
/** short, because these two sit in half a card each. both ways out are still named. */
export const NOTIFY_NAME_PROBLEM = 'required, or clear the email';
export const NOTIFY_EMAIL_LABEL = 'Email address of the person to tell';
export const NOTIFY_EMAIL_PLACEHOLDER = 'Email';
export const NOTIFY_EMAIL_PROBLEM = 'needs an email address, or clear the name';

/**
 * the bounds a gift is taken between, offered the way a tile is rather than stated the way a row is.
 *
 * `$5.00` here would claim a precision nobody set.
 */
export function amountProblem(offer: (minor: number) => string, min: number, max: number): string {
	return `between ${offer(min)} and ${offer(max)}`;
}

// ── the details step ─────────────────────────────────────────────────────────────────────────

export const EMAIL = 'Email';
export const FIRST_NAME = 'First name';
export const LAST_NAME = 'Last name';

/** one sentence for both rules a name can break: an empty box and a box holding a space. */
export const NAME_PROBLEM = 'required';
export const EMAIL_MISSING = 'required for your receipt';
export const EMAIL_MALFORMED = 'not an email address';

export function consentLabel(org: string): string {
	return `Allow ${org} to contact me`;
}

// ── the review step ──────────────────────────────────────────────────────────────────────────

export const PAYMENT_DETAILS = 'Payment details';

/**
 * the one thing a press on the review step can be refused for, in words.
 *
 * it names the decision rather than the box: the fields inside are the provider's, in a frame on
 * its own origin, and a donor who has not picked a rail has nothing to type into yet. stated once
 * because it travels two channels — the sentence on the card, and the live region where the caret
 * cannot land.
 */
export const PAYMENT_PROBLEM = 'required';

/**
 * the words on the fee control, which are also its whole accessible name.
 *
 * the box sits inside a label holding these words, so the name is the label a donor reads rather
 * than a second string kept in step with it. it names the decision rather than the row — the row is
 * called `Processing fee` on every screen past the review step, where the decision has been made
 * and the line is an entry in the account.
 */
export const FEE_TOGGLE_LABEL = 'Cover the processing fee';
export const FEE_ROW_LABEL = 'Processing fee';

export const TOTAL_TODAY = 'Total today';

export function giftRow(frequencyLabel: string): string {
	return `${frequencyLabel} gift`;
}

export function donateLabel(total: string): string {
	return `Donate ${total}`;
}

export function receiptTo(email: string): string {
	return `Receipt to ${email}`;
}

/**
 * what the fee decision does to the money, priced both ways round.
 *
 * neither sentence calls its figure "the fee", and that is the constraint on any rewording: the two
 * figures are different quantities — what covering costs the donor is the gross-up, what declining
 * costs the organisation is the deduction — so one noun over both reads as one price changing when
 * the switch moves, which is the one thing the switch does not do.
 */
export function feeCovered(org: string, added: string, gift: string): string {
	return `You add ${added} so ${org} receives the full ${gift}.`;
}

export function feeDeclinedUnpriced(org: string, gift: string): string {
	return `${org} pays the processing fee out of your ${gift}.`;
}

export function feeDeclined(org: string, fee: string, net: string): string {
	return `${org} pays ${fee} out of your gift and receives ${net}.`;
}

/**
 * the sentence a repeating gift owes the donor, or nothing at all for a one-off.
 *
 * stated on every screen that states a total, which is what the review step needs it for: a monthly
 * donor whose only sight of the figure is the Donate button has been told the amount and not the
 * commitment.
 */
export function recurringNote(figure: string, frequency: string): string {
	if (frequency === 'one_time') return '';
	return `Then ${figure} ${frequency === 'monthly' ? 'monthly' : 'yearly'} until you cancel.`;
}

// ── the takeovers ────────────────────────────────────────────────────────────────────────────

export const CHARGED_TODAY = 'Charged today';
export const TO_BE_CHARGED = 'To be charged';

export function payingBy(method: string): string {
	return `Paying by ${method}`;
}

export const MANDATE_LABEL = 'Payment authorization';

/** the correction screen. */
export const CORRECTION_HEADING = 'The total changed';
export function correctionAside(label: string, now: string, shown: string): string {
	return `${label} It is now ${now}, not ${shown}.`;
}
export function giveLabel(total: string): string {
	return `Give ${total}`;
}
export const CHANGE_METHOD = 'Change payment method';

/** the mandate screen. */
export const MANDATE_HEADING = 'Authorize this payment';
export function authorizeLabel(total: string): string {
	return `Authorize ${total}`;
}
export function mandateNote(org: string, total: string): string {
	return `Pressing this authorizes ${org} to take ${total} from the account you entered.`;
}
export const USE_DIFFERENT_METHOD = 'Use a different payment method';

/**
 * who a donor on a given rail is waiting on, which is three answers rather than six.
 *
 * the wallets are a card presented differently and wait on the same issuer; the two hosted-window
 * rails wait on the processor whose window opened, and there the word a donor read on the button is
 * the honest noun, so it is taken from `PAYMENT_METHOD_LABELS` rather than spelled a second time
 * here. a rail that is absent is a cold return — this page was handed a payment token and nothing
 * else — and it is a reading of its own rather than a missing one: a sentence naming a rail the
 * flow never committed would be naming the wrong one on some of them. it arrives absent rather than
 * null because that is how `State` (@better-giving/form/connect) carries it, which is the one place
 * this page reads a rail from.
 *
 * total over `PaymentMethod`, so a rail added to the vocabulary is a compile error here rather than
 * a donor reading about a bank they never chose.
 */
type Waiting =
	| { readonly kind: 'bank' }
	| { readonly kind: 'issuer' }
	| { readonly kind: 'window'; readonly name: string }
	| { readonly kind: 'unknown' };

function waitingOn(method: PaymentMethod | undefined): Waiting {
	if (method === undefined) return { kind: 'unknown' };
	switch (method) {
		case 'ach':
			return { kind: 'bank' };
		case 'card':
		case 'apple_pay':
		case 'google_pay':
			return { kind: 'issuer' };
		case 'paypal':
		case 'venmo':
			return { kind: 'window', name: PAYMENT_METHOD_LABELS[method] };
	}
}

/**
 * the redirect screen.
 *
 * the body is the same promise on every rail — keep this window open — because it is true wherever
 * the donor was sent, and the heading is not: a donor who pressed PayPal is in a window PayPal
 * opened rather than at a bank, and telling them to continue at one names a place they are not.
 */
export function redirectingHeading(method: PaymentMethod | undefined): string {
	const waiting = waitingOn(method);
	switch (waiting.kind) {
		case 'bank':
			return 'Continue at your bank';
		case 'issuer':
			return 'Continue with your card issuer';
		case 'window':
			return `Continue in ${waiting.name}`;
		case 'unknown':
			return 'Continue with this payment';
	}
}

export function redirectingBody(method: PaymentMethod | undefined): string {
	const keepOpen = 'Keep this window open until you are sent back.';
	const waiting = waitingOn(method);
	switch (waiting.kind) {
		case 'bank':
			return `Your bank is checking this payment. ${keepOpen}`;
		case 'issuer':
			return `Your card issuer is checking this payment. ${keepOpen}`;
		case 'window':
			return `${waiting.name} is checking this payment. ${keepOpen}`;
		case 'unknown':
			return `This payment is being checked. ${keepOpen}`;
	}
}

/**
 * the settling screen.
 *
 * the four-to-five-business-days sentence is the bank rail's alone and may not be said on another:
 * it is true of an ACH debit and of nothing else, and a donor told it about a PayPal gift has been
 * given a date the deployment cannot keep. what every rail's version does say is that the money has
 * not landed yet, which is the whole reason this screen is not the thank-you.
 */
export const PROCESSING_HEADING = 'Your gift is on its way';

export function processingNote(method: PaymentMethod | undefined): string {
	return waitingOn(method).kind === 'bank'
		? 'This transfer has not settled yet.'
		: 'This payment has not settled yet.';
}

export function processingBody(org: string, method: PaymentMethod | undefined): string {
	const told = `${org} has been told your gift is coming.`;
	const waiting = waitingOn(method);
	switch (waiting.kind) {
		case 'bank':
			return `Bank transfers usually take 4 to 5 business days to settle. ${told}`;
		case 'window':
			return `${waiting.name} has your approval and the payment has not finished clearing. ${told}`;
		case 'issuer':
		case 'unknown':
			return `This payment has not finished clearing. ${told}`;
	}
}

/**
 * the ending that claims nothing.
 *
 * weaker than the thank-you on purpose: nothing here knows the charge landed, so nothing here says
 * a receipt is on its way, and the heading is weaker for the same reason — "Thank you" over an
 * outcome nobody read is a completion the donor is entitled to believe.
 */
export const INDETERMINATE_HEADING = 'Still confirming your gift';
export function indeterminateBody(org: string, method: PaymentMethod | undefined): string {
	const rest = `${org} will email you when it goes through. Nothing here will charge you a second time.`;
	const waiting = waitingOn(method);
	switch (waiting.kind) {
		case 'bank':
			return `Your gift has been sent to your bank for confirmation. ${rest}`;
		case 'issuer':
			return `Your gift has been sent to your card issuer for confirmation. ${rest}`;
		case 'window':
			return `Your gift has been sent to ${waiting.name} for confirmation. ${rest}`;
		case 'unknown':
			return `Your gift has been sent for confirmation. ${rest}`;
	}
}
export const INDETERMINATE_ANNOUNCE = 'Your gift has been sent for confirmation.';

/** the microdeposit screens. */
export const VERIFY_HEADING = 'Check your bank account';
export const VERIFY_NOTE = 'Nothing has been charged yet.';
export function verifyBody(org: string): string {
	return `Two small deposits are on their way to your account. They usually arrive in 1 to 2 business days. Enter the amounts using the link in the email from ${org} to finish your gift.`;
}
/**
 * stated as a date, never as a window, and the date is the server's.
 *
 * a donor may read this page days after it was painted, and "within 10 days" names nothing they can
 * check by then.
 */
export function verifyDeadline(date: string): string {
	return `Verify by ${date}. After that this gift is cancelled and you would need to start over.`;
}
export const EXPIRED_HEADING = 'This gift needs to be started again';
export const EXPIRED_BODY =
	'The window for verifying your bank account has closed, so your bank needs the payment details again. Nothing was charged.';
export const START_AGAIN = 'Start again';

/** the thank-you. */
export const SUCCESS_HEADING = 'Thank you';
export function successBody(org: string): string {
	return `A receipt is on its way to your email. ${org} has your gift.`;
}
export const SUCCESS_ANNOUNCE = 'Your gift went through.';
/** the label names its destination, because a bare "back" beside a charged figure reads as undoing it. */
export const BACK_TO_START = 'Back to start';

/** the failure. */
export const FAILED_HEADING = 'This gift was not completed';
export const TRY_AGAIN = 'Try again';

/** the resume, which is the only busy flow that reaches a takeover. */
export const RESUMING_HEADING = 'Finishing your gift';
export const RESUMING_BODY =
	'We are checking what happened with your payment. This takes a moment.';

/**
 * what a busy flow says out loud, and it is not one sentence.
 *
 * the press on the review step spans a mint and a charge, and the two are different news to a donor
 * who cannot see the spinner: one is a form being submitted and the other is money moving.
 */
export const WORKING = 'Working on your gift.';
export function confirming(method: PaymentMethod | undefined): string {
	const waiting = waitingOn(method);
	switch (waiting.kind) {
		case 'bank':
			return 'Confirming your gift with your bank.';
		case 'issuer':
			return 'Confirming your gift with your card issuer.';
		case 'window':
			return `Confirming your gift with ${waiting.name}.`;
		case 'unknown':
			return 'Confirming your gift.';
	}
}

// ── the page ─────────────────────────────────────────────────────────────────────────────────

/**
 * what a donor gets where the address names no form this deployment can draw.
 *
 * a sentence rather than a bare status, because the reader is a person holding a link that did not
 * work rather than an agent reading a body. it names no form id and no deployment: an address that
 * was turned down says nothing back about what would have been accepted.
 */
export const NO_FORM = 'This link does not open a donation form. Check the address you were given.';
