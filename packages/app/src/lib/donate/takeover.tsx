import type { State } from '@better-giving/form/connect';
import { coinDifference, type DepositScreen, isFigure } from '@better-giving/form/deposit';
import { RECONCILIATION_LABELS } from '@better-giving/form/fee';
import { PAYMENT_METHOD_LABELS, type FormConfig } from '@better-giving/form/v1';
import { part, partWhen } from '@better-giving/form/parts';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import * as copy from './copy';

// every state that takes the whole card, in the words a donor reads.
//
// one descriptor for all of them rather than a component per screen. every takeover is the same
// column of elements with different words in it, so what varies is stated once in a place a reader
// can compare screens across — and the render below is then total over that record rather than a
// chain of conditions that quietly leaves a node from the last screen on the next one.
//
// `takeoverFor` is total over the states that reach it, with no arm that falls through to something
// plausible. `connect` in @better-giving/form/connect is what makes an unprojected machine state a
// type error; this is what makes a projected one nobody wrote a screen for the same thing.

/** what the receipt is saying about the money on a given screen, or that it is not shown. */
type Receipt = 'none' | 'charged' | 'pending';

/** one full-card screen, as data. */
export type Takeover = {
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
	/** where and how much to send a `crypto` gift, on the one screen that states it. */
	readonly deposit: DepositScreen | null;
	/** the way out of the screen: beside the primary where there is one, alone where there is not. */
	readonly secondary: { readonly label: string } | null;
	/**
	 * the line under the way out, on the one screen that has one.
	 *
	 * it stands there rather than among the notes because of what it is for: the details are in the
	 * donor's inbox, which is the whole reason they may close this page — so it is read under the
	 * control that leaves, where it reads as permission rather than as a note nobody needed.
	 */
	readonly secondaryNote: string;
};

export const BLANK: Takeover = {
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
	deposit: null,
	secondary: null,
	secondaryNote: ''
};

/**
 * a timestamp as a date the donor can act on.
 *
 * absolute, never relative, and server-supplied for the reason ledger time is: the donor may read
 * this page days after it was painted, by which point "within 10 days" names nothing they can check.
 */
function formatDate(at: number, locale: string): string {
	try {
		return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(at));
	} catch {
		return new Date(at).toISOString().slice(0, 10);
	}
}

/**
 * a timestamp as the date and the time of day, in the donor's own zone.
 *
 * the address a crypto gift is sent to closes seven days out at a given hour, so the date alone names
 * a day on which a send may already be too late.
 */
function formatMoment(at: number, locale: string): string {
	try {
		return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(
			new Date(at)
		);
	} catch {
		return new Date(at).toISOString().slice(0, 16).replace('T', ' ');
	}
}

/** the address screen's block, for the deposit the quote handed over. */
function depositScreen(
	state: State & { readonly step: 'awaitingDeposit' },
	config: FormConfig,
	money: (minor: number) => string
): DepositScreen {
	const { deposit } = state;
	const coin = config.coins?.find((offered) => offered.coin === deposit.coin);
	// the gift in coin is stated only where the quote stated it. the fee is then the difference
	// between the two figures rather than a third one, so the three rows cannot disagree.
	const stated = deposit.giftCoinAmount;
	const gift = stated !== undefined && isFigure(stated) ? stated : null;
	const fee = gift === null ? null : coinDifference(deposit.coinAmount, gift);
	return {
		// the processor's own code where the served list no longer names the coin: a figure with no
		// unit beside it is not one a donor can type into a wallet.
		ticker: (coin?.ticker ?? deposit.coin).toUpperCase(),
		network: deposit.network,
		networkWarning: copy.networkWarning(config.orgLegalName, deposit.memo !== null),
		gift: gift === null ? null : { figure: gift, worth: money(state.totalMinor - state.feeMinor) },
		fee:
			fee === null || state.feeMinor === 0 ? null : { figure: fee, worth: money(state.feeMinor) },
		total: { figure: deposit.coinAmount, worth: money(state.totalMinor) },
		instruction: copy.SEND_INSTRUCTION,
		address: deposit.address,
		memo: deposit.memo,
		qr: deposit.qr?.rows ?? null,
		expiry: {
			left: state.expiresIn,
			moment: formatMoment(Date.parse(deposit.validUntil), config.locale),
			words: copy.expiresIn
		},
		status: copy.WAITING_FOR_GIFT
	};
}

