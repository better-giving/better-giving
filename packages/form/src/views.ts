// the card's DOM: built once, then patched from each snapshot.
//
// built once and patched, never re-rendered. every option this form offers is a predicate over a
// configuration that cannot change after boot, so the node set is fixed and only its attributes
// move. re-creating the subtree per snapshot would take the caret out of the field a donor is
// typing in and drop focus on every keystroke, which on a payment screen is not a performance
// question.
//
// the types here are the adapter. ./connect.ts builds plain records and hands them to a
// `normalize` a consumer supplies — so a consumer is that function plus these types, and this is
// the DOM's copy of them. what is deliberately absent from `ButtonProps` is `disabled`: a second
// press is dropped by the flow's shape (`quoting` has no `SUBMIT` handler) and ./connect.spec.ts
// asserts no getter emits the prop at all, so nothing here can set the attribute.
//
// no flow logic. which frequencies exist, which amounts are suggested, whether the fee is being
// covered — every one of those is answered by ./connect.ts and read here. a predicate recomputed
// in this file is the same answer derived twice, on a page nobody here can reach.

import type { CheckoutApi, PropTypes, State } from './connect';
import type { AmountDecision, PayerField } from './value';
import { RECONCILIATION_LABELS, type DeductedFee } from './fee';
import { currencySymbol, formatFigure, formatMinor, formatOffer, parseMinor } from './money';
import { part, partWhen } from './parts';
import { FREQUENCY_LABELS, NO_PROGRAM_LABEL, PAYMENT_METHOD_LABELS, type FormConfig } from './v1';

/** one member of a native radio family, as ./connect.ts states it. */
type Option = {
	readonly value: string | number;
	readonly label?: string;
	readonly checked: boolean;
	readonly onChange: () => void;
};

type GroupProps = {
	readonly name: string;
	readonly options: readonly Option[];
	/**
	 * a figure typed into the group's own entry, where a group has one. `null` is the box emptied
	 * rather than a figure.
	 *
	 * named for the typing rather than for the box, because the box is no longer the alternative to
	 * the options beside it: a press on one of those writes into it too (`build` below), and it does
	 * so without coming through here.
	 */
	readonly onTyped?: (amountMinor: number | null) => void;
};

type FieldProps = {
	readonly name: string;
	readonly type?: string;
	/** the platform's own rule for this field, set as the attribute and read back off `validity`. */
	readonly required?: boolean;
	/** the second half of that rule, where `required` alone would pass on a space. */
	readonly pattern?: string;
	/** the cap the endpoint holds this box to, which the platform enforces as it is typed. */
	readonly maxLength?: number;
	readonly value: string;
	readonly onChange: (value: string) => void;
};

/**
 * a native `<select>` over a closed vocabulary, as ./connect.ts states it.
 *
 * every option carries its words, unlike `Option` above where a frequency's label is optional and
 * an amount tile draws a formatted figure instead. a select has nothing but its words.
 */
type SelectProps = {
	readonly name: string;
	readonly value: string;
	readonly options: readonly { readonly value: string; readonly label: string }[];
	readonly onChange: (value: string) => void;
};

type ButtonProps = {
	readonly 'aria-busy': boolean;
	readonly onClick: () => void;
	readonly totalMinor?: number | null;
	/** what the rail would take out of the gift, for the reading of the fee row that declines it. */
	readonly declinedFee?: DeductedFee | null;
	readonly pressed?: boolean;
	readonly label?: string;
	/** whether the flow would take a press on a mark on the step head. */
	readonly available?: boolean;
};

export type DomApi = CheckoutApi<{
	button: ButtonProps;
	group: GroupProps;
	field: FieldProps;
	select: SelectProps;
}>;

/**
 * the DOM's `normalize`, and it renames nothing.
 *
 * the records ./connect.ts builds are already the shape this file reads, so the adapter is the
 * types above rather than a translation. a framework whose props differ is where the function
 * body does work.
 */
export const domPropTypes: PropTypes<{
	button: ButtonProps;
	group: GroupProps;
	field: FieldProps;
	select: SelectProps;
}> = {
	button: (props) => props as unknown as ButtonProps,
	group: (props) => props as unknown as GroupProps,
	field: (props) => props as unknown as FieldProps,
	select: (props) => props as unknown as SelectProps
};

/**
 * the shape the skeleton is drawn at before the org's own is known.
 *
 * the common form rather than an empty box or the created one, so the reflow when the configuration
 * lands is a change of content and not a change of height. three cadences is the full set a
 * deployment can offer, and six tiles is what a form suggesting the usual five amounts comes out at
 * once the Other tile is counted — two rows on the card and three at 375px, which the real tray's
 * own grid decides from these six as it would from the org's own (`.tiles` in ./styles/layout.css).
 *
 * a form suggesting none draws one box where these six stand and comes out shorter by a row, and
 * that is the trade: the shape is the one most cards land on rather than the one every card can.
 */
export const DEFAULT_SHAPE = { frequencies: 3, amounts: 6 } as const;

type Attributes = Record<string, string | number | boolean | undefined>;

/**
 * appends children, through `appendChild` rather than `append`.
 *
 * `wrangler types` writes a global `interface Element` for HTMLRewriter into
 * `worker-configuration.d.ts`, and TypeScript merges it with the DOM's `Element`. a member
 * declared on an interface hides the one it inherits, so that file's
 * `append(content: string | ReadableStream | Response)` shadows `ParentNode.append` for every DOM
 * element in this project — a variadic call against it does not type-check and never will.
 * `appendChild` is declared on `Node`, which that file does not touch.
 */
export function put(doc: Document, parent: Node, children: readonly (Node | string)[]): void {
	for (const child of children) {
		parent.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
	}
}

function make<K extends keyof HTMLElementTagNameMap>(
	doc: Document,
	tag: K,
	attributes: Attributes = {},
	children: readonly (Node | string)[] = []
): HTMLElementTagNameMap[K] {
	const node = doc.createElement(tag);
	for (const [name, value] of Object.entries(attributes)) {
		if (value === undefined || value === false) continue;
		node.setAttribute(name, value === true ? '' : String(value));
	}
	put(doc, node, children);
	return node;
}

/**
 * the mark a busy control carries, and it never moves the label.
 *
 * out of flow, so appending it costs no width: the label restates the money and a control whose
 * words shift under a donor's cursor at the moment of pressing it is a flinch. it is hidden from
 * the accessibility tree because the words for what is happening are on the card's live region.
 */
function spinner(doc: Document): HTMLElement {
	return make(doc, 'span', { class: 'spinner', 'aria-hidden': 'true' });
}

/** sets an attribute or removes it, so an absent state leaves no empty attribute behind. */
function toggleAttribute(node: Element, name: string, value: string | null): void {
	if (value === null) node.removeAttribute(name);
	else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/** writes a value only when it differs, so the caret does not move under a donor mid-word. */
function setValue(
	field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
	value: string
): void {
	if (field.value !== value) field.value = value;
}

function setText(node: Node, text: string): void {
	if (node.textContent !== text) node.textContent = text;
}

function setHidden(node: HTMLElement, hidden: boolean): void {
	if (node.hidden !== hidden) node.hidden = hidden;
}

/**
 * the four screens the card has, in the order a donor meets them.
 *
 * three of them are the numbered steps and the fourth is every full-card screen there is. the
 * order is what the entry motion reads a direction off (./styles/motion.css), so it is a list
 * rather than a set.
 */
const SCREENS = ['amount', 'details', 'give', 'takeover'] as const;
type Screen = (typeof SCREENS)[number];

/**
 * what each numbered step is called, in the order a donor is asked.
 *
 * one list for the three things that have to agree about it: the heading a step draws, what the
 * count says, and how many marks the head carries and what each of them is named for (`stepHead`
 * below). stated twice, a head added later says "Step 4 of 3" or draws a mark named for a screen
 * that is not the one it moves to, and neither is visible from the other's site.
 *
 * the order is the machine's — `NUMBERED_STEPS` in ./checkout.machine.ts — because the marks are
 * drawn from `stepButtons` (./connect.ts) in the order that list is projected in. the two say the
 * same thing about the same three screens, in the words each layer needs: the flow names states,
 * this names what a donor reads.
 */
const STEP_HEADINGS = ['Your gift', 'Your details', 'Review'] as const;

/**
 * how many numbered steps a donor is told there are, which is the length of the list above.
 *
 * named for the count rather than for the steps: `NUMBERED_STEPS` in ./checkout.machine.ts is the
 * three state names themselves, and one directory holding that name for both a list and its length
 * is a citation that resolves to the wrong thing from whichever file the reader is standing in.
 */
const STEP_COUNT = STEP_HEADINGS.length;

/**
 * what the card is showing.
 *
 * `working` stays where it happened. the flow collapses boot, quoting, quoted, confirming and
 * resuming into one thing a donor is told — something is happening — so the projection cannot say
 * which screen asked, and the last one shown is the answer. without that, the press on the review
 * step drops the donor onto a blank frame for the length of a request that spans two beats.
 *
 * the one exception is a `working` that carries no decided gift at all. `boot` is never observed
 * (its `always` fires before the first snapshot), so that is a resume: a donor back from their
 * bank, on a page that must not show them an empty donation form while it finds out whether they
 * have already paid.
 */
function visibleStep(api: DomApi, last: Screen): Screen {
	const { state } = api;
	if (state.step === 'amount') return 'amount';
	if (state.step === 'details') return 'details';
	if (state.step === 'give') return 'give';
	if (state.step === 'working') return state.fv === undefined ? 'takeover' : last;
	return 'takeover';
}

/**
 * what a busy flow says out loud, and it is not one sentence.
 *
 * the press on the review step spans a mint and a charge, and the two are different news to a
 * donor who cannot see the spinner: one is a form being submitted and the other is money moving.
 * a resume is neither, and keeps the plainer of the two — the words for what it is doing are the
 * takeover's own.
 */
function workingWords(state: State): string {
	return state.step === 'working' && state.phase === 'confirming'
		? 'Confirming your gift with your bank.'
		: 'Working on your gift.';
}

/**
 * the sentence a repeating gift owes the donor, or nothing at all for a one-off.
 *
 * stated on every screen that states a total, which is what the review step needs it for: a
 * monthly donor whose only sight of the figure is the Donate button has been told the amount and
 * not the commitment. it takes the figure it is given rather than reading one, so the sentence and
 * the total above it are the same number by construction.
 */
function recurringNote(
	amountMinor: number,
	frequency: keyof typeof FREQUENCY_LABELS,
	money: (minor: number) => string
): string {
	if (frequency === 'one_time') return '';
	return `Then ${money(amountMinor)} ${frequency === 'monthly' ? 'monthly' : 'yearly'} until you cancel.`;
}

/** what the receipt is saying about the money on a given screen, or that it is not shown. */
type Receipt = 'none' | 'charged' | 'pending';

/**
 * one full-card screen, as data.
 *
 * a descriptor rather than a branch per node. every takeover is the same eight or nine elements
 * with different words in them, so what varies is stated once, in one place a reader can compare
 * screens across — and the patch below is then total over this record rather than a chain of
 * conditions that quietly leaves a node from the last screen on the next one.
 */
type Takeover = {
	readonly heading: string;
	readonly body: string;
	readonly receipt: Receipt;
	/** what the receipt's total is called on this screen. */
	readonly totalLabel: string;
	/** the line inside the receipt block, under the total. */
	readonly receiptNote: string;
	/** the line under the receipt: what the flow is saying about the figure it just stated. */
	readonly aside: string;
	/** the rail this gift is about to go down, echoed back before it is authorized. */
	readonly method: string;
	/** announced through the live region, for the reader who is not looking at the figure. */
	readonly announce: string;
	readonly mandate: string;
	readonly deadline: string;
	readonly failure: string;
	readonly primary: { readonly label: string; readonly submit: boolean } | null;
	/** the line under the primary control, stating what pressing it does. */
	readonly primaryNote: string;
	/** the way out of the screen: beside the primary where there is one, alone where there is not. */
	readonly secondary: { readonly label: string } | null;
};

const BLANK: Takeover = {
	heading: '',
	body: '',
	receipt: 'none',
	totalLabel: '',
	receiptNote: '',
	aside: '',
	method: '',
	announce: '',
	mandate: '',
	deadline: '',
	failure: '',
	primary: null,
	primaryNote: '',
	secondary: null
};

/**
 * a timestamp as a date the donor can act on, degrading the way ./money.ts does.
 *
 * absolute, never relative, and server-supplied for the same reason ledger time is. the donor may
 * read this page days after it was painted, by which point "within 10 days" names nothing they
 * can check.
 */
function formatDate(at: number, locale: string): string {
	try {
		return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(at));
	} catch {
		return new Date(at).toISOString().slice(0, 10);
	}
}

/**
 * every state that takes the whole card, in the words a donor reads.
 *
 * total over the states that reach it, with no arm that falls through to something plausible.
 * `./connect.ts` is what makes an unprojected machine state a `pnpm check` failure; this is what
 * makes a projected one that nobody wrote a screen for the same thing.
 */
function takeoverFor(state: State, config: FormConfig, money: (minor: number) => string): Takeover {
	const org = config.orgLegalName;
	const recurring = (amountMinor: number, frequency: keyof typeof FREQUENCY_LABELS): string =>
		recurringNote(amountMinor, frequency, money);

	switch (state.step) {
		case 'confirm': {
			const { reconciliation: seen } = state;
			// both figures, because a total that moved between what the donor pressed and what
			// authority charges is the one thing this screen exists to say out loud — a silent
			// correction here would be worse than never having estimated.
			const aside = `${RECONCILIATION_LABELS.adjusted} It is now ${money(seen.totalMinor)}, not ${money(seen.shownTotalMinor)}.`;
			return {
				...BLANK,
				// not "Confirm your gift". the donor pressed Donate on the step before this one and
				// believes they have already confirmed; a heading that asked again would read as the
				// form having lost their press rather than as the figure having moved.
				heading: 'The total changed',
				receipt: 'charged',
				totalLabel: 'Charged today',
				receiptNote: recurring(state.quote.totalMinor, state.fv.frequency),
				aside,
				method: PAYMENT_METHOD_LABELS[state.method],
				// always announced. this screen renders only where the figure moved, so its existence
				// is the news and there is no match left for an announcement to teach distrust of.
				announce: aside,
				// a different verb from the press that reached here, and the aside is why: it says
				// "since you pressed Donate", which names a control that has to still be the one on
				// the step behind this screen.
				primary: { label: `Give ${money(state.quote.totalMinor)}`, submit: true },
				// what going back actually offers. the step behind this one is the payment step, and
				// a control naming the amount would send a donor looking for a figure they cannot
				// change there.
				secondary: { label: 'Change payment method' }
			};
		}

		case 'mandate':
			return {
				...BLANK,
				heading: 'Authorize this payment',
				receipt: 'charged',
				totalLabel: 'Charged today',
				receiptNote: recurring(state.quote.totalMinor, state.fv.frequency),
				// the provider's own wording, verbatim. it authorizes a debit, which makes it a legal
				// instrument, and paraphrasing one on the org's behalf is not something this project
				// does.
				mandate: state.quote.mandate?.text ?? '',
				primary: { label: `Authorize ${money(state.quote.totalMinor)}`, submit: true },
				// stated beside the provider's text rather than inside it, so nothing here reads as
				// part of the authorization.
				primaryNote: `Pressing this authorizes ${org} to take ${money(state.quote.totalMinor)} from the account you entered.`,
				secondary: { label: 'Use a different payment method' }
			};

		case 'redirecting':
			return {
				...BLANK,
				heading: 'Continue at your bank',
				body: 'Your bank is checking this payment. Keep this window open until it sends you back.'
			};

		case 'processing':
			return {
				...BLANK,
				heading: 'Your gift is on its way',
				receipt: 'pending',
				totalLabel: 'To be charged',
				receiptNote: 'This transfer has not settled yet.',
				body: `Bank transfers usually take 4 to 5 business days to settle. ${org} has been told your gift is coming.`
			};

		case 'indeterminate':
			// an ending with nothing to press, and the copy claims nothing. the flow is here because
			// a confirmation went unanswered, so the money may already have moved and may not — the
			// webhook settles which (`src/routes/api.stripe.webhook.ts`), and it is what
			// sends the receipt. weaker than `success` below on purpose: nothing here knows the
			// charge landed, so nothing here says a receipt is on its way.
			return {
				...BLANK,
				// and the heading is weaker than `success`'s for the reason the body is. "Thank you"
				// over an outcome nobody read is a completion the donor is entitled to believe, and
				// the only correction they would ever get is an email that may never come.
				heading: 'Still confirming your gift',
				body: `Your gift has been sent to your bank for confirmation. ${org} will email you when it goes through. Nothing here will charge you a second time.`,
				announce: 'Your gift has been sent for confirmation.'
			};

		case 'awaitingVerification':
			return {
				...BLANK,
				heading: 'Check your bank account',
				receipt: 'pending',
				totalLabel: 'To be charged',
				receiptNote: 'Nothing has been charged yet.',
				body: `Two small deposits are on their way to your account. They usually arrive in 1 to 2 business days. Enter the amounts using the link in the email from ${org} to finish your gift.`,
				// stated as a date, never as a window, and the date is the server's. a donor may
				// read this page days after it was painted, and "within 10 days" names nothing they
				// can check by then. a deadline the flow does not have is a block that does not
				// render, because a manufactured one is worse than none.
				deadline:
					state.deadline === null
						? ''
						: `Verify by ${formatDate(state.deadline, config.locale)}. After that this gift is cancelled and you would need to start over.`
			};

		case 'verificationExpired':
			return {
				...BLANK,
				heading: 'This gift needs to be started again',
				body: 'The window for verifying your bank account has closed, so your bank needs the payment details again. Nothing was charged.',
				primary: { label: 'Start again', submit: false }
			};

		case 'success':
			return {
				...BLANK,
				heading: 'Thank you',
				receipt: 'charged',
				totalLabel: 'Charged today',
				receiptNote: '',
				body: `A receipt is on its way to your email. ${org} has your gift.`,
				announce: 'Your gift went through.',
				// the quiet control rather than the primary the two recovery screens use. this donor
				// is owed no act — a gift was made — and a loud control over a thank-you asks for
				// one. it is the only ending that offers this: every other one either has money in
				// flight, where a start-over invites a second payment, or has a recovery control of
				// its own.
				//
				// the label names its destination rather than saying "go back", because it is drawn
				// directly under a receipt whose total row reads `Charged today`, and a bare "back"
				// beside a figure that has just been charged reads as undoing the charge.
				secondary: { label: 'Back to start' }
			};

		// `state.fix` is not among what this screen says. it names a publishable key, an env var or a
		// screen in /admin, and it is addressed to whoever administers the deployment rather than to
		// the donor in front of the card — who can act on none of it. it stays on the wire, because
		// `/api/v1` is a permanent contract (CLAUDE.md) and the reader it is written for is as
		// likely to be an agent wiring the embed; `createUnavailable` below is where such a reader
		// is being addressed and is the one surface that renders it.
		case 'failed':
			return {
				...BLANK,
				heading: 'This gift was not completed',
				// the region, and nothing else. this screen is reached from the correction and the
				// mandate as well as from the numbered steps, and on those two `visibleStep` stays on
				// `takeover` — no caret moves, and the heading's words are replaced under a node that
				// already holds focus, which is a decline announced to nobody. so the sentence on the
				// card is visible text carrying no role of its own: two channels is the same refusal
				// read out twice, to the donor least able to skip past it.
				//
				// the same words outlive this screen where the rail is what refused: `carryDecline`
				// below takes those onto the review step a `RETRY` lands on, because the flow's own
				// copy is cleared on the way in. every other way here is not about the donor's card
				// and stops on this screen.
				failure: state.message,
				announce: state.message,
				primary: { label: 'Try again', submit: false }
			};

		// a resume, which is the only `working` that reaches a takeover: a donor is back from
		// their bank and the flow has not yet found out what happened.
		case 'working':
			return {
				...BLANK,
				heading: 'Finishing your gift',
				body: 'We are checking what happened with your payment. This takes a moment.'
			};

		// the three the card renders as a numbered step rather than as a takeover.
		case 'amount':
		case 'details':
		case 'give':
			return BLANK;
	}
}

