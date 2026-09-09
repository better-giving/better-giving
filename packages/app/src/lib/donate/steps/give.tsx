import { formatMinor } from '@better-giving/form/money';
import { part, partWhen } from '@better-giving/form/parts';
import { FREQUENCY_LABELS, NO_PROGRAM_LABEL, type FormConfig } from '@better-giving/form/v1';
import type { ReactNode, RefObject } from 'react';
import * as copy from '../copy';
import type { ReactApi } from '../normalize';
import { PaymentBox } from '../payment';
import type { Takeover } from '../takeover';

// the third numbered step: the receipt, the provider's own fields, and the control that spends the
// money.
//
// this step shows nothing the donor typed. what closes that gap is the line under the receipt
// stating where it is going, with the step head's mark for the details step as the way to change it
// — a control here would be a second way to edit an address the step behind this one owns.
//
// the receipt block itself travels: it is the same reading on this step, on the correction screen
// and on every ending, which is what makes the total a donor authorizes recognisably the one they
// were shown. so it is built here, beside the step that first states it, and rendered wherever the
// card puts it.
//
// no figure in this file is computed twice. the total is `submitButton.totalMinor` or the quote's,
// and the fee is the difference between the total and the gift — both off the projection, so the
// receipt row and the control that spends the money cannot state amounts a unit apart.

/** what the receipt is stating, once there is a gift to state. */
export type ReceiptReading = {
	readonly giftLabel: string;
	readonly giftFigure: string;
	/** the cause this gift is credited to, or `null` on a form carrying none. */
	readonly programName: string | null;
	readonly feeRowShown: boolean;
	readonly feeFigure: string;
	/** whether this screen is the one whose press the flow answers a fee decision on. */
	readonly changeable: boolean;
	readonly covering: boolean;
	readonly consequence: string;
	readonly totalLabel: string;
	readonly totalFigure: string;
	readonly receiptNote: string;
	/** whether the total on screen is not the one the donor pressed Donate on. */
	readonly corrected: boolean;
	/** the sentence this total would be read out as. */
	readonly words: string;
	readonly submitLabel: string;
	readonly receiptTo: string;
};

/**
 * the receipt, read off the projection and the screen it is being drawn on.
 *
 * `last` is what the receipt was given the time before, and it is the whole of what a resume needs:
 * past the point a gift is decided the projection carries no value at all, so those screens keep the
 * figures they were last shown and only the words around them change. a card that has never had
 * figures returns nothing rather than an empty ledger block under a thank-you.
 */
export function readReceipt(
	api: ReactApi,
	config: FormConfig,
	screen: Takeover,
	last: ReceiptReading | null
): ReceiptReading | null {
	const { state } = api;
	const money = (minor: number) => formatMinor(minor, config.locale, config.currency);
	const email = api.emailField.box.value.trim();
	const receiptTo = email === '' ? '' : copy.receiptTo(email);

	const fv = 'fv' in state ? state.fv : undefined;
	if (fv === undefined) {
		if (last === null) return null;
		return {
			...last,
			totalLabel: screen.totalLabel === '' ? last.totalLabel : screen.totalLabel,
			receiptNote: screen.receiptNote,
			// no screen reached without a gift value is one the flow answers a fee decision on, so the
			// row is the ledger reading here whatever it was last time.
			changeable: false,
			consequence: '',
			corrected: false,
			words: '',
			receiptTo
		};
	}

	// the total the takeover states is authority's, never the estimate: the correction screen and the
	// mandate are where the server's own figure is consented to.
	const authoritative =
		state.step === 'confirm' || state.step === 'mandate' ? api.confirmButton.totalMinor : null;
	const totalMinor = authoritative ?? api.submitButton.totalMinor ?? fv.amountMinor;
	const feeMinor = totalMinor - fv.amountMinor;
	const feeShown = feeMinor > 0;
	const changeable = state.step === 'give';
	const covering = api.feeToggle.pressed === true;
	const declined = api.feeToggle.declinedFee ?? null;
	const org = config.orgLegalName;

	// the column holds what the donor pays. a declined fee adds nothing to that and so states nothing
	// — the switch beside it is what says the decision was made, and the line under it prices both
	// sides. the covered reading is blank on the same rule for the opposite cause: the rail prices the
	// fee, and a configuration that publishes no rule for it leaves nothing to add either.
	const consequence = covering
		? feeShown
			? copy.feeCovered(org, money(feeMinor), money(fv.amountMinor))
			: ''
		: declined === null
			? copy.feeDeclinedUnpriced(org, money(fv.amountMinor))
			: copy.feeDeclined(org, money(declined.feeMinor), money(declined.netMinor));

	const totalLabel = screen.totalLabel === '' ? copy.TOTAL_TODAY : screen.totalLabel;
	// the repeat sentence is owed on the review step too, and that is a correctness requirement
	// rather than a preference: a monthly donor whose only sight of the figure was the Donate button
	// would be charged having never been told the gift repeats.
	const receiptNote =
		state.step === 'give'
			? copy.recurringNote(money(totalMinor), fv.frequency)
			: screen.receiptNote;

	// only a choice moves this line — a pinned name is the configuration's and cannot change — and a
	// donor who chose none is told where the gift goes rather than shown a blank, because choosing
	// none is an answer.
	const programName =
		config.program === undefined
			? null
			: config.program.mode === 'pinned'
				? config.program.name
				: (config.program.options.find((option) => option.id === fv.programId)?.name ??
					NO_PROGRAM_LABEL);

	return {
		giftLabel: copy.giftRow(FREQUENCY_LABELS[fv.frequency]),
		giftFigure: money(fv.amountMinor),
		programName,
		feeRowShown: feeShown || changeable,
		feeFigure: feeShown ? `+ ${money(feeMinor)}` : '',
		changeable,
		covering,
		consequence: changeable ? consequence : '',
		totalLabel,
		totalFigure: money(totalMinor),
		receiptNote,
		corrected: state.step === 'confirm',
		words: `${totalLabel} is ${money(totalMinor)}.`,
		submitLabel: copy.donateLabel(money(totalMinor)),
		receiptTo
	};
}