/**
 * the screen, as the words a donor on this rail reads.
 *
 * the rail is the state's own and there is no other reading of it here: `State`
 * (@better-giving/form/connect) carries the committed payer's method on every screen a donor waits
 * under as well as on the correction, so a screen below that names a rail names the one the intent
 * was minted for. absent is a cold return — the page was handed a payment token and nothing else —
 * and it is a reading of its own rather than a missing one.
 */
export function takeoverFor(
	state: State,
	config: FormConfig,
	money: (minor: number) => string
): Takeover {
	const org = config.orgLegalName;

	switch (state.step) {
		case 'confirm': {
			// both figures, because a total that moved between what the donor pressed and what authority
			// charges is the one thing this screen exists to say out loud — a silent correction here
			// would be worse than never having estimated.
			const aside = copy.correctionAside(
				RECONCILIATION_LABELS.adjusted,
				money(state.reconciliation.totalMinor),
				money(state.reconciliation.shownTotalMinor)
			);
			return {
				...BLANK,
				// not "Confirm your gift": the donor pressed Donate on the step before this one and
				// believes they have already confirmed, so a heading that asked again would read as the
				// form having lost their press rather than as the figure having moved.
				heading: copy.CORRECTION_HEADING,
				receipt: 'charged',
				totalLabel: copy.CHARGED_TODAY,
				receiptNote: copy.recurringNote(money(state.quote.totalMinor), state.fv.frequency),
				aside,
				method: PAYMENT_METHOD_LABELS[state.method],
				// always announced. this screen renders only where the figure moved, so its existence is
				// the news and there is no match left for an announcement to teach distrust of.
				announce: aside,
				primary: { label: copy.giveLabel(money(state.quote.totalMinor)), submit: true },
				// what going back actually offers. the step behind this one is the payment step, and a
				// control naming the amount would send a donor looking for a figure they cannot change
				// there.
				secondary: { label: copy.CHANGE_METHOD }
			};
		}

		case 'mandate':
			return {
				...BLANK,
				heading: copy.MANDATE_HEADING,
				receipt: 'charged',
				totalLabel: copy.CHARGED_TODAY,
				receiptNote: copy.recurringNote(money(state.quote.totalMinor), state.fv.frequency),
				// the provider's own wording, verbatim. it authorizes a debit, which makes it a legal
				// instrument, and paraphrasing one on the organisation's behalf is not something this
				// project does.
				mandate: state.quote.mandate?.text ?? '',
				primary: { label: copy.authorizeLabel(money(state.quote.totalMinor)), submit: true },
				// stated beside the provider's text rather than inside it, so nothing here reads as part
				// of the authorization.
				primaryNote: copy.mandateNote(org, money(state.quote.totalMinor)),
				secondary: { label: copy.USE_DIFFERENT_METHOD }
			};

		case 'redirecting':
			return {
				...BLANK,
				heading: copy.redirectingHeading(state.method),
				body: copy.redirectingBody(state.method)
			};

		case 'processing':
			return {
				...BLANK,
				heading: copy.PROCESSING_HEADING,
				receipt: 'pending',
				totalLabel: copy.processingTotalLabel(state.method),
				receiptNote: copy.processingNote(state.method),
				body: copy.processingBody(org, state.method)
			};

		case 'indeterminate':
			// an ending with nothing to press, and the copy claims nothing. the flow is here because a
			// confirmation went unanswered, so the money may already have moved and may not — the
			// webhook settles which, and it is what sends the receipt.
			return {
				...BLANK,
				heading: copy.INDETERMINATE_HEADING,
				body: copy.indeterminateBody(org, state.method),
				announce: copy.INDETERMINATE_ANNOUNCE
			};

		case 'awaitingVerification':
			return {
				...BLANK,
				heading: copy.VERIFY_HEADING,
				receipt: 'pending',
				totalLabel: copy.TO_BE_CHARGED,
				receiptNote: copy.VERIFY_NOTE,
				body: copy.verifyBody(org),
				// a deadline the flow does not have is a block that does not render, because a
				// manufactured one is worse than none.
				deadline:
					state.deadline === null
						? ''
						: copy.verifyDeadline(formatDate(state.deadline, config.locale))
			};

		case 'awaitingDeposit':
			// past the send-by on this device the address is withdrawn, and every way to copy it with
			// it, so nobody sends to an address no longer watched. the reading goes on behind both.
			if (state.closed) {
				return {
					...BLANK,
					heading: copy.CHECKING_HEADING,
					body: copy.checkingBody(formatMoment(Date.parse(state.deposit.validUntil), config.locale))
				};
			}
			return {
				...BLANK,
				heading: copy.SEND_HEADING,
				deposit: depositScreen(state, config, money),
				secondary: { label: copy.USE_DIFFERENT_COIN },
				secondaryNote: copy.detailsSentTo(state.email)
			};

		case 'depositExpired':
			return {
				...BLANK,
				heading: copy.EXPIRED_HEADING,
				body: copy.DEPOSIT_EXPIRED_BODY,
				primary: { label: copy.START_AGAIN, submit: false }
			};

		case 'verificationExpired':
			return {
				...BLANK,
				heading: copy.EXPIRED_HEADING,
				body: copy.EXPIRED_BODY,
				primary: { label: copy.START_AGAIN, submit: false }
			};

		// a gift sent from the donor's own wallet is valued on arrival, so no figure the card holds is
		// what arrived: the emailed receipt names that, and this screen draws no receipt at all.
		case 'success':
			if (state.method === 'crypto') {
				return {
					...BLANK,
					heading: copy.SUCCESS_HEADING,
					body: copy.arrivedBody(org),
					announce: copy.ARRIVED_ANNOUNCE,
					secondary: { label: copy.BACK_TO_START }
				};
			}
			return {
				...BLANK,
				heading: copy.SUCCESS_HEADING,
				receipt: 'charged',
				totalLabel: copy.CHARGED_TODAY,
				body: copy.successBody(org),
				announce: copy.SUCCESS_ANNOUNCE,
				// the quiet control rather than the primary the two recovery screens use. this donor is
				// owed no act — a gift was made — and a loud control over a thank-you asks for one.
				secondary: { label: copy.BACK_TO_START }
			};

		// `state.fix` is not among what this screen says. it names a publishable key, an environment
		// value or a screen in /admin, and it is addressed to whoever administers the deployment rather
		// than to the donor in front of the card, who can act on none of it.
		case 'failed':
			return {
				...BLANK,
				heading: copy.FAILED_HEADING,
				// the region, and the sentence on the card. this screen is reached from the correction
				// and the mandate as well as from the numbered steps, and on those two no caret moves —
				// the heading's words are replaced under a node that already holds focus, which is a
				// decline announced to nobody.
				failure: state.message,
				announce: state.message,
				primary: { label: copy.TRY_AGAIN, submit: false }
			};

		// a resume, which is the only busy flow that reaches a takeover: a donor is back from wherever
		// they authorized, and the flow has not yet found out what happened. its two sentences name no
		// rail, which is what makes them right on the page load that has none.
		case 'working':
			return { ...BLANK, heading: copy.RESUMING_HEADING, body: copy.RESUMING_BODY };

		// the three the card renders as a numbered step rather than as a takeover.
		case 'amount':
		case 'details':
		case 'give':
			return BLANK;
	}
}