/**
 * the decisions the amount step is still missing, once a press has asked for them.
 *
 * every one of them, not the first. a donor who has decided neither frequency nor amount is
 * missing both, and naming them one press at a time makes the same button look refused twice.
 * the order is `./value.ts`'s, which is the order the controls appear in, so the first entry is
 * also where the refused press puts the caret.
 */
function missingDecisions(api: DomApi): readonly AmountDecision[] {
	return api.state.step === 'amount' ? api.state.missing : [];
}

/**
 * one details-step field, with everything needed to say what is wrong with it.
 *
 * `key` is what the projection names it by, and marking is driven from that rather than from the
 * control: the flow's rule and the platform's are not the same rule, and a field marked by the
 * engine on a press the flow refused for something else takes the caret off whatever actually
 * blocked it. the engine's `validity` decides only which sentence is shown, which is the one
 * question it answers better than the projection does.
 */
type DetailsField = {
	readonly key: PayerField;
	readonly field: HTMLInputElement;
	readonly message: HTMLElement;
	readonly problemId: string;
	readonly wording: (validity: ValidityState) => string;
};

/**
 * the words on the fee control, which are also its whole accessible name.
 *
 * the box sits inside a `<label>` holding these words, so the name is the label a donor reads
 * rather than a second string kept in step with it — which is what makes WCAG 2.5.3 structural here
 * instead of maintained (https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html). the
 * control carries no `aria-label`: one would replace the name with something a speech-input donor
 * cannot see, and what the decision does to the money is a line on the card (`feeNote` below) rather
 * than an elaboration only a screen reader is given.
 *
 * it names the decision rather than the row. the row is called `Processing fee` on every screen
 * past the review step, where the decision has been made and the line is an entry in the account.
 */
const FEE_TOGGLE_LABEL = 'Cover the processing fee';

/**
 * the notify press, in the two directions it goes.
 *
 * the same words either way and the sign is the whole of the difference, because what the press
 * does is add the pair or take it away and the pair is what the words name. a minus sign rather
 * than a hyphen: it is the arithmetic glyph the plus is drawn to match, and a hyphen beside a plus
 * reads as a dash in the sentence.
 */
const NOTIFY_SHUT = '+ Notify recipient';
const NOTIFY_OPEN = '\u2212 Notify recipient';

/**
 * the one thing a press on the review step can be refused for, in words.
 *
 * it names the decision rather than the box: the fields inside are the provider's, in a frame on
 * its own origin, and a donor who has not picked a rail has nothing to type into yet. stated once
 * because it travels two channels — the sentence on the card, and the live region where the caret
 * cannot land (`updatePayment` below) — and two copies is how those two drift apart.
 */
const PAYMENT_PROBLEM = 'required';

/** the whole card, and everything that patches it. */
export type CardView = {
	readonly root: HTMLElement;
	/**
	 * the box a payment provider's own fields appear in, handed out rather than looked up.
	 *
	 * by `::part()` name would be the obvious way and is the wrong one: the part vocabulary is a
	 * permanent contract for a host page to style with (./parts.ts), and mounting is not what it
	 * was drawn for. a lookup would also make this file's internals load-bearing from outside it.
	 *
	 * it is not the node the provider mounts into. that node is in the light DOM and is projected
	 * in here through a slot `#openPaymentBox` in ./element.ts puts in this box — a provider's
	 * script cannot complete a mount inside a shadow root at all. this box is left empty by this
	 * file, and it is `#openPaymentBox` that keeps it off the screen until something is painted in
	 * it: the box is opened `hidden` and un-hidden by the first node a provider puts in the mount.
	 * no selector on this box can tell — the slot is a child of it from here on, so the box is
	 * never empty and what arrives arrives a flattening away.
	 */
	readonly payment: HTMLElement;
	/**
	 * the box the anti-abuse challenge draws in, handed out for the reason `payment` above is.
	 *
	 * unlike that one this is the node the widget is rendered into, not a box something else is
	 * projected into: the challenge provider's script completes a mount inside a shadow root and
	 * paints there, so nothing has to leave the encapsulation for it. `#start` in ./element.ts is
	 * where that comparison is written down.
	 */
	readonly challenge: HTMLElement;
	/**
	 * puts the caret on the heading of the screen the card is showing.
	 *
	 * for a card that replaced one a donor pressed a control on: that press took the node holding
	 * focus off the page, and focus falls to the host page's body with nothing announced. the patch
	 * below moves focus on a screen change and never on the first paint, so a card built to replace
	 * one has to be asked — `#start` in ./element.ts is where the asking is decided.
	 */
	focus(): void;
	update(api: DomApi): void;
	/**
	 * everything this card holds outside its own subtree, let go of.
	 *
	 * one thing today: the `resize` listener the frequency chip is put back on. it is on the host
	 * page's `window` rather than on anything in this tree, so removing the card does not remove it —
	 * and it closes over the track, which would keep a card that has left the page alive and being
	 * measured on every rotation. `#stop` in ./element.ts is the seam that calls this, alongside the
	 * flow, the payment surface and the challenge widget.
	 *
	 * it is safe in any order and any number of times, like every other stop that seam reaches.
	 */
	stop(): void;
};

/**
 * the card, and the one thing on it that reaches past the card.
 *
 * `restart` is a fresh boot of the element. a second gift is that rather than a state on the flow,
 * because what the last gift left behind is not the flow's to clear: the payment provider's own
 * fields still hold the card the donor entered and an anti-abuse challenge token is spent once, and
 * `#start` in ./element.ts is the only thing that builds either. so this card asks to be replaced
 * whole, and the one-way flags below are gone with it.
 */