export type ReceiptProps = {
	readonly reading: ReceiptReading;
	readonly onFee: () => void;
	readonly feeRef: RefObject<HTMLInputElement | null>;
};

export function Receipt({ reading, onFee, feeRef }: ReceiptProps) {
	return (
		<div part={part('summary')}>
			<div className="row">
				<span className="row-label">{reading.giftLabel}</span>
				<span className="figure">{reading.giftFigure}</span>
			</div>
			{reading.programName === null ? null : (
				<div className="row program">
					<span className="row-label">{copy.PROGRAM}</span>
					<span className="program-name">{reading.programName}</span>
				</div>
			)}
			<div className="row fee" hidden={!reading.feeRowShown}>
				{/*
				 * the same row read as an account rather than operated as a decision, which is every
				 * screen past the review step. two nodes rather than one relabelled: the ledger reading is
				 * a label beside a figure where the other is a label, a switch and a sentence under both,
				 * and a relabelled control is one a screen reader hears change identity under it.
				 */}
				<span className="row-label" hidden={reading.changeable}>
					{copy.FEE_ROW_LABEL}
				</span>
				<label className="fee-decision" hidden={!reading.changeable}>
					<span className="row-label">{copy.FEE_TOGGLE_LABEL}</span>
					<span className="switch">
						{/*
						 * Enter here submits the form the box sits in, and on this step the form's default
						 * button is Donate: a donor reaching for the fee decision with the keyboard would
						 * spend the money instead. a checkbox is operated with Space, so the keystroke has
						 * nothing to do on this control and everything to do on the one it would reach.
						 */}
						<input
							part={part('checkbox')}
							type="checkbox"
							ref={feeRef}
							checked={reading.covering}
							aria-describedby={reading.consequence === '' ? undefined : 'fee-note'}
							onKeyDown={(event) => {
								if (event.key === 'Enter') event.preventDefault();
							}}
							onChange={onFee}
						/>
						<span className="switch-thumb" />
					</span>
				</label>
				{/*
				 * what the decision does, on the card rather than only in the box's accessible name: a
				 * sighted donor never reads a name, and the fee is the one line of the receipt where the
				 * figure alone does not say what was decided.
				 */}
				<p className="fee-note" id="fee-note" hidden={reading.consequence === ''}>
					{reading.consequence}
				</p>
				{/*
				 * the figure's own name, for the reading order alone. while the row is a decision the
				 * label beside it names the control rather than the money, and the figure would otherwise
				 * be a bare number in a list of named ones.
				 */}
				<span className="vh" hidden={!reading.changeable || reading.feeFigure === ''}>
					{copy.FEE_ROW_LABEL}
				</span>
				<span className="figure">{reading.feeFigure}</span>
			</div>
			<div className="row total">
				<span className="row-label">{reading.totalLabel}</span>
				{/*
				 * an `<output>`, and the only element on the card that is one: it carries `role="status"`
				 * implicitly, which is the whole reason. the fee decision rewrites this figure without
				 * changing the screen and without moving the caret, and the box reports its own new
				 * setting while the total beside it is the half nobody is told.
				 *
				 * one screen turns it off, and it is the correction: the announcer states both figures
				 * there, so the region would say the new total a second time.
				 */}
				<output
					className="figure"
					data-changed={reading.corrected ? '' : undefined}
					aria-live={reading.corrected ? 'off' : undefined}
				>
					{reading.totalFigure}
				</output>
			</div>
			{/*
			 * inside the block rather than under it: the ongoing obligation, and "nothing has been
			 * charged yet", are statements about the total, so a donor reading the figure reads them
			 * with it.
			 */}
			<p className="receipt-note" hidden={reading.receiptNote === ''}>
				{reading.receiptNote}
			</p>
		</div>
	);
}

export type GiveStepProps = {
	readonly api: ReactApi;
	readonly head: ReactNode;
	readonly hidden: boolean;
	/** the receipt block, built by the card so one reading travels every screen that states it. */
	readonly receipt: ReactNode;
	readonly receiptTo: string;
	readonly submitLabel: string;
	readonly paymentMount: RefObject<HTMLDivElement | null>;
	readonly paymentPrepared: boolean;
	readonly paymentWords: string;
	readonly onSubmit: () => void;
	readonly submits: boolean;
};

export function GiveStep({
	api,
	head,
	hidden,
	receipt,
	receiptTo,
	submitLabel,
	paymentMount,
	paymentPrepared,
	paymentWords,
	onSubmit,
	submits
}: GiveStepProps) {
	const busy = api.submitButton['aria-busy'];
	return (
		<section className="step step-give" hidden={hidden}>
			{head}
			{receipt}
			<p className="aside" hidden={receiptTo === ''}>
				{receiptTo}
			</p>
			<PaymentBox mount={paymentMount} prepared={paymentPrepared} words={paymentWords} />
			<button
				part={partWhen('action', { submit: true, busy })}
				type={submits ? 'submit' : 'button'}
				aria-busy={busy}
				onClick={onSubmit}
			>
				<span className="action-label">{submitLabel}</span>
				<span className="spinner" aria-hidden="true" />
			</button>
		</section>
	);
}