export type TakeoverScreenProps = {
	readonly screen: Takeover;
	readonly hidden: boolean;
	readonly busy: boolean;
	/** the receipt block, shown only on a screen that states one and only once it has figures. */
	readonly receipt: ReactNode;
	readonly headingRef: RefObject<HTMLHeadingElement | null>;
	/**
	 * the address block (`createDepositBlock` in @better-giving/form/deposit), built by the card and
	 * patched from `screen.deposit`; `null` until the live flow has started.
	 */
	readonly deposit: HTMLElement | null;
	readonly onPrimary: () => void;
	readonly onSecondary: () => void;
};

export function TakeoverScreen({
	screen,
	hidden,
	busy,
	receipt,
	headingRef,
	deposit,
	onPrimary,
	onSecondary
}: TakeoverScreenProps) {
	const primary = useRef<HTMLButtonElement | null>(null);
	// a child of the section itself, where the element stands it, so the takeover's own column rules
	// reach it. every sibling react draws here is always rendered, which is what keeps a node react
	// did not write from being reconciled away.
	useEffect(() => {
		const before = primary.current;
		if (deposit === null || before === null || deposit.nextSibling === before) return;
		before.parentNode?.insertBefore(deposit, before);
	}, [deposit]);
	return (
		<section className="step takeover" hidden={hidden}>
			{/*
			 * `tabindex="-1"` for the reason the numbered steps' headings carry it: arriving here hides
			 * the step that held focus, and a takeover the donor is never taken to is one a screen reader
			 * is never told about.
			 */}
			<h2 part={part('heading')} tabIndex={-1} ref={headingRef} hidden={screen.heading === ''}>
				{screen.heading}
			</h2>
			<p className="prose" hidden={screen.body === ''}>
				{screen.body}
			</p>
			<div className="receipt-slot" hidden={receipt === null}>
				{receipt}
			</div>
			<p className="aside" hidden={screen.aside === ''}>
				{screen.aside}
			</p>
			<p className="aside" hidden={screen.method === ''}>
				{screen.method === '' ? '' : copy.payingBy(screen.method)}
			</p>
			{/*
			 * scrollable and never a gate on the button. requiring a scroll to the bottom before the
			 * control works is a keyboard trap, and what the provider requires is that the wording is
			 * displayed beside an affirmative act, which pressing the button is.
			 *
			 * the tab stop is what a keyboard donor scrolls it with, and a focusable `<div>` is a generic
			 * with no name: without the role and the label they land in the block they are being asked to
			 * agree to and hear nothing.
			 */}
			{/* biome-ignore lint/a11y/useSemanticElements: a `<fieldset>` groups this document's own form
			    controls, and what this holds is the provider's authorization wording, which is prose. */}
			<div
				className="mandate"
				role="group"
				aria-label={copy.MANDATE_LABEL}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: the tab stop is what a keyboard donor scrolls the block with, and it is never a gate on the button — requiring a scroll to the bottom before a control works is a keyboard trap.
				tabIndex={0}
				hidden={screen.mandate === ''}
			>
				<p className="mandate-text">{screen.mandate}</p>
			</div>
			<p className="attention" hidden={screen.deadline === ''}>
				{screen.deadline}
			</p>
			{/*
			 * visible text and no live region of its own: the refusal it carries is announced through
			 * the card's one region, and a sentence that speaks from here as well is the same decline
			 * read out twice.
			 */}
			<p className="message" hidden={screen.failure === ''}>
				{screen.failure}
			</p>
			{/*
			 * Enter reaches this control only where the screen says the press submits the gift. the two
			 * recovery screens' primaries start a gift over rather than send one, and a keystroke that
			 * pressed one of those would restart a donor who was reading the refusal.
			 */}
			<button
				ref={primary}
				part={partWhen('action', { submit: screen.primary?.submit === true, busy })}
				type={screen.primary?.submit === true ? 'submit' : 'button'}
				aria-busy={busy}
				hidden={screen.primary === null}
				onClick={onPrimary}
			>
				<span className="action-label">{screen.primary?.label ?? ''}</span>
				<span className="spinner" aria-hidden="true" />
			</button>
			<p className="aside" hidden={screen.primaryNote === ''}>
				{screen.primaryNote}
			</p>
			{/*
			 * the way out and the line that makes taking it safe are one group, so the line stands under
			 * the control at the group's own step rather than a screen's step away from it. every other
			 * takeover writes no line and the group is the control alone.
			 */}
			<div className="foot" hidden={screen.secondary === null && screen.secondaryNote === ''}>
				<button
					part={part('action-quiet')}
					type="button"
					hidden={screen.secondary === null}
					onClick={onSecondary}
				>
					{screen.secondary?.label ?? ''}
				</button>
				<p className="aside" hidden={screen.secondaryNote === ''}>
					{screen.secondaryNote}
				</p>
			</div>
		</section>
	);
}