export function createCard(
	doc: Document,
	config: FormConfig,
	restart: () => void,
	/**
	 * where this card says out loud what a reader who is not watching the screen would miss.
	 *
	 * handed in rather than built here, and that is the whole of why it is a parameter: the region
	 * has to be on the page before the words are, and a node this file builds arrives with the card
	 * that carries its first sentence. `createAnnouncer` below is where the node comes from and
	 * `#announce` in ./element.ts is the saying — the wait a first sentence takes and the clear a
	 * repeated one takes both outlive this card, so neither is expressible from here.
	 *
	 * `again` is a sentence that has already been said, said again. it is asked for by the press
	 * that was refused rather than by the words being the same, because most patches write the words
	 * they wrote last and only a press is news.
	 */
	say: (words: string, again?: boolean) => void
): CardView {
	const { locale, currency } = config;
	const money = (minor: number) => formatMinor(minor, locale, currency);
	/** the same figure as a tile offers it rather than as a row states it (./money.ts). */
	const offer = (minor: number) => formatOffer(minor, locale, currency);
	/** and the same again with no currency on it, for the box that draws its own at either end. */
	const figure = (minor: number) => formatFigure(minor, locale, currency);

	/** the current projection, read by every listener below rather than captured by one. */
	let current: DomApi | null = null;
	/**
	 * whether a press has already asked the amount step for a decision it did not have.
	 *
	 * it lasts as long as the donor stays on the step and no longer, which is the rule both flags
	 * below keep; `update` is where it is put back.
	 */
	let asked = false;
	/**
	 * whether a press has already asked the details step for a field it did not have.
	 *
	 * the step says nothing until a donor presses Continue, and this is what holds that: it gates
	 * the sentences, the part tokens and the aria state below, so an untouched card marks nothing.
	 * blur is not the moment — a donor tabbing past an empty field on the way to the next one is not
	 * a donor who has finished with it. it lasts as long as the donor stays on the step and no
	 * longer; `updateDetails` is where it is put back.
	 */
	let attempted = false;
	/**
	 * the same, for the one thing the review step can refuse a press for.
	 *
	 * separate from the flag above because the two steps are refused on different presses: a donor
	 * who was marked on the details step and walked forward must not find the payment box marked
	 * before they have pressed anything on the step it is on.
	 */
	let pressed = false;
	/**
	 * whether the sentence this patch writes is one a press has just asked for again.
	 *
	 * the review step's refusal is the only one, and a second press is why: the words do not change,
	 * so nothing about them says a donor pressed again. set by the press and spent by the patch it
	 * asked for — see the Donate handler below and `say` above.
	 */
	let repeated = false;
	/**
	 * whether the details step's refusal has a channel of its own to be said on.
	 *
	 * it does only where the refused press moved no caret. the fields carry their own sentences and
	 * a field announces itself on arrival, so a press that moves the caret has said the refusal
	 * already and the region saying it in the same breath is one refusal read out twice. set by the
	 * press that found the caret already where it was sending it, spent by the patch it asked for —
	 * see the details Continue below and `updateDetails`.
	 */
	let unmoved = false;
	/**
	 * the reason the rail gave for the gift that was already tried, in words the donor was shown.
	 *
	 * empty is a card carrying no refused attempt. `carryDecline` below is what fills it, what
	 * drops it, and the whole of why it is here.
	 */
	let declined = '';
	/**
	 * the rail reading the sentence above was carried in on, so a change to it can be seen.
	 *
	 * `null` until the review step is patched once, because the reading is only knowable from the
	 * step the retry lands on and the failure is carried from the screen before it.
	 */
	let declinedOn: boolean | null = null;
	/**
	 * whether the donor has just changed the fee decision, and it moved the total.
	 *
	 * what the live region says on that press, and it is the total rather than the decision: the box
	 * reports its own new setting, and the figure that moved under it is the half nobody is told. it
	 * is never set where the figure did not move, so the words it asks for are always new and it
	 * needs no `repeated` beside it. spent by the patch the press asks for.
	 */
	let flipped = false;
	/** the screen on the card, which is what a busy flow stays on and what motion reports against. */
	let shown: Screen = 'amount';
	/** whether the flow has changed screen at all, which is what the entry motion waits for. */
	let moved = false;
	/**
	 * whether the card has been patched even once.
	 *
	 * what separates a screen change from the first paint, and the only reason focus is not moved on
	 * that first one: a donor returning from their bank boots straight onto a takeover, and an
	 * element that took focus as it rendered would move the caret on a page it does not own.
	 */
	let painted = false;
	/**
	 * whether the receipt has ever been given figures.
	 *
	 * a resume reaches success without a decided gift ever having passed through this card, and an
	 * empty ledger block under "Thank you" states nothing. the receipt is shown on those screens
	 * only where there is something in it.
	 */
	let receiptWritten = false;

	const now = (): DomApi => {
		if (current === null) throw new Error('unreachable: the card is patched before it is shown');
		return current;
	};

	// ── the step heads ─────────────────────────────────────────────────────────────────────────
	//
	// one per numbered step, each the step's heading and the three marks beside it. the heading is
	// where focus lands when the flow changes screen, which is why it takes `tabindex="-1"`: hiding
	// a step hides the control that held focus, and focus falls to the document body with nothing
	// said. three steps means that would happen twice per gift.
	//
	// the count is described rather than read after: a caret arriving on the heading announces the
	// heading, and a donor arriving there would be told which screen they are on and not how far
	// through. `aria-describedby` is global and needs no role to carry it, and it is the only way
	// the count is reached — the node itself is `hidden`, which is what keeps one head from saying
	// the ordinal twice.
	//
	// the ordinal is said once more, on each of the two marks a donor may press, and that is not a
	// second copy of this one: those are reached by tab from anywhere on the step and have to name
	// where they go. the mark for the step the donor is already on carries no ordinal at all.
	//
	// nothing here carries a `::part()` name, and the argument is harder now than when these were
	// ornament. the reason `.optional` gives in ./styles/parts.css still stands — a host able to paint out
	// a donor's only sense of how many screens are left is a host able to make the form feel
	// unbounded — and these are now also the only way back through the form, so a host rule that
	// hid them would leave a donor on the screen that spends the money with no way to change what
	// it spends. there is nothing here they need to restyle instead.

	/**
	 * every mark that is a control, kept so the patch can tell it whether the flow would take it.
	 *
	 * across all three heads rather than per head: `stepButtons` (./connect.ts) is one projection
	 * of one flow, and the head a donor is looking at is the only one whose marks are on screen.
	 */
	const stepMarks: { readonly at: number; readonly node: HTMLElement }[] = [];

	/**
	 * the three marks a head carries: where the donor is, and the way to every other step.
	 *
	 * one head per step rather than one set of marks moved between them: the heads live in different
	 * subtrees and only one is ever on screen, so a shared set would have to be re-parented on every
	 * patch. it is also what lets the current mark be a `<span>` at build time — head `index` is
	 * only ever drawn while the flow is on step `index`, so which of its marks is the current one
	 * never changes, and a tag name is the one thing a patch cannot move.
	 *
	 * `type="button"` on every one of them, and it is not optional inside a `<form>`: a `<button>`
	 * defaults to submitting, and on the review step the form's default button is Donate. a mark
	 * left at the default would spend the money from Enter or Space.
	 *
	 * the two a donor may press are named for the screen they go to and where that screen falls,
	 * because they are reached by tab from anywhere on the step and a bare number tells a donor
	 * arriving on one out of context nothing. the one they are standing on is named for the screen
	 * and stops there: it is not somewhere to go, `aria-current` already says it is where they are,
	 * and the ordinal is on this head twice over already — as the count, and as what the count
	 * describes the heading with.
	 *
	 * that one is a `role="img"` rather than a bare `<span>`, so a screen reader walking the card by
	 * control finds three marks on a head that draws three. an `img` takes its name from the author
	 * and makes its children presentational, which is why the name is an attribute here and words
	 * inside it on the other two.
	 *
	 * the drawn shape carries no words at all, so nothing here has a visible label a donor might
	 * speak and 2.5.3 asks nothing of it
	 * (https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html).
	 *
	 * the press is read off the flow at press time rather than bound once: one landing after the flow
	 * has moved on is an event the machine does not handle. a mark drawn unavailable is left able to
	 * send it too — the guard on the transition is what refuses, which is the header's own rule in
	 * ./checkout.machine.ts, and a control that stopped its own press would be a second gate able to
	 * disagree with the first.
	 */
	const stepDots = (index: number): HTMLElement =>
		make(
			doc,
			'div',
			{ class: 'step-dots' },
			STEP_HEADINGS.map((heading, at) => {
				const mark = make(doc, 'span', { class: 'step-mark' });
				if (at + 1 === index) {
					return make(
						doc,
						'span',
						{
							class: 'step-dot current',
							role: 'img',
							'aria-current': 'step',
							'aria-label': heading
						},
						[mark]
					);
				}
				const label = make(doc, 'span', { class: 'vh' }, [
					`${heading}, step ${at + 1} of ${STEP_COUNT}`
				]);
				const node = make(doc, 'button', { class: 'step-dot', type: 'button' }, [mark, label]);
				node.addEventListener('click', () => now().stepButtons[at]?.onClick());
				stepMarks.push({ at, node });
				return node;
			})
		);

	let steps = 0;
	const stepHead = (): { readonly head: HTMLElement; readonly heading: HTMLElement } => {
		const index = (steps += 1);
		const countId = `step-${index}-count`;
		// `hidden` rather than visually hidden, and it is what keeps the ordinal from being said
		// twice on one head: left in reading order it is loose text a browse-mode caret reads, and
		// it is also what the heading beside it is described by. hidden, only the description
		// resolves it — a reference includes a hidden node, which is the whole reason this works
		// (https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-describedby).
		//
		// `step-count` is the name ./element.dom.spec.ts collects the three of them by, and no
		// stylesheet selects it.
		const count = make(doc, 'span', { class: 'step-count', id: countId, hidden: true }, [
			`Step ${index} of ${STEP_COUNT}`
		]);
		const node = make(
			doc,
			'h2',
			{ part: part('heading'), tabindex: -1, 'aria-describedby': countId },
			[STEP_HEADINGS[index - 1] ?? '']
		);
		// the heading at the start of the head's one line and the marks at its end. the count rides
		// it ahead of both, out of flow and taking no width, so it is read where it always was and
		// changes nothing about where the two drawn things stand.
		return {
			head: make(doc, 'header', { class: 'step-head' }, [count, node, stepDots(index)]),
			heading: node
		};
	};

	// ── frequency ──────────────────────────────────────────────────────────────────────────────
	//
	// a deployment offering one cadence draws no control here, and the whole group is left out of
	// the step rather than rendered with a single option in it: one option is not a choice, and a
	// track holding it asks a donor to decide something already decided. what a control would have
	// sent is seeded on the draft instead (`settledDraft` in ../checkout.machine.ts), so the gift
	// still carries a cadence and nothing downstream can tell one was never drawn.
	//
	// the nodes below are still built. they are unreferenced on such a deployment and the patch
	// walks an empty option list, which costs a few detached nodes and keeps the shape of this file
	// one shape rather than two — `chooses` is read at the two places it changes an outcome: what
	// the step is built from, and where a refused press puts the caret.

	/** whether this deployment leaves the cadence to the donor at all. */
	const chooses = config.frequencies.length > 1;

	const frequencyOptions: { label: HTMLElement; input: HTMLInputElement }[] = [];
	const frequencyTrack = make(doc, 'div', { class: 'segment' });
	// a native `<fieldset>` of radios and no sentence under it. the cadence opens already chosen
	// (`settledDraft` in ./checkout.machine.ts) and no control here can un-choose it, so there is no
	// press this group can be refused for and nothing for a message to say.
	const frequencyGroup = make(doc, 'fieldset', { class: 'group' }, [
		make(doc, 'legend', { part: part('label') }, ['How often']),
		frequencyTrack
	]);

	// ── amounts ────────────────────────────────────────────────────────────────────────────────

	const amountOptions: { label: HTMLElement; input: HTMLInputElement }[] = [];
	const amountTiles = make(doc, 'div', { class: 'tiles' });

	// the way past the presets, drawn as one of them: a radio in the presets' own group, so the
	// arrow keys reach it, carrying no figure. what it chooses is the entry under it, which is shown
	// only while it is chosen and takes the caret on the press. built only where there are presets
	// to be other than (`build` below) — on a form suggesting none, the entry is the whole amount
	// block and stands alone, which is the shape `createSkeleton` draws.
	//
	// chosen is the view's to say and not the flow's. the flow carries one `amountMinor` and marks
	// the preset that equals it, and a donor typing 25 into the entry would otherwise see the $25
	// tile light and the box they are typing in close under them. so this holds from the press or
	// the typing until a preset is pressed, and while it holds no preset reads as chosen whatever
	// the figure — the amount is still the flow's one number either way.
	let otherChosen = false;
	let otherTile: { label: HTMLElement; input: HTMLInputElement } | null = null;

	// whether the donor has asked to tell someone about the gift, which is the view's and not the
	// flow's: the tick and the note both go to the flow because each changes what the flow requires,
	// and this press changes nothing it checks — two blank notify boxes are a gift nobody is told
	// about whether the boxes are on screen or not (`settle` in ./value.ts).
	//
	// it is derived rather than only held: the row is open when this is set or when either notify
	// field arrives from the projection holding something, which is what a resumed gift with a
	// recipient on it needs. the press is the way in and the way back out: pressed while the row is
	// open it unsets this and blanks both boxes, which is what tells nobody (`shutNotify` below).
	// untaking the dedication does that same shutting, because nothing inside a block a donor took
	// back is still asked for.
	let notifyAsked = false;

	const entryInput = make(doc, 'input', {
		id: 'amount-entry',
		type: 'text',
		// a numeric keypad with a decimal separator on it, rather than `type="number"`, whose
		// spinner and scroll-wheel stepping both change a gift by accident.
		inputmode: 'decimal',
		autocomplete: 'off',
		// what the box is for, on the box itself. the label below is the accessible name and stays
		// visually hidden, so this is the whole of what a donor reads before they type into it.
		//
		// `Amount`, because that is what it holds. a press on a preset writes that preset's figure
		// here (`build` below), so the box is not an alternative to the tiles above it — it is the
		// amount, and they are shortcuts into it.
		//
		// it is described by nothing. the sentence is the group's and is pointed at from the
		// fieldset while there is a refusal to state (`update` below) — a description written here
		// would be read off `#amount-problem` whether that node is `hidden` or not, so a box wired
		// to it at build time tells every donor their amount is wrong before they have typed one.
		placeholder: 'Amount'
	});
	const entryLabel = make(doc, 'label', { part: part('label'), class: 'vh', for: 'amount-entry' }, [
		'Amount'
	]);
	// two marks, one at each end of the box: the symbol in front of the figure and the code behind
	// it. neither is in the flow and neither takes the pointer (./styles/parts.css), so the whole
	// tile belongs to the input between them.
	//
	// both rather than one, because each says something the other cannot. the symbol is what a donor
	// reads a figure with and it names several currencies at once; the code names exactly one and is
	// not what anybody types money in front of. the split is also what empties the start of the box
	// of everything but a mark — a word there and the placeholder were two labels competing for one
	// corner.
	//
	// the leading one is conditional and the trailing one is not: `en-US` writes `CHF` as `CHF`, and
	// a card drawing that at both ends states the currency twice (`currencySymbol` in ./money.ts).
	const symbol = currencySymbol(locale, currency);
	const code = currency.toUpperCase();
	const entryTile = make(doc, 'div', { part: part('amount-input'), class: 'tile entry' }, [
		...(symbol === code
			? []
			: [make(doc, 'span', { class: 'adorn-lead', 'aria-hidden': 'true' }, [symbol])]),
		entryInput,
		make(doc, 'span', { class: 'adorn-trail', 'aria-hidden': 'true' }, [code])
	]);

	// the bounds are the configuration's, so the sentence is built once here rather than written
	// twice: `update` reads this same string onto the live region. they are offered the way a tile
	// is, not stated the way a row is (./money.ts): `$5.00` here claims a precision nobody set.
	const amountProblem = `between ${offer(config.minAmountMinor)} and ${offer(config.maxAmountMinor)}`;
	const amountMessage = make(doc, 'p', { class: 'message', id: 'amount-problem', hidden: true }, [
		amountProblem
	]);
	// no `radiogroup` on this one, and the difference is the free entry: this group holds a text
	// box beside its radios, which is not what that role describes. the invalid state is carried by
	// the box itself, where the role does support it, and the sentence reaches the group through
	// `aria-describedby` — which is global and works on the role a fieldset already has.
	const amountGroup = make(doc, 'fieldset', { class: 'group' }, [
		make(doc, 'legend', { part: part('label') }, ['How much']),
		amountTiles,
		entryLabel,
		amountMessage
	]);

	// an emptied box and a box holding what nothing can read are two different events, and the two
	// nulls below are why they are told apart here rather than by whoever reads them.
	entryInput.addEventListener('input', () => {
		// typing is choosing the other way, wherever the caret came from — on the step the box is
		// on. an event reaching it from behind that step is one the flow drops (`AmountDecision` in
		// ./value.ts), and a choice recorded off it would show as a box opened on a step nobody is
		// standing on.
		if (shown === 'amount') otherChosen = true;
		// the donor taking their amount back. leaving the last figure live behind it is an empty box
		// over a gift the next press would charge, so the withdrawal goes to the flow as one.
		if (entryInput.value.trim() === '') {
			now().amountGroup.onTyped?.(null);
			return;
		}
		// and this null is the other thing: a value with no figure in it, which every figure a donor
		// types passes through on its way in. the amount they last gave stands until they give
		// another.
		const amountMinor = parseMinor(entryInput.value, locale, currency);
		if (amountMinor === null) return;
		now().amountGroup.onTyped?.(amountMinor);
	});

	// ── the note ───────────────────────────────────────────────────────────────────────────────

	const noteToggle = make(doc, 'input', { part: part('checkbox'), type: 'checkbox' });
	const noteField = make(doc, 'textarea', { part: part('field'), id: 'note', rows: 3 });
	// inside the disclosure, under the field it is about, so it is revealed and hidden with the note
	// itself: a sentence about a note nobody has opened is a sentence about nothing. it carries no
	// `::part()` name, for the reason ./parts.ts gives about every error surface.
	//
	// it names two ways out where the messages above it name one, and that is the difference the
	// note has from every other decision on this step: the donor may write it or take back the ask,
	// and naming only the first would leave a donor who ticked by accident stuck against the step.
	const noteMessage = make(doc, 'p', { class: 'message', id: 'note-problem', hidden: true }, [
		'required, or untick to skip'
	]);
	// the inner wrapper is what the disclosure's `0fr` row collapses over. it has no job of its own
	// and no part name; ./styles/motion.css is where it earns its place.
	const noteBody = make(doc, 'div', { class: 'disclosure-body', hidden: true }, [
		make(doc, 'div', { class: 'disclosure-inner' }, [
			make(doc, 'label', { part: part('label'), class: 'vh', for: 'note' }, ['Your note']),
			noteField,
			noteMessage
		])
	]);
	// the note says it is optional, and it is the only control on the card that says anything about
	// whether it has to be filled in. that is the convention the details step's required fields
	// then read against — an unmarked field is one the form needs — and it is why they carry no
	// mark of their own: three decorations to say the same thing about every field on a step is
	// noise, and a donor who learns a field was required only by being refused has learnt it too
	// late.
	//
	// the word qualifies the tick and not the note under it. ticking is the donor asking to write
	// one, and from there the note is a decision like any other on this step (`AmountDraft` in
	// ./value.ts) — so the box stays optional and stays marked as such.
	const noteRow = make(doc, 'label', { class: 'check-row' }, [
		noteToggle,
		make(doc, 'span', {}, ['Add a note ', make(doc, 'span', { class: 'optional' }, ['(optional)'])])
	]);
	// the two as one thing on the step, which is what puts the step's own rhythm above the pair
	// rather than between them: a field revealed a full step below the tick that revealed it reads
	// as something else that appeared, not as the disclosure opening. ./styles/layout.css is where
	// the gap it does keep is set.
	//
	// `.disclosure` is the construction and `.note` names which one this is. the tribute below is
	// the second on this step and carries the same pair of classes, which is what makes "both
	// disclosures sit the same" a fact about one rule rather than two rules that agree today.
	const note = make(doc, 'div', { class: 'disclosure note' }, [noteRow, noteBody]);

	// the ask goes to the flow and comes back through the patch, rather than being kept here: the
	// disclosure is opened off `noteToggle.pressed` below, so what the donor asked for survives a
	// trip to the later steps and back, and a refused press has something to name. focus follows the
	// flow's answer rather than the box's own `checked` for the same reason.
	noteToggle.addEventListener('change', () => {
		now().noteToggle.onClick();
		if (now().noteToggle.pressed === true) noteField.focus();
	});
	noteField.addEventListener('input', () => now().noteField.onChange(noteField.value));

	// ── the program ────────────────────────────────────────────────────────────────────────────
	//
	// where the gift goes, drawn only where the org left that to the donor: a form pinned to one
	// cause has nothing to ask, and one carrying no program at all has nothing to say. which of the
	// three this is, is `config.program` (./v1.ts) and is read here once, exactly as `chooses` above
	// reads the cadences — the projection carries the options either way (./connect.ts).
	//
	// it sits under the amount and over the two disclosures, which is where it belongs by what it
	// is: a fact about the gift rather than about the donor, and one the card asks for rather than
	// one the donor asks to give.
	//
	// a visible label, unlike the tribute's select below it. that control says `In honor of` on its
	// face and this one rests on `Where it’s needed most`, which says where the gift goes and not
	// what the box is for — so the words are on the card rather than only in the accessible name.
	//
	// `part('field')`, no `appearance: none`, and nothing else: the keyboard, the popup and the
	// arrow are all the platform's, the same as the tribute's.

	/** whether the org left the cause to the donor, which is the one shape that draws a control. */
	const choosesProgram = config.program?.mode === 'choice';

	const programSelect = make(doc, 'select', { part: part('field'), id: 'program' });
	programSelect.addEventListener('change', () => now().programSelect.onChange(programSelect.value));
	const programField = make(doc, 'div', { class: 'field-row program' }, [
		make(doc, 'label', { part: part('label'), for: 'program' }, ['Program']),
		programSelect
	]);

	// ── the tribute ────────────────────────────────────────────────────────────────────────────
	//
	// a gift given for somebody else, and the second disclosure on this step. it is here rather
	// than on the details step because a tribute is a fact about the gift and not about the payer,
	// and the note is its established neighbour — the same kind of thing, something the donor says
	// about what they are giving.
	//
	// the construction is the note's exactly, down to the class names, and the whole of what is
	// different is what is inside the body: four boxes rather than one, with two pairings between
	// them that `missingAmountDecisions` (./value.ts) holds and this file only reports.

	const tributeToggle = make(doc, 'input', { part: part('checkbox'), type: 'checkbox' });

	/** one tribute box, with the sentence that says what is wrong with it directly under it. */
	type TributeBox = {
		readonly key: AmountDecision;
		readonly field: HTMLInputElement;
		readonly message: HTMLElement;
		readonly problemId: string;
	};
	const tributeBoxes: TributeBox[] = [];

	/**
	 * one tribute box, wired and registered, handed back as its three nodes rather than as a row.
	 *
	 * the pieces rather than a wrapper, because the two places they are laid out want different
	 * shapes: the honoree shares a line with the select and its sentence has to span both columns,
	 * where a wrapper would trap it in the narrow one and stack it six lines deep at 375px. the
	 * notify pair takes the ordinary row.
	 *
	 * the label is hidden the way the amount entry's own is and for its reason: what the box is for
	 * is written on the box, and a visible label over each of these turns a four-control block into
	 * eight rows. so the words here are the whole of what a screen reader is given, and each names
	 * its own person rather than saying "their name" twice about two different people.
	 */
	const tributeBox = (
		key: AmountDecision,
		field: HTMLInputElement,
		labelText: string,
		placeholder: string,
		sentence: string,
		read: (api: DomApi) => FieldProps
	): readonly HTMLElement[] => {
		field.setAttribute('placeholder', placeholder);
		// off, on all three. these are somebody else's name and somebody else's address, so a
		// browser offering the donor their own saved details would be offering the wrong person.
		field.setAttribute('autocomplete', 'off');
		field.addEventListener('input', () => read(now()).onChange(field.value));
		const problemId = `${field.id}-problem`;
		const message = make(doc, 'p', { class: 'message', id: problemId, hidden: true }, [sentence]);
		tributeBoxes.push({ key, field, message, problemId });
		return [
			make(doc, 'label', { part: part('label'), class: 'vh', for: field.id }, [labelText]),
			field,
			message
		];
	};

	/** the three nodes as the ordinary labelled row, which is what the notify pair takes. */
	const tributeRowOf = (nodes: readonly HTMLElement[]): HTMLElement =>
		make(doc, 'div', { class: 'field-row' }, nodes);

	// the kind, drawn as the platform's own select. two members and no unset reading — the flow is
	// seeded with what this control shows (`OPENED_TRIBUTE` in ./value.ts) — so it is a control
	// whose resting state is an answer rather than a blank.
	//
	// it carries `part('field')`: it is a box a donor operates and a host styling their fields has
	// no reason to be told this one is a select. no `appearance: none` anywhere near it, so the
	// keyboard, the popup and the arrow are all the platform's.
	const tributeKindSelect = make(doc, 'select', { part: part('field'), id: 'tribute-kind' });
	tributeKindSelect.addEventListener('change', () =>
		now().tributeKindSelect.onChange(tributeKindSelect.value)
	);

	// the kind and the name on one line, which is what makes them read as the sentence they are:
	// `In honor of` starts it and the name finishes it.
	//
	// flat rather than two wrapped rows, so the honoree's sentence is a grid item of its own and can
	// span the pair (./styles/layout.css). the hidden labels are out of flow and take no cell.
	const tributeDedication = make(doc, 'div', { class: 'dedication' }, [
		// the select says `In honor of` on its face, so the accessible name says what the control is
		// rather than repeating the option a donor is already read.
		make(doc, 'label', { part: part('label'), class: 'vh', for: 'tribute-kind' }, [
			'How this gift is dedicated'
		]),
		tributeKindSelect,
		...tributeBox(
			'tribute-honoree',
			make(doc, 'input', { part: part('field'), id: 'tribute-honoree' }),
			'Who this gift is for',
			'Their name',
			'required, or untick to skip',
			(api) => api.tributeHonoreeField
		)
	]);

	const tributeNotifyRow = make(
		doc,
		'div',
		{ class: 'names', id: 'tribute-notify', hidden: true },
		[
			tributeRowOf(
				tributeBox(
					'tribute-notify-name',
					make(doc, 'input', { part: part('field'), id: 'tribute-notify-name' }),
					'Name of the person to tell',
					'Name',
					// short, because these two sit in half a card each once there is room for two columns.
					// both ways out are still named: fill it in, or clear the other and tell nobody.
					'required, or clear the email',
					(api) => api.tributeNotifyNameField
				)
			),
			tributeRowOf(
				tributeBox(
					'tribute-notify-email',
					// `type="email"` for the keyboard it opens and the shape the engine checks; never
					// `required`, because the pair is optional and a donor who asked for nobody to be told
					// is the case the pairing rule exists for. ./connect.ts declares the same and says why.
					make(doc, 'input', { part: part('field'), id: 'tribute-notify-email', type: 'email' }),
					'Email address of the person to tell',
					'Email',
					// two rules and one sentence, the way a name field on the details step has one for both
					// of the rules it can break: an empty box and one holding something that is not an
					// address are the same thing to a donor looking at the pair.
					'needs an email address, or clear the name',
					(api) => api.tributeNotifyEmailField
				)
			)
		]
	);

	// the way in, the way back out, and the words over the pair while it is open — one control in
	// all three, so what a donor pressed is what they are then looking at and taking it back is
	// where they left it. the sign is a glyph in the words rather than an icon, because this control
	// is drawn as words (`[part~='action-quiet']` in ./styles/parts.css) and an icon beside them
	// would be a second thing to align against a line that wraps.
	//
	// it carries no `(optional)` mark. the tick already spends the one this card allows, and a
	// second inside a disclosure the donor opened would be the same word about the same block
	// twice. leaving both boxes empty is what tells nobody — which is what the second press writes,
	// so the flow holds blank for both and reads as a gift nobody is told about (`settle` in
	// ./value.ts) rather than as a pair the donor abandoned half-filled.
	//
	// it is not a label for the boxes under it: each of those carries a hidden label naming its own
	// person, and this names the pair. so what a screen reader is given is the press it is, with
	// `aria-expanded` for which way it is set.
	const tributeNotifyOpen = make(
		doc,
		'button',
		{
			part: part('action-quiet'),
			type: 'button',
			'aria-expanded': 'false',
			'aria-controls': 'tribute-notify'
		},
		[NOTIFY_SHUT]
	);
	/**
	 * the pair taken away and the gift emptied of a recipient, which is the whole of what shutting
	 * it is.
	 *
	 * both boxes emptied through the flow rather than here: blank on both is what says nobody is
	 * told, and a value left in the draft behind a hidden box is a recipient the endpoint would
	 * still be handed. the marks on the pair go with the values on the patch.
	 *
	 * two controls shut this and they have to shut it identically — the press below, and the tick
	 * that takes the block the pair stands inside away.
	 *
	 * the two `onChange`s are the press's own clearing. where the tick is what shut it, the toggle's
	 * click has already run by the time this is reached and `SET_TRIBUTE` is ignored once the
	 * tribute is off the draft (./checkout.machine.ts) — the draft is already empty there, emptied
	 * by `TOGGLE_TRIBUTE` taking the whole block off it.
	 */
	const shutNotify = (): void => {
		notifyAsked = false;
		now().tributeNotifyNameField.onChange('');
		now().tributeNotifyEmailField.onChange('');
		update(now());
	};

	tributeNotifyOpen.addEventListener('click', () => {
		// the drawn state rather than the flag, because a gift that arrived naming someone opens the
		// row with the flag unset (`updateTribute` below) and this press is the one that shuts it.
		if (!tributeNotifyRow.hidden) {
			shutNotify();
			return;
		}
		notifyAsked = true;
		// repainted here rather than left to the flow, for the reason the other tile's press is: the
		// press sends the flow nothing, and the row has to be on screen before the caret can land in
		// it.
		update(now());
		tributeBoxes.find((entry) => entry.key === 'tribute-notify-name')?.field.focus();
	});

	const tributeNotify = make(doc, 'div', { class: 'field-row' }, [
		tributeNotifyOpen,
		tributeNotifyRow
	]);

	const tributeBody = make(doc, 'div', { class: 'disclosure-body', hidden: true }, [
		make(doc, 'div', { class: 'disclosure-inner' }, [tributeDedication, tributeNotify])
	]);

	// `Dedicate this gift`, which is the fundraiser's own word for this and is what the tick asks
	// for rather than what it produces — the two kinds are inside, on the control that carries them.
	// `(optional)` for the note's reason: the card marks what it does not need and leaves the rest
	// unmarked, so a donor learns the convention once.
	const tributeRow = make(doc, 'label', { class: 'check-row' }, [
		tributeToggle,
		make(doc, 'span', {}, [
			'Dedicate this gift ',
			make(doc, 'span', { class: 'optional' }, ['(optional)'])
		])
	]);
	const tribute = make(doc, 'div', { class: 'disclosure tribute' }, [tributeRow, tributeBody]);

	// the ask goes to the flow and comes back through the patch, exactly as the note's does, so
	// what the donor opened survives a trip to the later steps and back. the caret lands on the
	// name rather than on the select: the select already holds an answer, and the name is the box
	// the block is refused for.
	tributeToggle.addEventListener('change', () => {
		now().tributeToggle.onClick();
		if (now().tributeToggle.pressed === true) {
			tributeBoxes[0]?.field.focus();
			return;
		}
		// the ticking path returned above, so this is the untick.
		shutNotify();
	});

	// ── the amount step ────────────────────────────────────────────────────────────────────────

	const continueButton = make(doc, 'button', { part: part('action'), type: 'button' }, [
		make(doc, 'span', { class: 'action-label' }, ['Continue']),
		spinner(doc)
	]);
	continueButton.addEventListener('click', () => {
		const pressedOn = now().state.step;
		now().continueButton.onClick();
		// the flow refuses a press it has no decision for, and refusing silently is a button that
		// does nothing. what is missing is named here rather than guessed at by the donor.
		//
		// a refusal is a press that started on this step and left the flow on it, which is the same
		// test the Donate button below makes for the same reason. nothing asynchronous sits between
		// this step and the next one today — `CONTINUE` targets `give` outright — so the two halves
		// only ever disagree if one is added.
		if (pressedOn !== 'amount' || now().state.step !== 'amount') return;
		asked = true;
		// said on every press rather than on a press that changed the words, for the reason the
		// Donate handler below gives: the sentences do not move between two presses refused for the
		// same decisions, so nothing about them says a donor pressed again — and the caret does not
		// move either, because it is already on the control the first refusal sent it to.
		repeated = true;
		update(now());
		firstAmountProblem(missingDecisions(now())).focus();
	});

	/**
	 * where a refused press puts the caret on this step.
	 *
	 * the first entry of the set, which `./value.ts` orders as the controls are laid out, so the
	 * caret only ever moves forward. the same shape `firstGiveProblem` has, and for the same reason.
	 *
	 * a missing amount is always the entry and never a tile. on a tray with tiles the amount can
	 * only go missing through the other tile, which opens the box in the tiles' place
	 * (`setHidden(entryTile, …)` in `update` below), and on a bare tray the box is the whole amount
	 * block — so it is the one control a refused amount has to send the caret to either way.
	 *
	 * the cadences are not among the destinations. the track opens with one chosen and offers no way
	 * back to none, so no press is ever refused for it (`AmountDecision` in ./value.ts).
	 */
	function firstAmountProblem(missing: readonly AmountDecision[]): HTMLElement {
		const first = missing[0];
		if (first === 'note') return noteField;
		const box = tributeBoxes.find((entry) => entry.key === first);
		if (box !== undefined) return box.field;
		return entryInput;
	}

	const amountHead = stepHead();
	const amountStep = make(doc, 'section', { class: 'step' }, [
		amountHead.head,
		...(chooses ? [frequencyGroup] : []),
		amountGroup,
		...(choosesProgram ? [programField] : []),
		note,
		tribute,
		continueButton
	]);

	// ── the receipt ────────────────────────────────────────────────────────────────────────────

	const giftLabel = make(doc, 'span', { class: 'row-label' });
	const giftFigure = make(doc, 'span', { class: 'figure' });

	const feeFigure = make(doc, 'span', { class: 'figure' });
	// the figure's own name, for the reading order alone. while the row is a decision the label
	// beside it says `Cover the processing fee`, which names the control rather than the money, and
	// the figure would otherwise be a bare number in a list of named ones. it is taken off again on
	// the screens where the visible label is back — see `updateSummary` below.
	const feeFigureName = make(doc, 'span', { class: 'vh' }, ['Processing fee']);
	// the box is inside the label rather than pointed at by one, the way the check rows on the
	// details step are: the whole line is then the target, which is what gets a control this small to
	// the floor every other one on the card is laid against. it stays a checkbox and the drawing over
	// it is `.fee-decision [part~='checkbox']` in ./styles/parts.css — the state, the keyboard and the
	// name are the platform's, and only the paint is ours.
	const feeBox = make(doc, 'input', { part: part('checkbox'), type: 'checkbox' });
	// Enter here submits the form the box sits in, and on this step the form's default button is
	// Donate: a donor reaching for the fee decision with the keyboard would spend the money instead.
	// a checkbox is operated with Space, so the keystroke has nothing to do on this control and
	// everything to do on the one it would otherwise reach.
	feeBox.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') event.preventDefault();
	});
	// the thumb, drawn as a sibling rather than as a pseudo-element on the box: firefox generates
	// neither `::before` nor `::after` on an `<input>`, and the browser pool here is chromium only —
	// so a pseudo-element thumb is a switch with nothing on it for a whole engine, and nothing in
	// this repository can see it.
	const feeSwitch = make(doc, 'span', { class: 'switch' }, [
		feeBox,
		make(doc, 'span', { class: 'switch-thumb' })
	]);
	// what the decision does, in both readings, and it is on the card rather than only in the box's
	// accessible name: a sighted donor never reads a name, and the fee is the one line of the receipt
	// where the figure alone does not say what was decided.
	const feeNote = make(doc, 'p', { class: 'fee-note', id: 'fee-note', hidden: true });
	const feeDecision = make(doc, 'label', { class: 'fee-decision', hidden: true }, [
		make(doc, 'span', { class: 'row-label' }, [FEE_TOGGLE_LABEL]),
		feeSwitch
	]);
	// the same row read as an account rather than operated as a decision, which is every screen past
	// the review step. two nodes rather than one relabelled: only one of them is ever on screen, and
	// the ledger reading is a label beside a figure where the other is a label, a switch and a
	// sentence under both — one node moved between those two shapes is a patch rebuilding its own
	// subtree, and a relabelled control is one a screen reader hears change identity under it.
	const feeName = make(doc, 'span', { class: 'row-label' }, ['Processing fee']);
	const feeRow = make(doc, 'div', { class: 'row fee', hidden: true }, [
		feeName,
		feeDecision,
		feeNote,
		feeFigureName,
		feeFigure
	]);
	feeBox.addEventListener('change', () => {
		const pressedOn = now().state.step;
		const before = now().submitButton.totalMinor;
		now().feeToggle.onClick();
		// the flow answers this event on the review step alone (./checkout.machine.ts), so a change
		// that began anywhere else moved no money and has nothing to say.
		if (pressedOn !== 'give' || now().state.step !== 'give') return;
		// and what is said is the figure that moved, so a decision that moved none is not news. the row
		// prices the rail the donor is on, and the first rail on offer before they have chosen one
		// (`displayRail` in ./checkout.machine.ts), so the two readings total the same only where the
		// config publishes no rule to price either by. the box reports its own new setting either way,
		// which is the half a donor is owed here — the total is the half nothing else would tell them.
		if (now().submitButton.totalMinor === before) return;
		flipped = true;
		update(now());
	});

	// an `<output>`, and the only element on the card that is one. it carries `role="status"`
	// implicitly, which is the whole reason: the fee decision rewrites this figure without changing
	// the screen and without moving the caret, and the patch that rewrites it says nothing — the box
	// reports its own new setting and the total beside it is the half nobody is told. the role comes
	// with the tag rather than from an `aria-live` and an id, so there is nothing here to keep
	// pointing at the node.
	//
	// the total alone. the gift and the fee above it are `<span>`, because a region per row is a
	// donor hearing three numbers on a press that moved one.
	//
	// one screen turns it off, and it is the correction screen: the announcer states both figures
	// there, so the region would say the new total a second time. `update` below is where that is
	// written, off the same test as the mark on the figure.
	//
	// nothing about the drawing follows the tag: `.figure` carries no `::part()` name, the `summary`
	// part is on the block below, and ./styles/parts.css and ./styles/motion.css both select this by
	// class. it sits inside `body`, which is a `<form>`, on every screen — the receipt is moved
	// between `giveStep` and `receiptSlot` and both are in it — and an `<output>` submits nothing, so
	// the form is unchanged by it.
	const totalFigure = make(doc, 'output', { class: 'figure' });
	const totalLabel = make(doc, 'span', { class: 'row-label' }, ['Total today']);
	// inside the block rather than under it: the ongoing obligation, and "nothing has been charged
	// yet", are statements about the total, so a donor reading the figure reads them with it.
	const receiptNote = make(doc, 'p', { class: 'receipt-note', hidden: true });
	// where the gift goes, restated on the screen the donor authorizes it from — a pin they were
	// never asked about, or the choice they made two steps ago and are being asked to confirm.
	//
	// it is in the receipt on every form that carries a program, choice and pin alike, because the
	// question the block answers is what this gift is: the cause is as much a part of that as the
	// cadence on the line above it.
	//
	// the name rather than the id, and it is the only line here holding words. the pinned name is
	// written once at build — nothing in the flow can move it — and the chosen one is patched
	// (`updateSummary` below), which is the same division `giftLabel` is under.
	const programName = make(doc, 'span', { class: 'program-name' }, [
		config.program?.mode === 'pinned' ? config.program.name : NO_PROGRAM_LABEL
	]);
	const programLine = make(doc, 'div', { class: 'row program' }, [
		make(doc, 'span', { class: 'row-label' }, ['Program']),
		programName
	]);

	const summary = make(doc, 'div', { part: part('summary') }, [
		make(doc, 'div', { class: 'row' }, [giftLabel, giftFigure]),
		...(config.program === undefined ? [] : [programLine]),
		feeRow,
		make(doc, 'div', { class: 'row total' }, [totalLabel, totalFigure]),
		receiptNote
	]);

	// ── the details step ───────────────────────────────────────────────────────────────────────

	const emailField = make(doc, 'input', { part: part('field'), id: 'email', type: 'email' });
	const firstNameField = make(doc, 'input', { part: part('field'), id: 'first-name' });
	const lastNameField = make(doc, 'input', { part: part('field'), id: 'last-name' });

	/** every typed details-step field, in the order a refused press walks them. */
	const detailsFields: DetailsField[] = [];

	const textField = (
		key: PayerField,
		field: HTMLInputElement,
		labelText: string,
		autocomplete: string,
		read: (api: DomApi) => FieldProps,
		wording: (validity: ValidityState) => string
	) => {
		field.setAttribute('autocomplete', autocomplete);
		field.addEventListener('input', () => read(now()).onChange(field.value));
		// the sentence sits in the row, under the control it is about, and is tied to it by
		// `aria-describedby` while it is shown — so it is read out with the field rather than
		// found by looking for it. it carries no `::part()` name for the reason ./parts.ts gives
		// for every error surface: a host who could restyle it could restyle it into nothing.
		const problemId = `${field.id}-problem`;
		const message = make(doc, 'p', { class: 'message', id: problemId, hidden: true });
		detailsFields.push({ key, field, message, problemId, wording });
		return make(doc, 'div', { class: 'field-row' }, [
			make(doc, 'label', { part: part('label'), for: field.id }, [labelText]),
			field,
			message
		]);
	};

	const emailRow = textField(
		'email',
		emailField,
		'Email',
		'email',
		(api) => api.emailField,
		(validity) => (validity.valueMissing ? 'required for your receipt' : 'not an email address')
	);
	// one sentence for both rules a name can break. an empty field and a field holding a space are
	// the same thing to the donor looking at it, and `patternMismatch` is what the second arrives
	// as — see `NAME_PATTERN` in ./value.ts.
	const namesRow = make(doc, 'div', { class: 'names' }, [
		textField(
			'firstName',
			firstNameField,
			'First name',
			'given-name',
			(api) => api.firstNameField,
			() => 'required'
		),
		textField(
			'lastName',
			lastNameField,
			'Last name',
			'family-name',
			(api) => api.lastNameField,
			() => 'required'
		)
	]);

	const consentToggle = make(doc, 'input', { part: part('checkbox'), type: 'checkbox' });
	const consentRow = make(doc, 'label', { class: 'check-row' }, [
		consentToggle,
		make(doc, 'span', {}, [`Allow ${config.orgLegalName} to contact me`])
	]);
	consentToggle.addEventListener('change', () => now().consentToggle.onClick());

	const detailsContinue = make(doc, 'button', { part: part('action'), type: 'button' }, [
		make(doc, 'span', { class: 'action-label' }, ['Continue']),
		spinner(doc)
	]);
	detailsContinue.addEventListener('click', () => {
		const pressedOn = now().state.step;
		now().continueButton.onClick();
		const after = now().state;
		// the same rule the amount step's own Continue keeps: the flow refuses a press it has no
		// field for, and refusing silently is a button that does nothing.
		if (pressedOn !== 'details' || after.step !== 'details') return;
		attempted = true;
		const target = firstDetailsProblem(after.missing);
		// which channel this refusal has, asked before the caret is moved rather than after. where
		// the caret is already on the field the press would send it to, `focus()` announces nothing
		// and the region is all that is left; where it moves, the field it lands on carries the
		// sentence and the region saying it too is the same refusal twice.
		//
		// it is a real question rather than a guess at one, because the answer is different for two
		// donors on the same press: a keyboard donor's caret is on the button they pressed, and in
		// Safari on macOS a click focuses no button at all — so a mouse donor's second press finds
		// the caret still on the field the first one left it on.
		if ((target.getRootNode() as Document | ShadowRoot).activeElement === target) {
			unmoved = true;
			// and it is said again rather than written, because the words do not move between two
			// presses refused for the same fields — the reason the Donate handler below gives.
			repeated = true;
		}
		update(now());
		target.focus();
	});

	/**
	 * where a refused press puts the caret on this step.
	 *
	 * the first entry of the set, which ./value.ts orders as the controls are laid out, so the caret
	 * only ever moves forward. the email box is the fallback and is never reached: the guard this
	 * press is refused by is exactly "the set is empty" (`payerFieldsAreGiven` in
	 * ./checkout.machine.ts), so a refusal always names at least one field.
	 */
	function firstDetailsProblem(missing: readonly PayerField[]): HTMLElement {
		return detailsFields.find((entry) => missing.includes(entry.key))?.field ?? emailField;
	}

	// where the anti-abuse challenge draws, and it is last on purpose. the challenge is what stands
	// behind the press rather than a field on the way to it, and most donors never see it — the
	// widget is rendered in the mode that draws nothing at all unless a visitor is actually asked to
	// interact, so a box anywhere else in this column would hold a gap open for something usually
	// absent. `.challenge` in ./styles/layout.css cancels the step's gap for the same reason, which
	// is what makes the empty case cost no space at all.
	//
	// it is on this step rather than on the one whose press spends its token, and the two screens
	// between the two are the reason: a challenge is drawn at the last moment it can be drawn
	// without the donor waiting on it, and from here it has the whole of this step's typing and the
	// review step to finish in. ./element.ts is where the arrival is watched for.
	//
	// it carries no `::part()` name. a host has nothing to style here: what appears inside is drawn
	// by the challenge provider inside its own frame, and ./parts.ts is explicit that a name absent
	// from that vocabulary is a decision rather than an oversight.
	const challenge = make(doc, 'div', { class: 'challenge' });

	const detailsHead = stepHead();
	const detailsStep = make(doc, 'section', { class: 'step step-details', hidden: true }, [
		detailsHead.head,
		emailRow,
		namesRow,
		consentRow,
		detailsContinue,
		challenge
	]);

	// ── the review step ────────────────────────────────────────────────────────────────────────

	// the provider paints its fields inside its own frame on its own origin. this is the box that
	// frame appears in, and it is empty until ./element.ts opens it — the node the frame is actually
	// mounted into is a light-DOM child of the host, projected in here through a slot, because a
	// provider's script cannot complete a mount inside a shadow root. the rail is chosen inside it
	// too — this card draws no picker of its own, because the provider's own fields collect for
	// whichever rail they are showing and a second control here would be the copy that is wrong.
	// `tabindex="-1"` so a refused press can put the caret here. it is the one thing on this step
	// with a problem and no control of ours to land on: the fields inside are the provider's, in a
	// frame on its own origin, and nothing here can reach one to focus it.
	//
	// a role and a name, because the caret landing on a bare `<div>` announces nothing at all — a
	// generic with no name is where a description goes unread and where the refusal a donor cannot
	// see would be the one refusal nobody hears. `aria-invalid` is deliberately not written here:
	// it is not a global attribute and `group` does not support it, so it would be an attribute
	// that reads as coverage and states nothing. the sentence reaches the box through
	// `aria-describedby`, which is global — and it is one of the two channels the refusal travels,
	// never the whole of it: `updatePayment` below says why the live region carries it as well.
	//
	// drawn `hidden`, which is the state of a box no provider is being prepared for: two empty rows
	// above the button that spends the money read as a form still loading something. `#openPaymentBox`
	// in ./element.ts un-hides it before it hands a provider the node to paint into, and from then on
	// the box stays in the layout — a provider mounting into a subtree with no box may never draw at
	// all, and `payment.focus()` below is a no-op on a box with no box.
	const payment = make(doc, 'div', {
		part: part('payment'),
		role: 'group',
		'aria-label': 'Payment details',
		tabindex: -1,
		hidden: true
	});
	// built empty, because more than one sentence reaches it and `updatePayment` below writes every
	// one of them. words here would be a second statement of one of the two, gone stale the first
	// time it is reworded at its own site.
	const paymentMessage = make(doc, 'p', { class: 'message', id: 'payment-problem', hidden: true });

	const submitLabel = make(doc, 'span', { class: 'action-label' });
	const submitButton = make(doc, 'button', { part: part('action', 'submit'), type: 'button' }, [
		submitLabel,
		spinner(doc)
	]);
	submitButton.addEventListener('click', () => {
		const pressedOn = now().state.step;
		now().submitButton.onClick();
		const after = now().state;
		// the same rule the Continue button above keeps, on the button that spends the money: the
		// flow refuses a press whose payer it cannot complete, and refusing silently is a button
		// that does nothing. what is missing is named here rather than guessed at by the donor.
		//
		// a refusal is a press that started on this step and left the flow on it. "the step did
		// not change" is not the same test: a second press while the charge is in flight projects
		// as `working` on both sides, and reading that as a refusal marks a card mid-transaction
		// and takes the caret off whatever the donor was looking at. that press is dropped by the
		// flow's shape (`quoting` has no `SUBMIT` handler, ./checkout.machine.ts) and needs no
		// message, because the donor has already been told something is happening.
		if (pressedOn !== 'give' || after.step !== 'give') return;
		pressed = true;
		// said on every press rather than on a press that moved the caret. two ways it does not move
		// and neither is knowable from the press: a host page's own `::part(payment)` rule outranks
		// this element's (../custom-elements.json), so a page that sets `display: none` on the box
		// leaves `focus()` a no-op the platform reports to nobody — and Safari on macOS focuses no
		// button on a click, so a mouse donor's second press re-focuses a box the caret is already on.
		// the caret landing is a channel and never the only one.
		repeated = true;
		update(now());
		// straight to the payment box, with no set to walk: the typed fields were settled on the
		// step before this one and cannot be unsettled from here, so the rail is the whole of what
		// this press can be refused for.
		payment.focus();
	});

	// the line that closes the gap the split opens: the step that takes the money shows no field
	// the donor filled in, so it states where the receipt is going and leaves the step head's mark
	// for the details step as the way to change it. it reuses the aside role rather than naming a
	// surface of its own.
	const receiptTo = make(doc, 'p', { class: 'aside', hidden: true });

	const giveHead = stepHead();
	const giveStep = make(doc, 'section', { class: 'step step-give', hidden: true }, [
		giveHead.head,
		summary,
		receiptTo,
		payment,
		paymentMessage,
		submitButton
	]);

	// ── the takeover screens ───────────────────────────────────────────────────────────────────
	//
	// one section for all of them, patched from the descriptor above. the confirm, the mandate,
	// the verification screens, the resume, success and failure are the same column of elements
	// with different words in them, and building each as its own subtree is how a node from the
	// last screen ends up on the next one.

	// `tabindex="-1"` for the reason the numbered steps' headings carry it: arriving here hides the
	// step that held focus, and a takeover the donor is never taken to is one a screen reader is
	// never told about.
	const takeoverHeading = make(doc, 'h2', { part: part('heading'), tabindex: -1 });
	const takeoverBody = make(doc, 'p', { class: 'prose', hidden: true });
	// where the receipt block is moved to, so there is one of it rather than a copy per screen.
	// the same node carrying the same figure across the two-phase confirm is what makes the total
	// the donor authorizes recognisably the one they were shown.
	const receiptSlot = make(doc, 'div', { class: 'receipt-slot', hidden: true });
	const takeoverAside = make(doc, 'p', { class: 'aside', hidden: true });
	const takeoverMethod = make(doc, 'p', { class: 'aside', hidden: true });
	const mandateText = make(doc, 'p', { class: 'mandate-text' });
	// scrollable and never a gate on the button. requiring a scroll to the bottom before the
	// control works is a keyboard trap, and what the provider requires is that the wording is
	// displayed beside an affirmative act, which pressing the button is.
	//
	// the tab stop is what a keyboard donor scrolls it with, and a focusable `<div>` is a generic
	// with no name: without the role and the label they land in the block they are being asked to
	// agree to and hear nothing. `group` rather than `region`, on the payment box's own reasoning
	// one screen back — a region is a landmark, and this card is inside a page it does not own.
	const mandateWell = make(
		doc,
		'div',
		{
			class: 'mandate',
			role: 'group',
			'aria-label': 'Payment authorization',
			tabindex: 0,
			hidden: true
		},
		[mandateText]
	);
	const deadlineBlock = make(doc, 'p', { class: 'attention', hidden: true });
	// visible text and no live region of its own: the refusal it carries is announced through the
	// card's one region (`announce` on the `failed` screen above), and a sentence that speaks from
	// here as well is the same decline read out twice.
	const failureMessage = make(doc, 'p', { class: 'message', hidden: true });

	const primaryLabel = make(doc, 'span', { class: 'action-label' });
	const primaryButton = make(
		doc,
		'button',
		{ part: part('action'), type: 'button', hidden: true },
		[primaryLabel, spinner(doc)]
	);
	const primaryNote = make(doc, 'p', { class: 'aside', hidden: true });
	const secondaryButton = make(doc, 'button', {
		part: part('action-quiet'),
		type: 'button',
		hidden: true
	});

	/** what the two takeover controls do, which is a different thing on every screen. */
	let onPrimary: (() => void) | null = null;
	let onSecondary: (() => void) | null = null;
	primaryButton.addEventListener('click', () => onPrimary?.());
	secondaryButton.addEventListener('click', () => onSecondary?.());

	const takeover = make(doc, 'section', { class: 'step takeover', hidden: true }, [
		takeoverHeading,
		takeoverBody,
		receiptSlot,
		takeoverAside,
		takeoverMethod,
		mandateWell,
		deadlineBlock,
		failureMessage,
		primaryButton,
		primaryNote,
		secondaryButton
	]);

	// ── the card ───────────────────────────────────────────────────────────────────────────────

	// the padded interior, and the card's only child.
	//
	// a `<form>`, so Enter finishes a text field here the way it does in every other form a donor
	// has ever filled in: the platform's own implicit submission presses the form's default button,
	// which is the first submit button in it in tree order
	// (https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#implicit-submission).
	// `update` below is what keeps exactly one of those on the card at a time, and it is the primary
	// of the screen being shown — every other control this card draws states `type="button"` where
	// it is built, because a `<button>` inside a form with no type stated is a submit button and
	// would take the keystroke instead.
	//
	// it is given no accessible name, which is what keeps it off the accessibility tree as a `form`
	// landmark. this card is dropped into pages with forms of their own, and a second one announced
	// there is a landmark a reader has to step past.
	//
	// `novalidate`, so no field of ours is ever answered by the engine's own bubble — drawn in the
	// browser's language, over a card that says what is wrong in the org's. `required` and `pattern`
	// are still written onto the fields (`updateDetails`), because the sentence a field shows is
	// chosen off the `validity` they produce.
	const body = make(doc, 'form', { class: 'card-body', novalidate: true }, [
		amountStep,
		detailsStep,
		giveStep,
		takeover
	]);
	// nothing is ever posted from here — the flow is what takes the gift — so the submission is
	// cancelled on every screen, including the ones with no primary to route it to. the event is not
	// composed and stops at the shadow root besides, so a host page's own form is neither told about
	// this one nor submitted by it.
	body.addEventListener('submit', (event) => event.preventDefault());
	// the region the announcements go to is not inside it. it belongs to the element and outlives
	// this card (`createAnnouncer` below), which also keeps it outside whatever carries `aria-busy`
	// while the flow works — a live region under a busy ancestor is one assistive technology is told
	// to hold, and holding it silences exactly the wait it exists to narrate.

	/**
	 * where focus goes when the card changes screen, one per screen.
	 *
	 * keyed by `Screen` rather than by state, so a fifth screen is a type error here rather than a
	 * transition that silently drops focus onto the document body.
	 */
	const headings: Record<Screen, HTMLElement> = {
		amount: amountHead.heading,
		details: detailsHead.heading,
		give: giveHead.heading,
		takeover: takeoverHeading
	};

	// every word on this card is English and `config.locale` never changes one — it reaches `Intl`
	// for the digits and the dates (`formatDate` above, ./money.ts) and no sentence. so the tree
	// declares the language its own strings are written in rather than the host's: dropped into an
	// `<html lang="es">` page, an undeclared shadow tree is a card spoken with Spanish phonetics.
	// never on the host element, whose attributes belong to whoever pasted the snippet.
	const root = make(doc, 'div', { part: part('card'), lang: 'en' }, [body]);

	// ── the options, built from the first projection ────────────────────────────────────────────

	function buildOptions(
		track: HTMLElement,
		into: { label: HTMLElement; input: HTMLInputElement }[],
		props: GroupProps,
		render: (option: Option, input: HTMLInputElement) => HTMLElement,
		read: (api: DomApi) => GroupProps,
		/**
		 * what pressing an option means beyond the decision it sends, where a group has one.
		 *
		 * a press and not a repaint: `updateOptions` below lights an option by assigning `checked`,
		 * which fires no `change` at all, so nothing here runs on an option the projection chose.
		 */
		onPress?: (option: Option) => void
	): void {
		props.options.forEach((option, index) => {
			const input = make(doc, 'input', {
				type: 'radio',
				name: props.name,
				value: String(option.value)
			});
			input.addEventListener('change', () => {
				if (!input.checked) return;
				onPress?.(option);
				read(now()).options[index]?.onChange();
			});
			const label = render(option, input);
			into.push({ label, input });
			put(doc, track, [label]);
		});
	}

	function build(api: DomApi): void {
		// nothing where the cadence is settled: the group is not in the step, so options built into
		// it would be radios in a detached track and `firstAmountProblem` would send a refused press
		// at one.
		if (chooses) {
			buildOptions(
				frequencyTrack,
				frequencyOptions,
				api.frequencyGroup,
				(option, input) =>
					make(doc, 'label', { part: part('frequency-option') }, [
						input,
						make(doc, 'span', {}, [option.label ?? String(option.value)])
					]),
				(next) => next.frequencyGroup
			);
		}

		// one suggestion is no choice: a tray with one tile and an other tile beside it offers a
		// press that changes nothing, so a form suggesting one amount draws the box alone with that
		// figure already in it, and a form suggesting none draws the box alone and empty. either way
		// the tray is bare — the box stands on the card as every other field does (`.bare` in
		// ./styles/parts.css) — and the flow still holds the one figure (`settledDraft` in
		// ./checkout.machine.ts), which is what the box was written from.
		const tiled = api.amountGroup.options.length > 1;
		amountTiles.classList.toggle('bare', !tiled);
		const sole = api.amountGroup.options[0];
		if (!tiled && sole !== undefined) setValue(entryInput, figure(Number(sole.value)));
		if (tiled)
			buildOptions(
				amountTiles,
				amountOptions,
				api.amountGroup,
				(option, input) =>
					make(doc, 'label', { part: part('amount-option') }, [
						input,
						// the offer's own formatting, which is the one figure on this card that drops a zero
						// fraction: `$25` is what the org is suggesting and `$25.00` is what a row states.
						make(doc, 'span', {}, [offer(Number(option.value))])
					]),
				(next) => next.amountGroup,
				// the amount is one decision, so the press writes its own figure into the box below. the
				// tiles and the box are two views of one number — `AmountDraft` (../value.ts) carries one
				// `amountMinor` and no record of which control set it — and this is the second of them
				// catching up with the first, in the formatting a donor typing that amount would have
				// produced (`formatFigure` in ./money.ts).
				//
				// on the press rather than on the patch, and that is the whole of why it is here: a
				// donor typing a figure a preset already offers lights that preset, which is
				// programmatic and fires no `change` — a box written wherever a preset reads as checked
				// would reformat under them mid-word.
				(option) => {
					otherChosen = false;
					setValue(entryInput, figure(Number(option.value)));
				}
			);
		if (tiled) {
			const input = make(doc, 'input', { type: 'radio', name: api.amountGroup.name, value: '' });
			input.addEventListener('change', () => {
				if (!input.checked) return;
				otherChosen = true;
				// whatever a preset wrote into the box is not what the donor is about to type, and a
				// figure left standing there is a gift the next press would charge.
				setValue(entryInput, '');
				now().amountGroup.onTyped?.(null);
				// repainted here rather than left to the flow: a box already empty sends the flow
				// nothing new, and the entry has to be shown before the caret can land in it.
				update(now());
				entryInput.focus();
			});
			const label = make(doc, 'label', { part: part('amount-option'), class: 'other' }, [
				input,
				make(doc, 'span', {}, ['Other'])
			]);
			otherTile = { label, input };
			put(doc, amountTiles, [label]);
		}
		// the entry is the last box on the tray, opened under the other tile (`update` below), so
		// the amount is one decision in one place rather than a row of shortcuts with an escape
		// hatch under it.
		put(doc, amountTiles, [entryTile]);

		// the causes, off the projection for the reason the kind's options below are: which causes a
		// form offers is the configuration's answer, and a list read out of `config` here would be
		// that answer derived a second time on a page nobody here can reach.
		put(
			doc,
			programSelect,
			api.programSelect.options.map((option) =>
				make(doc, 'option', { value: option.value }, [option.label])
			)
		);

		// the kind's options, off the projection like every other set of choices on this card. the
		// vocabulary is fixed and this file could have spelled it out, which is exactly what the
		// header refuses: a list typed here is the same answer derived twice, and the second copy is
		// the one on a page nobody here can reach.
		put(
			doc,
			tributeKindSelect,
			api.tributeKindSelect.options.map((option) =>
				make(doc, 'option', { value: option.value }, [option.label])
			)
		);
	}

	// ── the patch ──────────────────────────────────────────────────────────────────────────────

	/**
	 * where the chip stood after the last patch, or `null` while nothing has been chosen.
	 *
	 * kept so the next patch can tell a move along a row from a move across a wrap, which is the one
	 * thing the chip may not travel over (`.segment[data-sliding]::before` in ./styles/motion.css).
	 */
	let chipAt: { readonly x: number; readonly y: number } | null = null;

	/**
	 * the chip put where the chosen cadence stands, and told whether it travelled there.
	 *
	 * the geometry is read off the option's own used box rather than computed from a count: the
	 * track flex-wraps, how many cadences it holds is the deployment's, and how much width it was
	 * given is the host page's. `offsetLeft` and `offsetTop` are measured from the track's padding
	 * edge, which is the same edge the chip is anchored to, so no border width enters the
	 * arithmetic.
	 *
	 * the wrap is read the same way, off `offsetTop` rather than off the cadence count: a chip
	 * crossing rows would travel diagonally over two other options on its way, so that move is
	 * written with the transition off and the chip is simply somewhere else on the next frame.
	 * setting the attribute and the position in one task is what makes that a jump — style is
	 * recomputed once, after both, and the transition is not in force when the value changes.
	 *
	 * the chip is placed on every patch, and on the window changing size — a phone turning, a browser
	 * window dragged — which is the one rewrap this card can hear and the overwhelming majority of
	 * what rewraps a card in the wild. `jump` is what that caller passes: the options moved rather
	 * than the choice, and a chip that travelled to catch up would be reporting a decision the donor
	 * did not make.
	 *
	 * what is left uncovered is a host resizing the card while the window holds still — a sidebar
	 * collapsing, an accordion opening around the embed — where the chip stays as the old layout left
	 * it until the donor's next keystroke patches the card. that hole is measured and accepted rather
	 * than missed. a `ResizeObserver` on the track closes it and may not be used: the track is inside
	 * this card's own container-query container, and observing anything in one makes chromium give up
	 * on settling the frame and report "ResizeObserver loop completed with undelivered notifications"
	 * on the host page's `window.onerror` — with the callback empty and deferred to the next frame
	 * alike, which is measured rather than assumed. this component is a guest in a document it does
	 * not own and does not get to put errors in somebody else's reporting, so a chip briefly out of
	 * place on one class of resize is the cheaper of the two.
	 */
	function placeThumb(jump = false): void {
		const chosen = frequencyOptions.find((option) => option.input.checked)?.label;
		if (chosen === undefined) {
			toggleAttribute(frequencyTrack, 'data-thumb', null);
			toggleAttribute(frequencyTrack, 'data-sliding', null);
			chipAt = null;
			return;
		}
		const x = chosen.offsetLeft;
		const y = chosen.offsetTop;
		// a travel is a move that stays on the row it started on. the first chip of all is not a
		// travel either — there is nowhere it came from — so `chipAt` being null is a jump.
		const travels = !jump && chipAt?.y === y && chipAt.x !== x;
		toggleAttribute(frequencyTrack, 'data-sliding', travels ? '' : null);
		frequencyTrack.style.setProperty('--_thumb-x', `${x}px`);
		frequencyTrack.style.setProperty('--_thumb-y', `${y}px`);
		frequencyTrack.style.setProperty('--_thumb-w', `${chosen.offsetWidth}px`);
		frequencyTrack.style.setProperty('--_thumb-h', `${chosen.offsetHeight}px`);
		toggleAttribute(frequencyTrack, 'data-thumb', '');
		chipAt = { x, y };
	}

	/**
	 * the window changing size, answered on the next paint rather than in the handler.
	 *
	 * a `resize` fires at the frame rate of a drag, and the work here reads layout and writes back
	 * into it — done inline that is a forced reflow per event on a page this element does not own.
	 * coalescing to one frame is what keeps a drag to one reflow each, and it is safe in the way a
	 * `ResizeObserver` was not: nothing this writes can resize the window, so there is no loop to
	 * report.
	 *
	 * a track with no layout box is skipped rather than measured. every step but the one on screen is
	 * `display: none`, so a resize while the donor is on a later step would otherwise write zeroes
	 * into the chip's position and hold them until they came back.
	 */
	let repositioning = 0;
	const view = doc.defaultView;
	const rewrapped = (): void => {
		if (view === null || repositioning !== 0 || amountStep.offsetParent === null) return;
		repositioning = view.requestAnimationFrame(() => {
			repositioning = 0;
			if (chooses) placeThumb(true);
			markRows();
		});
	};
	view?.addEventListener('resize', rewrapped);

	/**
	 * which tile opens a row of the amount grid, and how many columns the grid came out with —
	 * written so the tray can rule its lattice (the grid-line rules in ./styles/parts.css).
	 *
	 * where the grid wraps is the engine's answer and no stylesheet can ask it, so both are read
	 * here off the tiles' own laid-out boxes: a tile whose top differs from the one before it opens
	 * a row and is marked `data-row-start`, which is what draws the horizontal above that row, and
	 * the tiles sharing the first top are the columns, written onto the tray as `--_cols`, which
	 * is the pitch its verticals repeat at. read on every patch and on the window resizing, the
	 * same two moments the chip is placed at, and for the same reason a `ResizeObserver` is not
	 * used for either (`placeThumb` above).
	 *
	 * a tray with no tiles writes no count at all: the rule divides by it, and the fallback stated
	 * there is what a tray with nothing to rule takes.
	 */
	function markRows(): void {
		if (amountStep.offsetParent === null) return;
		const labels = [
			...amountOptions.map(({ label }) => label),
			...(otherTile === null ? [] : [otherTile.label])
		];
		const first = labels[0]?.offsetTop;
		let above: number | null = null;
		let cols = 0;
		for (const label of labels) {
			toggleAttribute(label, 'data-row-start', label.offsetTop !== above ? '' : null);
			if (label.offsetTop === first) cols += 1;
			above = label.offsetTop;
		}
		if (cols === 0) amountTiles.style.removeProperty('--_cols');
		else amountTiles.style.setProperty('--_cols', String(cols));
	}

	function updateOptions(
		nodes: readonly { label: HTMLElement; input: HTMLInputElement }[],
		props: GroupProps,
		name: 'frequency-option' | 'amount-option',
		invalid: boolean,
		/** whether an option the projection marks is drawn as chosen; the amount group says no while the other tile holds. */
		chosen: (option: Option) => boolean = (option) => option.checked
	): void {
		nodes.forEach((node, index) => {
			const option = props.options[index];
			if (option === undefined) return;
			const checked = chosen(option);
			if (node.input.checked !== checked) node.input.checked = checked;
			toggleAttribute(node.label, 'part', partWhen(name, { selected: checked, invalid }));
		});
	}

	function update(api: DomApi): void {
		current = api;
		const step = visibleStep(api, shown);
		const busy = api.continueButton['aria-busy'];
		const screen = step === 'takeover' ? takeoverFor(api.state, config, money) : BLANK;

		// which way the flow moved, which is the only thing the entry motion reports. a donor must
		// know Back returned them rather than advanced them, and the screens are ordered, so their
		// order is the answer rather than a second record of where the donor has been.
		toggleAttribute(
			root,
			'data-direction',
			SCREENS.indexOf(step) < SCREENS.indexOf(shown) ? 'back' : null
		);
		// and whether it has moved at all. the first screen a donor sees is not a transition from
		// anything, so ./styles/motion.css gates every entry animation on this rather than letting
		// the card arrive with a flourish inside a page that has already finished laying out.
		// a screen change is also where focus has to be put back. hiding a step hides the control the
		// donor pressed, and focus falls to the document body with nothing announced — over three
		// steps that would happen twice per gift, and again on every takeover. the first paint is not
		// a change: a resume boots straight onto a takeover, and an element that grabbed focus while
		// rendering would move the caret on a page it does not own.
		const advanced = painted && step !== shown;
		if (step !== shown) moved = true;
		toggleAttribute(root, 'data-moved', moved ? '' : null);
		shown = step;

		setHidden(amountStep, step !== 'amount');
		setHidden(detailsStep, step !== 'details');
		setHidden(giveStep, step !== 'give');
		setHidden(takeover, step !== 'takeover');
		// the one control Enter reaches, and it is the primary of the screen being shown. the
		// default button is the first submit button in the form in tree order whether its step is
		// `hidden` or not, so a control left as one behind the screen would take the keystroke a
		// donor pressed in front of it — the amount step's Continue answering a press made in the
		// email field. `paintTakeover` holds the fourth screen to the same rule.
		toggleAttribute(continueButton, 'type', step === 'amount' ? 'submit' : 'button');
		toggleAttribute(detailsContinue, 'type', step === 'details' ? 'submit' : 'button');
		toggleAttribute(submitButton, 'type', step === 'give' ? 'submit' : 'button');
		// what the marks are offering, patched on every snapshot rather than settled at build: what
		// a donor has completed moves as they type, so a step shut on arrival opens under them
		// without the screen changing. the mark for the step a head belongs to is a `<span>` in that
		// head and appears in no other, so nothing here ever reaches one.
		for (const mark of stepMarks) {
			toggleAttribute(
				mark.node,
				'aria-disabled',
				api.stepButtons[mark.at]?.available === true ? null : 'true'
			);
		}
		// on the interior rather than on the card, and the live region is why: `aria-busy` over a
		// region is an instruction to hold its changes back until the flag clears, and the words for
		// the wait are written into that region in this same patch. marked on the card, which is the
		// announcer's ancestor, the one thing a donor who cannot see the spinner has is silenced by
		// the flag meant to tell them. the interior is also what is actually working — the identity
		// block under it never is.
		toggleAttribute(body, 'aria-busy', busy ? 'true' : null);

		paintTakeover(screen, busy);

		// the press is forgotten on the way off the step, the way `updateDetails` and `updatePayment`
		// below forget theirs: asking is a thing a press does, and returning to a step is not a press.
		// without it a donor refused once carries the mark for the life of the card.
		if (api.state.step !== 'amount') asked = false;
		// the amount step reports a missing decision only once a press has asked for one, and then
		// reports every one it is missing rather than the first.
		const missing = asked ? missingDecisions(api) : [];
		const missingAmount = missing.includes('amount');
		// the note is one of them, and the same rule governs it: the mark appears on the press that
		// was refused for it, clears on the keystroke that satisfies it, and clears again the moment
		// the donor unticks — which is what takes the decision out of `state.missing` altogether.
		const missingNote = missing.includes('note');
		setHidden(amountMessage, !missingAmount);
		setHidden(noteMessage, !missingNote);
		toggleAttribute(amountGroup, 'aria-describedby', missingAmount ? 'amount-problem' : null);
		// beside the part token rather than instead of it: the token is what a host's stylesheet
		// paints, and this is what a screen reader is told, so a donor who cannot see the edge is
		// not left with the sentence alone. it is written only where the role supports it — the free
		// entry's text box — because an `aria-invalid` on a role that does not take it is an
		// attribute nobody is read, and the amount group's own role is the one a fieldset already
		// has.
		toggleAttribute(entryInput, 'aria-invalid', missingAmount ? 'true' : null);
		// the note takes all three, the way a give-step field does: it is a single control with a
		// role that supports the state and a sentence of its own to be described by.
		toggleAttribute(noteField, 'part', partWhen('field', { invalid: missingNote }));
		toggleAttribute(noteField, 'aria-invalid', missingNote ? 'true' : null);
		toggleAttribute(noteField, 'aria-describedby', missingNote ? 'note-problem' : null);

		// never invalid: a cadence is chosen from the first paint and cannot be taken back, so this
		// group has no refused state to draw.
		updateOptions(frequencyOptions, api.frequencyGroup, 'frequency-option', false);
		// a figure the flow holds that no preset equals is the other way already taken — a resume,
		// or a donor coming back to this step — so the box holding it is not closed over it.
		const typed = parseMinor(entryInput.value, locale, currency) !== null;
		const presetMatch = api.amountGroup.options.some((option) => option.checked);
		if (otherTile !== null && typed && !presetMatch) otherChosen = true;
		const otherHolds = otherTile !== null && otherChosen;
		updateOptions(
			amountOptions,
			api.amountGroup,
			'amount-option',
			missingAmount,
			(option) => option.checked && !otherHolds
		);
		if (otherTile !== null) {
			if (otherTile.input.checked !== otherHolds) otherTile.input.checked = otherHolds;
			toggleAttribute(
				otherTile.label,
				'part',
				partWhen('amount-option', { selected: otherHolds, invalid: missingAmount })
			);
		}
		// after the options are marked, because the chip is placed off the box the chosen one was
		// laid out in and the token that says which one it is has just been written.
		if (chooses) placeThumb();
		markRows();

		// the free entry is shown while the other tile holds, and always where there is no other
		// tile; it reads as chosen when it holds the amount, which on a tray with tiles is the other
		// tile's say and on a box standing alone is whether a figure is in it.
		setHidden(entryTile, otherTile !== null && !otherChosen);
		toggleAttribute(
			entryTile,
			'part',
			partWhen('amount-input', {
				selected: typed && (otherTile === null || otherHolds),
				invalid: missingAmount
			})
		);

		// the disclosure is the flow's, so the box and the row it opens are both patched from the
		// projection. a donor who went on to a later step and came back finds the note they asked
		// for still open, holding what they had written.
		const noteAsked = api.noteToggle.pressed === true;
		if (noteToggle.checked !== noteAsked) noteToggle.checked = noteAsked;
		setHidden(noteBody, !noteAsked);

		// the second disclosure on this step, patched from the projection exactly as the first is.
		const tributeAsked = api.tributeToggle.pressed === true;
		if (tributeToggle.checked !== tributeAsked) tributeToggle.checked = tributeAsked;
		setHidden(tributeBody, !tributeAsked);
		updateTribute(api, missing);

		setValue(noteField, api.noteField.value);
		// never invalid, for the tribute select's reason: it rests on an answer and a donor cannot
		// empty it, so there is no state here for a mark to report.
		setValue(programSelect, api.programSelect.value);
		setValue(emailField, api.emailField.value);
		setValue(firstNameField, api.firstNameField.value);
		setValue(lastNameField, api.lastNameField.value);
		if (consentToggle.checked !== (api.consentToggle.pressed ?? false)) {
			consentToggle.checked = api.consentToggle.pressed ?? false;
		}

		// after the values above, because the sentence a field shows is chosen off the value the
		// control is holding at the time it is read.
		const missingFields = updateDetails(api);
		const refusedPayment = updatePayment(api);
		// what a numbered step was refused for, said out loud, and one sentence however many steps
		// there are: the three are mutually exclusive, because a press is refused on the step it was
		// made on. every missing decision at once, for the reason `missingDecisions` above gives
		// about naming them one press at a time.
		//
		// the amount step's two hang off a `<fieldset>` and the refused press puts the caret on a
		// radio inside one — a group's description is not reliably announced from a descendant, so
		// that refusal is on this channel however the press was made. the details step's are on the
		// fields themselves and a field announces itself on arrival, so its sentence is here only
		// for the press that moved no caret and had no other channel — `unmoved`, decided by the
		// press rather than by this patch.
		//
		// the note is not among them: its sentence is on the control itself, and the caret lands
		// there where it is the decision the press was refused for. a copy here would be twice.
		const askedFor = [missingAmount ? amountProblem : '', unmoved ? missingFields : '']
			.filter((sentence) => sentence !== '')
			.join(', ');

		for (const node of [continueButton, detailsContinue]) {
			toggleAttribute(node, 'aria-busy', busy ? 'true' : null);
			toggleAttribute(node, 'part', partWhen('action', { busy }));
		}
		toggleAttribute(submitButton, 'aria-busy', busy ? 'true' : null);
		toggleAttribute(submitButton, 'part', partWhen('action', { submit: true, busy }));

		// the one figure the flow is entitled to draw a donor's eye back to: a total that is not the
		// one they pressed Donate on. it is exactly the correction screen, which is the only screen
		// reached where the two differ — so the mark and the screen say the same thing once.
		//
		// and the one screen where the figure is drawn to the eye is the one where it is taken off the
		// ear. `aria-live` overrides what the tag's own `role="status"` sets, so this turns the region
		// off for exactly that screen: the announcer states both figures there — "It is now X, not Y" —
		// and a total speaking under that sentence is the new figure read out twice, to the donor who
		// has just been told it moved. off the same test as the mark, so the two cannot come to
		// disagree about which screen they mean.
		const corrected = api.state.step === 'confirm';
		toggleAttribute(totalFigure, 'data-changed', corrected ? '' : null);
		toggleAttribute(totalFigure, 'aria-live', corrected ? 'off' : null);

		const totalWords = updateSummary(api, screen);

		// after the receipt rather than before it, because one of the sentences below is the receipt's
		// own total and a figure said out loud before it is written is a figure from the patch before.
		//
		// the takeover's own words first: a screen that has taken the whole card is not one a numbered
		// step is still asking anything on. the review step's refusal is on this channel as well as on
		// the box the caret is sent to — `updatePayment` above says why both — and it stands ahead of
		// the fee decision because it is a thing the donor has been asked for and has not done: a
		// sentence written over it is the ask disappearing, and the next patch to write it back would
		// announce it again with nobody having pressed anything.
		//
		// then the fee decision, which is the one press on this card that changes the money without
		// moving the caret or the screen — a donor watching the control they just pressed is the donor
		// least likely to see the figure that moved.
		say(
			screen.announce !== ''
				? screen.announce
				: askedFor !== ''
					? askedFor
					: refusedPayment
						? PAYMENT_PROBLEM
						: flipped
							? totalWords
							: busy
								? workingWords(api.state)
								: '',
			repeated
		);
		repeated = false;
		unmoved = false;
		flipped = false;

		// last, and after the step it lands in has been un-hidden: a heading inside a `hidden`
		// subtree is not focusable, and a caret that failed to land is the defect this exists for.
		if (advanced) headings[step].focus();
		painted = true;
	}

	/**
	 * the details step's fields, and what the flow could not accept about them.
	 *
	 * which field is marked is the flow's answer, off `state.missing`, and never the control's.
	 * the engine is asked one question — `validity`, for which of the rules the value broke — and
	 * that only chooses the words. the rules themselves are set from the projection rather than
	 * typed in above: ./connect.ts is where a field is declared required and what its pattern is,
	 * and this is where that reaches the control. nothing here calls `reportValidity()`, whose
	 * bubble is drawn by the browser in the browser's language and cannot be styled at all.
	 *
	 * silent until a press has asked. the edge and the sentence appear together on the Continue that
	 * was refused, and each clears the moment its own field is fixed. the edge is the `invalid`
	 * part token written below and nothing else selects it: ./styles/parts.css paints from that
	 * token alone, so what is red on the card is what this function called missing.
	 *
	 * one refusal, one channel, and this returns the words for the channel that is not the caret:
	 * every sentence the press was refused for, joined. each field carries its own by
	 * `aria-describedby` and announces it on arrival, so a press that moves the caret has said the
	 * refusal already — and `update` above puts these words on the region only for a press that
	 * moved no caret, which is the press with nothing else to say them. the Continue handler is
	 * where the two are told apart, because only the press knows where the caret was.
	 *
	 * the amount step's `askedFor` is the same sentence built the same way and is said on every
	 * press, because there the caret lands on a radio inside a `<fieldset>` and a group's
	 * description is not reliably announced from a descendant.
	 */
	/**
	 * the tribute's four boxes: what they hold, the rules they carry, and what the flow could not
	 * accept about them.
	 *
	 * `missing` is the set the step is already reporting rather than a second reading of it, so the
	 * gating this block inherits is the step's own: it is `[]` until a press has asked, which is
	 * what keeps a donor who has just opened the disclosure from being scolded for not having typed
	 * yet. the marks then clear on the keystroke that satisfies them, and clear again the moment the
	 * disclosure is closed — closing takes every one of these decisions out of the set.
	 *
	 * the caps are set from the projection rather than typed in here, the way `updateDetails` below
	 * sets `required` and `pattern`: ./connect.ts is where a box's cap is declared and this is where
	 * it reaches the control. they are the endpoint's own numbers
	 * (`MAX_TRIBUTE_NAME`/`MAX_TRIBUTE_EMAIL` in ./value.ts), so a paste is truncated where it
	 * happens instead of refused after the donor has moved on.
	 *
	 * the sentences are not joined onto the live region, for the reason the note's is not: each is
	 * on the control it is about and the caret lands there where it is what the press was refused
	 * for, so a copy on the region would be the same refusal said twice.
	 */
	function updateTribute(api: DomApi, missing: readonly AmountDecision[]): void {
		const props: readonly FieldProps[] = [
			api.tributeHonoreeField,
			api.tributeNotifyNameField,
			api.tributeNotifyEmailField
		];
		tributeBoxes.forEach((entry, index) => {
			const field = props[index];
			if (field === undefined) return;
			toggleAttribute(
				entry.field,
				'maxlength',
				field.maxLength === undefined ? null : String(field.maxLength)
			);
			setValue(entry.field, field.value);

			const wrong = missing.includes(entry.key);
			setHidden(entry.message, !wrong);
			toggleAttribute(entry.field, 'part', partWhen('field', { invalid: wrong }));
			toggleAttribute(entry.field, 'aria-invalid', wrong ? 'true' : null);
			toggleAttribute(entry.field, 'aria-describedby', wrong ? entry.problemId : null);
		});

		// the select is never invalid: it holds one of two options at rest and a donor cannot empty
		// it, so there is no state for a mark to report. assigned rather than compared for the reason
		// the value fields are — writing the value it already holds is what a patch does.
		setValue(tributeKindSelect, api.tributeKindSelect.value);

		// the notify pair, open on the donor's press or on a gift that already names someone.
		const asked =
			notifyAsked ||
			api.tributeNotifyNameField.value.trim() !== '' ||
			api.tributeNotifyEmailField.value.trim() !== '';
		setHidden(tributeNotifyRow, !asked);
		setText(tributeNotifyOpen, asked ? NOTIFY_OPEN : NOTIFY_SHUT);
		toggleAttribute(tributeNotifyOpen, 'aria-expanded', asked ? 'true' : 'false');
	}

	function updateDetails(api: DomApi): string {
		toggleAttribute(emailField, 'required', api.emailField.required === true ? '' : null);
		toggleAttribute(firstNameField, 'required', api.firstNameField.required === true ? '' : null);
		toggleAttribute(lastNameField, 'required', api.lastNameField.required === true ? '' : null);
		toggleAttribute(firstNameField, 'pattern', api.firstNameField.pattern ?? null);
		toggleAttribute(lastNameField, 'pattern', api.lastNameField.pattern ?? null);

		// the press is forgotten on the way off the step, so a donor who was refused, went Back and
		// came round again meets the card they left rather than the marks from last time. asking is
		// a thing a press does, and returning to a step is not a press.
		if (api.state.step !== 'details') attempted = false;
		const asking = attempted && api.state.step === 'details' ? api.state : null;

		const said: string[] = [];
		for (const entry of detailsFields) {
			const wrong = asking?.missing.includes(entry.key) ?? false;
			const words = wrong ? entry.wording(entry.field.validity) : '';
			setText(entry.message, words);
			setHidden(entry.message, !wrong);
			toggleAttribute(entry.field, 'part', partWhen('field', { invalid: wrong }));
			toggleAttribute(entry.field, 'aria-invalid', wrong ? 'true' : null);
			toggleAttribute(entry.field, 'aria-describedby', wrong ? entry.problemId : null);
			if (words !== '') said.push(words);
		}
		// in the order the fields are asked in, which is the order they are laid out in and the order
		// the caret walks them — `detailsFields` is filled as the rows are built.
		return said.join(', ');
	}

	/**
	 * everything the payment box says about itself, and whether a press was refused for the rail.
	 *
	 * one owner for one node. two sentences reach it — the refusal a press on this step was given,
	 * and the reason a rail gave for the gift that was already tried — and a second writer would be
	 * two functions taking turns hiding each other's words.
	 *
	 * the refusal is two channels, and the answer this returns is what puts it on the second. the
	 * caret is sent to the payment box, which carries a role, a name and this sentence by
	 * `aria-describedby`, so arriving there is one announcement — but arriving is what a donor
	 * pressing a second time in Safari never does, and a box a host page has taken off the screen is
	 * never arrived at either. so the region carries it too, on every press, which is what the Donate
	 * handler above asks for by saying the sentence again rather than by writing it twice.
	 *
	 * read off the same answer the flow's own guard reads — `payerIsComplete` in
	 * ./checkout.machine.ts, projected as `payerComplete` — rather than off `payable`, which is the
	 * rail alone. the two disagree wherever a press is refused for anything but the rail, and there
	 * the caret lands on a group with nothing said about why.
	 *
	 * silent until a press has asked, on the same terms the details step's marks are. the carried
	 * decline is not: nothing on this step was pressed to earn it, and the press that did is on a
	 * screen the donor has already left.
	 *
	 * the refusal outranks the decline where both stand. the refusal names something the donor can
	 * do next; the decline names what happened last.
	 */
	function updatePayment(api: DomApi): boolean {
		const { state } = api;
		if (state.step !== 'give') pressed = false;
		const refused = pressed && state.step === 'give' && !state.payerComplete;
		carryDecline(state);
		// written only on the step this box is on. the node is inside the review step and every
		// other screen hides that step, so a sentence written here off it is one kept quiet by the
		// layout rather than by this function — and the next thing to un-hide a step for a reason of
		// its own would put a refusal on a screen that has nothing to do with it.
		const words = state.step !== 'give' ? '' : refused ? PAYMENT_PROBLEM : declined;
		setText(paymentMessage, words);
		setHidden(paymentMessage, words === '');
		toggleAttribute(payment, 'aria-describedby', words === '' ? null : 'payment-problem');
		return refused;
	}

	/**
	 * the reason a rail refused, taken off the takeover and kept for the step the retry lands on.
	 *
	 * kept here because the flow does not keep it: `RETRY` targets a step and the entry to that step
	 * clears the failure it was retried from (`beginAttempt` in ./checkout.machine.ts), which is the
	 * right thing for a flow about to mint a second intent and the wrong thing for a donor who has
	 * just pressed Try again. without this they land at the payment box with nothing on the card
	 * saying the card was refused, and the press reads as having done nothing.
	 *
	 * only a rail's refusal is taken. ten of the eleven ways into `failed` are a quote that could
	 * not be minted, a payment surface that never drew, a challenge that could not be shown or a
	 * port that did not answer — none of them a statement about the card the donor entered, and all
	 * of them read as one beside the payment fields, over a box retyping cannot fix. `refusedByRail`
	 * (./connect.ts) is what says which, and the words cannot: a rejected quote arrives carrying a
	 * bare sentence and no `fix`, which is the shape a decline arrives in too.
	 *
	 * only the review step shows it. `RETRY` can land on either of the earlier steps as well
	 * (`failed` in ./checkout.machine.ts), and there the decision the donor is being asked for is a
	 * frequency or an email rather than the details a rail turned down.
	 *
	 * it is dropped on the way off the step, which is what keeps it off every screen after: the
	 * takeover is patched from a descriptor with no node conditional on the screen being painted
	 * (`paintTakeover` below) precisely so a failure cannot survive onto the thank-you, and a
	 * sentence held on the review step under it would be the same defect one node along.
	 *
	 * `payable` is the whole of what this layer can read the rail off — the provider's picker is in
	 * a frame on its own origin and the projection carries no rail on this step (`State` in
	 * ./connect.ts) — so a picker emptied or refilled clears the sentence and a donor moving between
	 * two rails it can charge keeps it until they press.
	 */
	function carryDecline(state: State): void {
		if (state.step === 'failed') {
			declined = state.refusedByRail === true ? state.message : '';
			declinedOn = null;
			return;
		}
		if (state.step !== 'give') {
			declined = '';
			declinedOn = null;
			return;
		}
		if (declinedOn === null) declinedOn = state.payable;
		else if (state.payable !== declinedOn) declined = '';
	}

	/**
	 * the takeover, patched from its descriptor.
	 *
	 * total over the record rather than over the state, so every node is written on every screen —
	 * the failure message from a declined card cannot survive onto the success screen because
	 * nothing here is conditional on which screen is being painted.
	 */
	function paintTakeover(screen: Takeover, busy: boolean): void {
		setText(takeoverHeading, screen.heading);
		setHidden(takeoverHeading, screen.heading === '');
		setText(takeoverBody, screen.body);
		setHidden(takeoverBody, screen.body === '');
		setText(takeoverAside, screen.aside);
		setHidden(takeoverAside, screen.aside === '');
		setText(takeoverMethod, screen.method === '' ? '' : `Paying by ${screen.method}`);
		setHidden(takeoverMethod, screen.method === '');
		setText(mandateText, screen.mandate);
		setHidden(mandateWell, screen.mandate === '');
		setText(deadlineBlock, screen.deadline);
		setHidden(deadlineBlock, screen.deadline === '');
		setText(failureMessage, screen.failure);
		setHidden(failureMessage, screen.failure === '');
		setText(primaryNote, screen.primaryNote);
		setHidden(primaryNote, screen.primaryNote === '');

		// the receipt is moved rather than copied. one node carrying one figure from the review step
		// through a correction and on into whatever the donor leaves on is what makes the total
		// being authorized recognisably the one just seen — a second block rendered from the same
		// numbers would not be.
		const wanted = screen.receipt !== 'none' && receiptWritten;
		setHidden(receiptSlot, !wanted);
		const home = wanted ? receiptSlot : giveStep;
		if (summary.parentElement !== home) {
			if (home === giveStep) giveStep.insertBefore(summary, receiptTo);
			else put(doc, home, [summary]);
		}

		setText(primaryLabel, screen.primary?.label ?? '');
		setHidden(primaryButton, screen.primary === null);
		// Enter reaches this control only where the screen says the press submits the gift. the two
		// recovery screens' primaries start a gift over rather than send one, and a keystroke that
		// pressed one of those would restart a donor who was reading the refusal.
		toggleAttribute(primaryButton, 'type', screen.primary?.submit === true ? 'submit' : 'button');
		toggleAttribute(primaryButton, 'aria-busy', busy ? 'true' : null);
		toggleAttribute(
			primaryButton,
			'part',
			partWhen('action', { submit: screen.primary?.submit === true, busy })
		);
		setText(secondaryButton, screen.secondary?.label ?? '');
		setHidden(secondaryButton, screen.secondary === null);

		// the two controls carry a different event on every screen, so what they send is read off
		// the state at press time rather than bound once per node. a press that lands after the
		// flow has moved on is an event the machine does not handle, which is where it stops.
		onPrimary = () => {
			const step = now().state.step;
			if (step === 'confirm') now().confirmButton.onClick();
			else if (step === 'mandate') now().acceptMandateButton.onClick();
			else now().retryButton.onClick();
		};
		onSecondary = () => {
			const step = now().state.step;
			if (step === 'mandate') now().declineMandateButton.onClick();
			// `success` is terminal and is given no way out (./checkout.machine.ts), so the second
			// gift is a new card rather than an event. it starts empty: this form is embedded on
			// pages nobody here can see, including shared ones, and a name and email carried onto
			// the next donor's screen is the last donor's.
			else if (step === 'success') restart();
			else now().backButton.onClick();
		};
	}

	/**
	 * which reading of the fee row is on screen, and the state the box is holding either way.
	 *
	 * a function because both paths through `updateSummary` below take it, including the one reached
	 * with no gift value at all: a control left un-hidden there, or holding a decision the flow does
	 * not, is a defect that renders perfectly.
	 *
	 * `consequence` empty is the row saying nothing about what the decision does — the line comes off
	 * the card and off the box's description together, so nothing is described by a sentence that is
	 * not on screen.
	 */
	function updateFeeDecision(api: DomApi, changeable: boolean, consequence: string): void {
		setHidden(feeDecision, !changeable);
		setHidden(feeName, changeable);
		// the figure's name follows the visible label it stands in for, so the row is named once
		// however it is being read — and comes off with the figure itself, because the name is only
		// ever there to say what the number beside it is and this row has readings with no number
		// (`updateSummary` below). read off the column rather than passed in, so the name cannot
		// announce a figure the column does not hold.
		setHidden(feeFigureName, !changeable || feeFigure.textContent === '');
		setText(feeNote, consequence);
		setHidden(feeNote, consequence === '');
		toggleAttribute(feeBox, 'aria-describedby', consequence === '' ? null : 'fee-note');
		// the box is set from the flow's answer rather than left holding its own, which is the rule
		// the note disclosure keeps: a donor who walked forward and came back finds the switch reading
		// the decision the total beside it was computed from.
		const covering = api.feeToggle.pressed === true;
		if (feeBox.checked !== covering) feeBox.checked = covering;
	}

	/**
	 * the receipt, and the sentence its total would be read out as.
	 *
	 * the sentence is returned rather than said here, because what a patch says out loud is one
	 * decision made in one place (`say` in `update` above) and a second channel opened from inside
	 * this function would be a screen's own words and a figure competing for the same region. it is
	 * built beside the row it restates, so the two cannot state different money.
	 */
	function updateSummary(api: DomApi, screen: Takeover): string {
		const { state } = api;
		// the total the takeover states is authority's, never the estimate: the correction screen
		// and the mandate are where the server's own figure is consented to.
		const authoritative =
			state.step === 'confirm' || state.step === 'mandate' ? api.confirmButton.totalMinor : null;
		const fv = 'fv' in state ? state.fv : undefined;
		if (fv === undefined) {
			// past the point a gift is decided the projection carries no value at all — a resume
			// knows only what it read back. the receipt keeps the figures it was last given and only
			// the words around them change, which is what "the same receipt" means on those screens.
			if (screen.totalLabel !== '') setText(totalLabel, screen.totalLabel);
			setText(receiptNote, screen.receiptNote);
			setHidden(receiptNote, screen.receiptNote === '');
			// the row on this path is the ledger reading, because no screen reached without a gift
			// value is one the flow answers a fee decision on. said here as well as below rather than
			// left to the branch that has figures: a control this branch never touched would render,
			// and would render holding whatever the last screen with figures put in it.
			updateFeeDecision(api, false, '');
			return '';
		}

		const totalMinor = authoritative ?? api.submitButton.totalMinor ?? fv.amountMinor;
		// the fee is the difference between what the flow says will be charged and the gift it is
		// charged on. neither number is recomputed here: both come off the projection, so the
		// receipt row and the control that spends the money cannot state amounts a unit apart.
		const feeMinor = totalMinor - fv.amountMinor;
		const feeShown = feeMinor > 0;
		// the fee decision is the review step's, because that is the only step whose press the flow
		// answers `TOGGLE_FEE_COVERAGE` on (./checkout.machine.ts). the receipt travels past it onto
		// the correction screen and every ending, and a control carried along that renders and does
		// nothing is worse than one that is not there.
		const changeable = state.step === 'give';

		setText(giftLabel, `${FREQUENCY_LABELS[fv.frequency]} gift`);
		setText(giftFigure, money(fv.amountMinor));
		// the cause the donor chose, named. only a choice moves this line — a pinned name is the
		// config's and was written at build — and a donor who chose none is told where the gift goes
		// rather than shown a blank, because choosing none is an answer.
		if (config.program?.mode === 'choice') {
			const chosen = config.program.options.find((option) => option.id === fv.programId);
			setText(programName, chosen?.name ?? NO_PROGRAM_LABEL);
		}
		setHidden(feeRow, !feeShown && !changeable);
		// the column holds what the donor pays, which is what every figure in this receipt is: the
		// gift above it and the total under it are both money leaving the donor's account, and the
		// column adds up down the card. a declined fee adds nothing to that and so states nothing —
		// the switch beside it is what says the decision was made, and the line under it prices both
		// sides of it, so a blank here is a column with nothing to add rather than a figure that
		// failed to arrive.
		//
		// the covered reading is blank on the same rule for the opposite cause: the rail prices the
		// fee (`feeMinor` above), and a config that publishes no rule for it leaves nothing to add
		// either.
		//
		// the blank is unconditional here and safe only because of the `setHidden(feeRow, …)` above
		// it: past the review step the visible `Processing fee` label is back and the decision is not
		// the donor's to make, and that condition is what keeps every ending screen from drawing that
		// label with an empty column beside it. the two lines are one rule and neither survives the
		// other being relaxed — ./element.dom.spec.ts, "drops the fee line once the press is past and
		// there is no fee to state".
		setText(feeFigure, feeShown ? `+ ${money(feeMinor)}` : '');
		// what the decision does to the money, priced both ways round: the money is the whole of what
		// the switch is about, and a decision offered with a figure on one side only is one a donor
		// cannot weigh.
		//
		// neither sentence calls its figure "the fee", and that is the constraint on any rewording of
		// them. the two figures are different quantities — what covering costs the donor is the
		// gross-up, what declining costs the org is the deduction (./fee.ts) — so one noun over both
		// reads as one price changing when the switch moves, which is the one thing the switch does
		// not do.
		//
		// the covered reading says the org receives the whole gift. the rule states one percentage and
		// one flat charge, and a card priced above it — issued outside the account's country, or
		// settled through a currency conversion — is charged more, so on such a gift the org receives
		// less than the sentence names. the sentence stands over that: the org is receiving rather
		// than disbursing, and the donor's receipt is for what they paid either way (./fee.ts).
		//
		// a covered fee the rail has not priced states nothing: "receives the full $25.00" is true of
		// the decision at that moment and reads as false, because the total beside it also says
		// $25.00 and the line is the only thing on the row claiming anything is being added. the
		// declined reading keeps a sentence there, because where the fee comes from holds with no
		// figure to name.
		const declined = api.feeToggle.declinedFee ?? null;
		const consequence =
			api.feeToggle.pressed === true
				? feeShown
					? `You add ${money(feeMinor)} so ${config.orgLegalName} receives the full ${money(fv.amountMinor)}.`
					: ''
				: declined === null
					? `${config.orgLegalName} pays the processing fee out of your ${money(fv.amountMinor)}.`
					: `${config.orgLegalName} pays ${money(declined.feeMinor)} out of your gift and receives ${money(declined.netMinor)}.`;
		updateFeeDecision(api, changeable, changeable ? consequence : '');
		setText(totalFigure, money(totalMinor));
		// what the total is called is the one thing that changes about this block across screens:
		// the gift is charged today, or it is one a bank has not moved yet.
		const totalName = screen.totalLabel === '' ? 'Total today' : screen.totalLabel;
		setText(totalLabel, totalName);
		// the repeat sentence is owed on the review step too, and that is a correctness requirement
		// rather than a preference: the takeovers state it, and a monthly donor whose only sight of
		// the figure was the Donate button would be charged having never been told the gift repeats.
		setText(
			receiptNote,
			state.step === 'give' ? recurringNote(totalMinor, fv.frequency, money) : screen.receiptNote
		);
		setHidden(receiptNote, receiptNote.textContent === '');
		receiptWritten = true;
		// the control that spends the money restates it.
		setText(submitLabel, `Donate ${money(totalMinor)}`);

		// where the receipt is going, on the one step that shows nothing else the donor typed. the
		// step head's mark for the details step is the way to change it, which is why the line names
		// the address rather than offering a control of its own.
		const email = api.emailField.value.trim();
		setText(receiptTo, email === '' ? '' : `Receipt to ${email}`);
		setHidden(receiptTo, email === '');

		return `${totalName} is ${money(totalMinor)}.`;
	}

	return {
		root,
		payment,
		challenge,
		focus() {
			headings[shown].focus();
		},
		update(api) {
			if (current === null) build(api);
			update(api);
		},
		stop() {
			view?.removeEventListener('resize', rewrapped);
			if (repositioning !== 0) view?.cancelAnimationFrame(repositioning);
			repositioning = 0;
		}
	};
}

/**
 * the shape of a form, before this one's shape is known.
 *
 * what `build` above draws on the first step of the default form, top to bottom: the head, the
 * cadences, the amount entry with no shortcuts above it, the two optional asks and the button. the
 * note and the tribute are on every form whatever its configuration (`amountStep` above), so each
 * takes a row here; the shortcuts are the one thing a configuration adds, and the default form has
 * none (`DEFAULT_SHAPE`). so the layout the donor is looking at while the request is in flight is
 * the layout they end up with.
 *
 * returned already inside `.card-body`, which is the box that pads (`--_inset` in
 * ./styles/layout.css) and the one every other state on this card goes through — `createUnavailable`
 * below builds its own for the same reason. the wrapper is here rather than at the call site because
 * "the layout they end up with" is a claim about the inset as much as about the row count, and a
 * caller that appended this to the card directly would break it while looking correct.
 */
export function createSkeleton(doc: Document): HTMLElement {
	// the head at the real head's height: a block the heading's line tall at its start and one mark
	// per step at its end, each in the target the real mark stands in, so `.step-head` and
	// `.step-dots` in ./styles/layout.css lay this line out exactly as they lay out the real one.
	const marks = make(
		doc,
		'div',
		{ class: 'step-dots' },
		STEP_HEADINGS.map(() =>
			make(doc, 'span', { class: 'step-dot' }, [
				make(doc, 'span', { class: 'skeleton-block skeleton-mark' })
			])
		)
	);
	const head = make(doc, 'div', { class: 'step-head' }, [
		make(doc, 'div', { class: 'skeleton-block skeleton-heading' }),
		marks
	]);
	const segment = make(doc, 'div', { class: 'segment' });
	for (let index = 0; index < DEFAULT_SHAPE.frequencies; index += 1) {
		put(doc, segment, [make(doc, 'div', { class: 'skeleton-block skeleton-segment' })]);
	}
	// each group as `build` above lays the real one out: a label's line, then the tray, in a
	// `.group` so the gap between the two is the real gap rather than a restatement of it.
	const frequencies = make(doc, 'div', { class: 'group' }, [
		make(doc, 'div', { class: 'skeleton-block skeleton-label' }),
		segment
	]);
	const tiles = make(doc, 'div', { class: 'tiles' });
	for (let index = 0; index < DEFAULT_SHAPE.amounts; index += 1) {
		put(doc, tiles, [make(doc, 'div', { class: 'skeleton-block skeleton-tile' })]);
	}
	const amounts = make(doc, 'div', { class: 'group' }, [
		make(doc, 'div', { class: 'skeleton-block skeleton-label' }),
		// the shortcuts, on the real tray: the grid wraps these six as it wraps the
		// org's own, so the rows the card grows to are the rows it will have. no box under them —
		// the entry is hidden until the Other tile is chosen (`update` above), so a shape drawing it
		// would reserve a row most cards never open.
		tiles
	]);
	// hidden from the accessibility tree entirely: it is a shape, and the words for what is
	// happening are on the card's own live region.
	const skeleton = make(doc, 'div', { class: 'skeleton', 'aria-hidden': 'true' }, [
		head,
		frequencies,
		amounts,
		// the note and the tribute, one row each.
		make(doc, 'div', { class: 'skeleton-block skeleton-row' }),
		make(doc, 'div', { class: 'skeleton-block skeleton-row' }),
		make(doc, 'div', { class: 'skeleton-block skeleton-action' })
	]);
	return make(doc, 'div', { class: 'card-body' }, [skeleton]);
}

/**
 * a form that cannot be rendered, said out loud.
 *
 * CLAUDE.md's rule about 4xx bodies applies here too: the reader is as likely to be an agent
 * wiring the embed as a person, and neither can see a console. so the message names the value and
 * the `fix` names where it is changed.
 *
 * nothing here is a live region, and that is the fix rather than an omission. a `role="alert"`
 * inserted already holding its sentence is the case assistive technology drops, and the sentence
 * cannot be written after insertion by a node that is built before it. the message reaches a reader
 * one of two ways instead, never both: on the caret, where this card replaced one that was holding
 * it, and otherwise through the region that outlives every card (`createAnnouncer` below). the
 * `fix` goes neither way — `#showUnavailable` in ./element.ts says why it stays visible here.
 *
 * `retry` is the way back onto the form, where there is one. a read that failed is not the same as
 * a form nobody named: a lost connection comes back and nothing else on the page would ever ask
 * again, so the card that reports one carries the ask. a card whose fix is markup gets no control,
 * because pressing it would render the same card a second time.
 *
 * `focus` is handed out for the reason `CardView`'s is: the caret has to land somewhere when this
 * card replaces one that was holding it, and looking the node up from outside would make this
 * function's internals load-bearing where they are not published.
 */
export function createUnavailable(
	doc: Document,
	message: string,
	fix?: string,
	retry?: () => void
): { readonly root: HTMLElement; focus(): void } {
	// the sentence is the heading rather than a paragraph under one: without one this is the only
	// screen the element shows with no heading at all, and a reader navigating by heading finds
	// nothing where the form was. one node reading from its own content needs no accessible name of
	// its own, and `tabindex="-1"` is what lets the caret land on it — the same reason every heading
	// on the card carries one. the `fix` and the way back stay behind it, in reading and tab order.
	const heading = make(doc, 'h2', { class: 'unavailable', tabindex: -1 }, [message]);
	const alert = make(doc, 'div', { class: 'alert' }, [heading]);
	if (fix !== undefined) {
		put(doc, alert, [make(doc, 'p', { class: 'unavailable-fix' }, [fix])]);
	}
	const body = make(doc, 'div', { class: 'card-body' }, [alert]);
	if (retry !== undefined) {
		// the published `action` name rather than one of its own: the vocabulary is closed at twelve
		// (./parts.ts), and a host who has painted the form's primary control has painted this one.
		// the words directly in the control rather than in a `.action-label` span: that span is where
		// the patch writes a label beside a spinner, and this card is never patched and never busy.
		const button = make(doc, 'button', { part: part('action'), type: 'button' }, ['Try again']);
		button.addEventListener('click', retry);
		put(doc, body, [button]);
	}
	return {
		root: make(doc, 'div', { part: part('card'), lang: 'en' }, [body]),
		focus() {
			heading.focus();
		}
	};
}

/**
 * the region the element speaks through, built once and kept for the life of the shadow root.
 *
 * outside every card rather than inside one, which is what makes it heard at all: a live region
 * announces what arrives in it while it is already on the page, so a region built as part of the
 * card that carries its first sentence is a region created and filled in one breath — the case
 * assistive technology that diffs the tree per task drops. it therefore survives a reboot, and it
 * is the one channel the loading state, the unavailable card and every patch of the card speak
 * through. `#show` in ./element.ts is what keeps it in place.
 *
 * it is also outside whatever carries `aria-busy` while the flow works, which is an instruction to
 * hold a region's changes back until the flag clears — the interior of the card takes that flag
 * (`update` above), and this is never inside it.
 */
export function createAnnouncer(doc: Document): HTMLElement {
	// its own `lang`, for the reason the cards carry one: it is their sibling in the shadow root
	// rather than a child, so a declaration on the card covers nothing that is said out loud.
	return make(doc, 'div', { class: 'vh', lang: 'en', role: 'status', 'aria-live': 'polite' });
}
