import type { EmployerAsk, State } from '@better-giving/form/connect';
import { formatMinor } from '@better-giving/form/money';
import type { FeeRules, FormConfig, Pledge, Quote } from '@better-giving/form/v1';
import type { FormValue } from '@better-giving/form/value';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { act, createRef, type ReactNode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import * as copy from './copy';
import { DonateNotice } from './notice';
import { EmployerAskBlock, takeoverFor, TakeoverScreen } from './takeover';

// every screen that takes the whole card, drawn.
//
// the descriptor is a pure function of the projected state, so the states are built here rather than
// walked to: the four endings and the two authorization screens are reached through a payment
// provider and a network, and a spec that had to arrive at each of them would cover the arriving
// rather than the screen. what the card spec beside this one covers is the walking.
//
// what is asserted is the words a donor reads and the controls they are offered, because that is the
// whole of what varies between these screens. the render is total over the record, which is why the
// last case matters most: a failure carried onto a thank-you is exactly the defect one descriptor
// exists to prevent.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FEE_RULES: FeeRules = {
	card: { percent: 0.029, fixedMinor: 30 },
	apple_pay: { percent: 0.029, fixedMinor: 30 },
	google_pay: { percent: 0.029, fixedMinor: 30 },
	ach: { percent: 0.008, fixedMinor: 0, capMinor: 500 },
	paypal: { percent: 0.0349, fixedMinor: 49 },
	venmo: { percent: 0.0349, fixedMinor: 49 },
	daf: { percent: 0.029, fixedMinor: 0, roundUpMinor: 100 },
	crypto: { percent: 0.01, fixedMinor: 0 },
	stock: { percent: 0, fixedMinor: 0 },
	ira_qcd: { percent: 0, fixedMinor: 0 }
};

const CONFIG: FormConfig = {
	formId: 'ff000000-0000-4000-8000-000000000001',
	providers: [{ name: 'stripe', publishableKey: 'pk_test_spec' }],
	currency: 'usd',
	suggestedAmountsMinor: [2500],
	minAmountMinor: 500,
	maxAmountMinor: 500000,
	frequencies: ['one_time', 'monthly'],
	paymentMethods: ['card', 'ach'],
	feeCoverage: 'optional',
	feeRules: FEE_RULES,
	locale: 'en-US',
	orgLegalName: 'Helping Hands',
	ein: '12-3456789',
	deductibilityStatement: 'Helping Hands is a 501(c)(3).'
};

const money = (minor: number) => formatMinor(minor, CONFIG.locale, CONFIG.currency);

const GIFT: FormValue = { amountMinor: 2500, frequency: 'monthly', programId: null };
const QUOTE: Quote = { paymentToken: 'pi_1', feeMinor: 106, totalMinor: 2606 };

/**
 * one screen, as a donor on a given rail reads it.
 *
 * the rail is the state's own, so a screen is drawn on one by building the state that carries it —
 * and a state built without it is the cold return this page boots into with a payment token and
 * nothing else, which is the reading every screen has to be right in.
 */
function draw(
	state: State,
	config: FormConfig = CONFIG,
	onCopied: (words: string) => void = () => {}
): HTMLElement {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const mounted = createRoot(host);
	act(() => {
		mounted.render(
			<TakeoverScreen
				screen={takeoverFor(state, config, money)}
				hidden={false}
				busy={false}
				receipt={null}
				headingRef={createRef<HTMLHeadingElement>()}
				sectionRef={createRef<HTMLElement>()}
				deposit={null}
				employer={null}
				onPrimary={() => {}}
				onSecondary={() => {}}
				onCopied={onCopied}
				challengeMount={createRef<HTMLDivElement>()}
			/>
		);
	});
	onTestFinished(() => {
		act(() => {
			mounted.unmount();
		});
		host.remove();
	});
	return host;
}

function mount(tree: ReactNode): HTMLElement {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const mounted = createRoot(host);
	act(() => {
		mounted.render(tree);
	});
	onTestFinished(() => {
		act(() => {
			mounted.unmount();
		});
		host.remove();
	});
	return host;
}

function shown(root: HTMLElement, selector: string): string {
	const nodes = [...root.querySelectorAll(selector)].filter((node) => node instanceof HTMLElement);
	return nodes
		.filter((node) => !node.hidden)
		.map((node) => node.textContent ?? '')
		.join('|');
}

function heading(root: HTMLElement): string {
	const node = root.querySelector('h2');
	return node instanceof HTMLElement && !node.hidden ? (node.textContent ?? '') : '';
}

function controls(root: HTMLElement): string[] {
	return [...root.querySelectorAll('button')]
		.filter((node) => node instanceof HTMLElement && !node.hidden)
		.map((node) => node.textContent ?? '');
}

it('states both figures on the screen the total moved on', () => {
	const root = draw({
		step: 'confirm',
		fv: GIFT,
		quote: QUOTE,
		reconciliation: {
			kind: 'adjusted',
			shownTotalMinor: 2575,
			totalMinor: 2606,
			deltaMinor: 31
		},
		method: 'card'
	});

	expect(heading(root)).toBe(copy.CORRECTION_HEADING);
	// a silent correction here would be worse than never having estimated.
	expect(shown(root, '.aside')).toContain('It is now $26.06, not $25.75.');
	expect(shown(root, '.aside')).toContain(copy.payingBy('Card'));
	expect(controls(root)).toEqual(['Give $26.06', copy.CHANGE_METHOD]);
});

it('shows the provider’s own authorization wording verbatim, with the consequence beside it', () => {
	const root = draw({
		step: 'mandate',
		fv: GIFT,
		quote: { ...QUOTE, mandate: { text: 'You authorise the debit.' } }
	});

	expect(heading(root)).toBe(copy.MANDATE_HEADING);
	expect(shown(root, '.mandate-text')).toBe('You authorise the debit.');
	expect(shown(root, '.aside')).toBe(copy.mandateNote('Helping Hands', '$26.06'));
	expect(controls(root)).toEqual(['Authorize $26.06', copy.USE_DIFFERENT_METHOD]);
});

// the three rails and the page load that has none, on every screen a donor waits under. asserted
// three ways round rather than once, because a sentence hard-coded to one rail passes any single
// reading of it — and a donor who pressed PayPal being told to continue at their bank is the defect.
it('asks a donor to keep the window open wherever they were sent, and names where that is', () => {
	const bank = draw({ step: 'redirecting', method: 'ach' });
	expect(heading(bank)).toBe('Continue at your bank');
	expect(shown(bank, '.prose')).toContain('Your bank is checking this payment.');

	const card = draw({ step: 'redirecting', method: 'card' });
	expect(heading(card)).toBe('Continue with your card issuer');
	expect(shown(card, '.prose')).toContain('Your card issuer is checking this payment.');

	const paypal = draw({ step: 'redirecting', method: 'paypal' });
	expect(heading(paypal)).toBe('Continue in PayPal');
	expect(shown(paypal, '.prose')).toContain('PayPal is checking this payment.');

	// the one sentence that is the same on all of them, and the reason it is: wherever the donor
	// was sent, this page is what they come back to.
	for (const root of [bank, card, paypal, draw({ step: 'redirecting' })]) {
		expect(shown(root, '.prose')).toContain('Keep this window open until you are sent back.');
		expect(controls(root)).toEqual([]);
	}
});

it('promises business days on the bank rail and on no other', () => {
	const bank = draw({ step: 'processing', method: 'ach' });
	expect(heading(bank)).toBe(copy.PROCESSING_HEADING);
	expect(shown(bank, '.prose')).toContain('Bank transfers usually take 4 to 5 business days');

	// a PayPal approval is not a transfer and carries no schedule this deployment could keep.
	const paypal = draw({ step: 'processing', method: 'paypal' });
	expect(shown(paypal, '.prose')).toContain('PayPal has your approval');
	expect(shown(paypal, '.prose')).not.toContain('business days');

	const card = draw({ step: 'processing', method: 'card' });
	expect(shown(card, '.prose')).not.toContain('business days');
	expect(shown(card, '.prose')).not.toContain('PayPal');

	// every rail still says the money has not landed, which is why this screen is not the thank-you.
	for (const root of [bank, paypal, card, draw({ step: 'processing' })]) {
		expect(shown(root, '.prose')).toContain('has been told your gift is coming');
		expect(controls(root)).toEqual([]);
	}
});

it('claims nothing where nobody read the outcome, and names who is still holding it', () => {
	const bank = draw({ step: 'indeterminate', method: 'ach' });
	const paypal = draw({ step: 'indeterminate', method: 'venmo' });
	const cold = draw({ step: 'indeterminate' });

	expect(shown(bank, '.prose')).toContain('sent to your bank for confirmation');
	expect(shown(paypal, '.prose')).toContain('sent to Venmo for confirmation');
	// a cold return has no rail to name, so it names none rather than the wrong one.
	expect(shown(cold, '.prose')).toContain('Your gift has been sent for confirmation.');

	// weaker than the thank-you on purpose: a completion the donor is entitled to believe would be
	// corrected only by an email that may never come.
	for (const root of [bank, paypal, cold]) {
		expect(heading(root)).toBe(copy.INDETERMINATE_HEADING);
		expect(shown(root, '.prose')).toContain('Nothing here will charge you a second time.');
		expect(controls(root)).toEqual([]);
	}
});

// a fund grants rather than charges, and the fund is the donor's own rather than a processor's —
// so no screen a fund's donor waits under names a charge or a label from the rail vocabulary.
it('words every screen a fund’s donor waits under as a grant from their own fund', () => {
	const processing = takeoverFor({ step: 'processing', method: 'daf' }, CONFIG, money);
	expect(processing.totalLabel).toBe('Grant requested');
	expect(processing.receiptNote).toBe('Your fund has not paid this grant yet.');

	const settling = draw({ step: 'processing', method: 'daf' });
	expect(heading(settling)).toBe(copy.PROCESSING_HEADING);
	expect(shown(settling, '.prose')).toBe(
		'Your fund has your grant request and pays Helping Hands directly. Helping Hands has been told your gift is coming.'
	);

	const unread = draw({ step: 'indeterminate', method: 'daf' });
	expect(shown(unread, '.prose')).toContain('Your gift has been sent to your fund for approval.');

	for (const root of [settling, unread]) {
		expect(shown(root, '.prose')).not.toContain('charged');
		expect(controls(root)).toEqual([]);
	}
	// every other rail's settling total is still a charge.
	expect(takeoverFor({ step: 'processing', method: 'card' }, CONFIG, money).totalLabel).toBe(
		copy.TO_BE_CHARGED
	);
});

// the two outcomes only the bank rail reaches: `outcomeOfTermination` in
// @better-giving/form/embed/paypal returns neither. the projection carries no rail on either state,
// so neither screen has one to be worded off — what is asserted is that both keep the bank's own
// words, which is what a later pass making them rail-generic would lose.
it('keeps the microdeposit and expired screens the bank rail’s own words', () => {
	const verify = draw({ step: 'awaitingVerification', deadline: null });
	expect(shown(verify, '.prose')).toBe(copy.verifyBody('Helping Hands'));
	expect(shown(verify, '.prose')).toContain('Two small deposits');
	expect(shown(draw({ step: 'verificationExpired' }), '.prose')).toBe(copy.EXPIRED_BODY);
});

it('states the verification deadline as a date, and draws no block without one', () => {
	const dated = draw({ step: 'awaitingVerification', deadline: Date.UTC(2026, 8, 20) });
	expect(heading(dated)).toBe(copy.VERIFY_HEADING);
	expect(shown(dated, '.attention')).toContain('Verify by ');

	// a deadline the flow does not have is a block that does not render: a manufactured one is worse
	// than none.
	const undated = draw({ step: 'awaitingVerification', deadline: null });
	expect(shown(undated, '.attention')).toBe('');
});

it('offers a start-over where the verification window closed', () => {
	const root = draw({ step: 'verificationExpired' });

	expect(heading(root)).toBe(copy.EXPIRED_HEADING);
	expect(shown(root, '.prose')).toContain('Nothing was charged.');
	expect(controls(root)).toEqual([copy.START_AGAIN]);
});

it('thanks the donor with a quiet way back and no loud one', () => {
	const withReceipt = { ...CONFIG, receipts: true };
	const root = draw({ step: 'success' }, withReceipt);

	expect(heading(root)).toBe(copy.SUCCESS_HEADING);
	expect(shown(root, '.prose')).toBe(copy.successBody('Helping Hands', true));
	expect(controls(root)).toEqual([copy.BACK_TO_START]);
	// no failure survives onto this screen: the render is total over the descriptor.
	expect(shown(root, '.message')).toBe('');
});

it('thanks the donor without promising a receipt where the config says nothing about one', () => {
	const root = draw({ step: 'success' });

	expect(shown(root, '.prose')).toBe('Helping Hands has your gift.');
	expect(root.textContent).not.toContain('A receipt is on its way');
});

// a gift sent from the donor's own wallet: the address screen, its closed reading, the expired ending
// and the thank-you that states no figure.
const COINS: FormConfig = {
	...CONFIG,
	paymentMethods: ['card', 'crypto'],
	coins: [
		{ coin: 'xrp', ticker: 'xrp', name: 'Ripple', network: 'xrp', memoRequired: true },
		{
			coin: 'usdttrc20',
			ticker: 'usdt',
			name: 'Tether USD (Tron)',
			network: 'trx',
			memoRequired: false
		}
	]
};
/** a quote that stated no gift figure in coin, which is the account the total alone is read from. */
const UNSTATED = {
	address: 'TbdBAaeHZo9WeEtpitUFqfEuUXDRfLpjeV',
	memo: null,
	coin: 'usdttrc20',
	network: 'Tron',
	coinAmount: '25.004187',
	validUntil: '2023-11-21T12:00:00.000Z',
	qr: { rows: ['110', '011', '101'] }
};
/** the gift alone, whose difference from the total above is the fee the donor covered. */
const DEPOSIT = { ...UNSTATED, giftCoinAmount: '24.754187' };
/** six days and a bit, which is what a freshly minted address has (`expiresIn` in the same file). */
const EXPIRES_IN = 6 * 24 * 60 * 60 * 1000 + 13 * 60 * 60 * 1000;
const AWAITING = {
	step: 'awaitingDeposit',
	deposit: DEPOSIT,
	totalMinor: 2525,
	feeMinor: 25,
	email: 'donor@example.org',
	expiresIn: EXPIRES_IN,
	closed: false
} as const;

it('states where and how much to send a crypto gift, with a way back to the coin', () => {
	const screen = takeoverFor(AWAITING, COINS, money);

	expect(screen.heading).toBe('Send your gift');
	expect(screen.receipt).toBe('none');
	expect(screen.primary).toBe(null);
	expect(screen.secondary).toEqual({ label: 'Use a different coin' });
	// the way out is what makes this line the one screen that writes one: the details are in the
	// donor's inbox, which is the whole reason they may close the page.
	expect(screen.secondaryNote).toBe('Also sent to donor@example.org.');
	expect(screen.deposit).toMatchObject({
		ticker: 'USDT',
		network: 'Tron',
		networkWarning: 'Send on this network only, or your gift may not reach Helping Hands.',
		// the three rows, and the fee is the difference between the other two rather than a third
		// figure off the wire: whatever rounding each arrived with, the account still adds up.
		gift: { figure: '24.754187', worth: '$25.00' },
		fee: { figure: '0.250000', worth: '$0.25' },
		total: { figure: '25.004187', worth: '$25.25' },
		instruction: { lead: 'Send ', toAddress: ' to this address ', andMemo: ' and include memo ' },
		address: 'TbdBAaeHZo9WeEtpitUFqfEuUXDRfLpjeV',
		memo: null,
		qr: ['110', '011', '101'],
		status: 'Waiting for your gift'
	});
	// the line itself is the block's to write and tick (`expiry` in @better-giving/form/deposit);
	// what this page hands over is how long is left, the moment it closes at, and the words.
	expect(screen.deposit?.expiry.left).toBe(EXPIRES_IN);
	expect(screen.deposit?.expiry.moment).toMatch(/^November 21, 2023 at \d{1,2}:\d\d [AP]M$/);
	expect(screen.deposit?.expiry.words(6, 'day')).toBe('Expires in 6 days');
	expect(screen.deposit?.expiry.words(1, 'day')).toBe('Expires in 1 day');
	// the two short units take no plural, which is what tells them from a clipped word.
	expect(screen.deposit?.expiry.words(1, 'hour')).toBe('Expires in 1 hr');
	expect(screen.deposit?.expiry.words(29, 'minute')).toBe('Expires in 29 min');
});

it('puts the memo behind the same caution as the network, and names an unlisted coin by its code', () => {
	const xrp = takeoverFor(
		{ ...AWAITING, deposit: { ...DEPOSIT, coin: 'xrp', network: 'xrp', memo: '3198472051' } },
		COINS,
		money
	);
	expect(xrp.deposit?.memo).toBe('3198472051');
	// one caution rather than two: both dangers of a send are read behind the one mark on the
	// network row, and the payment carrying a memo is what adds the second sentence.
	expect(xrp.deposit?.networkWarning).toBe(
		'Send on this network only, or your gift may not reach Helping Hands. Include the memo, or it cannot be matched to you.'
	);

	const unlisted = takeoverFor(
		{ ...AWAITING, deposit: { ...DEPOSIT, coin: 'dogecoin' } },
		COINS,
		money
	);
	expect(unlisted.deposit?.ticker).toBe('DOGECOIN');
});

it('states the total alone where the quote named no gift figure, and no fee where none was covered', () => {
	const unstated = takeoverFor({ ...AWAITING, deposit: UNSTATED }, COINS, money);
	// a fee stated beside a gift no figure names would be a deduction from nothing, so both go.
	expect(unstated.deposit?.gift).toBe(null);
	expect(unstated.deposit?.fee).toBe(null);
	expect(unstated.deposit?.total).toEqual({ figure: '25.004187', worth: '$25.25' });

	const declined = takeoverFor(
		{
			...AWAITING,
			feeMinor: 0,
			totalMinor: 2500,
			deposit: { ...UNSTATED, giftCoinAmount: UNSTATED.coinAmount }
		},
		COINS,
		money
	);
	expect(declined.deposit?.gift).toEqual({ figure: '25.004187', worth: '$25.00' });
	expect(declined.deposit?.fee).toBe(null);
});

it('withdraws the address once its send-by passes here, and offers no control', () => {
	const root = draw({ ...AWAITING, closed: true });

	expect(heading(root)).toBe('Checking for your gift');
	expect(shown(root, '.prose')).toMatch(
		/^The address for this gift closed on November 21, 2023 at .+\. If you sent your gift before then, this page changes when it arrives\.$/
	);
	expect(takeoverFor({ ...AWAITING, closed: true }, COINS, money).deposit).toBe(null);
	expect(controls(root)).toEqual([]);
});

it('tells a donor whose address closed not to send to it, and offers a new one', () => {
	const root = draw({ step: 'depositExpired' });

	expect(heading(root)).toBe(copy.EXPIRED_HEADING);
	expect(shown(root, '.prose')).toBe(
		'The address for this gift closed before anything arrived. Do not send to it now.'
	);
	expect(controls(root)).toEqual([copy.START_AGAIN]);
});

it('thanks a crypto donor for a gift that arrived, stating no figure', () => {
	const withReceipt = { ...COINS, receipts: true };
	const screen = takeoverFor({ step: 'success', method: 'crypto' }, withReceipt, money);
	expect(screen.receipt).toBe('none');
	expect(screen.announce).toBe('Your gift arrived.');

	const root = draw({ step: 'success', method: 'crypto' }, withReceipt);
	expect(heading(root)).toBe(copy.SUCCESS_HEADING);
	expect(shown(root, '.prose')).toBe(
		'Your gift arrived. A receipt is on its way to your email. Helping Hands has your gift.'
	);
	expect(controls(root)).toEqual([copy.BACK_TO_START]);
});

it('carries the rail’s own sentence and never the fix written for whoever deployed it', () => {
	const plain = draw({ step: 'failed', message: 'The donation could not be completed.' });
	expect(heading(plain)).toBe(copy.FAILED_HEADING);
	expect(shown(plain, '.message')).toBe('The donation could not be completed.');
	expect(controls(plain)).toEqual([copy.TRY_AGAIN]);

	const declined = draw({
		step: 'failed',
		message: 'Your card was declined.',
		refusedByRail: true
	});
	expect(shown(declined, '.message')).toBe('Your card was declined.');

	// the fix names a publishable key, an environment value or a screen in /admin, and the donor in
	// front of the card can act on none of it.
	const misconfigured = draw({
		step: 'failed',
		message: 'This donation could not be started, and nothing was charged.',
		fix: 'Set STRIPE_PUBLISHABLE_KEY on the deployment.'
	});
	expect(misconfigured.textContent).not.toContain('STRIPE_PUBLISHABLE_KEY');
});

it('tells a donor back from wherever they authorized that the flow is still finding out', () => {
	const root = draw({ step: 'working', phase: 'resuming' });

	expect(heading(root)).toBe(copy.RESUMING_HEADING);
	expect(shown(root, '.prose')).toBe(copy.RESUMING_BODY);
	expect(controls(root)).toEqual([]);
});

it('tells a donor who just pressed Give or Authorize that the gift is being confirmed', () => {
	const root = draw({ step: 'working', fv: GIFT, phase: 'confirming', method: 'card' });

	expect(heading(root)).toBe(copy.CONFIRMING_HEADING);
	expect(shown(root, '.prose')).toBe(copy.CONFIRMING_BODY);
	expect(controls(root)).toEqual([]);
});

it('draws nothing at all on a numbered step', () => {
	const root = draw({ step: 'amount', missing: [] });

	expect(heading(root)).toBe('');
	expect(controls(root)).toEqual([]);
	expect(shown(root, '.prose, .aside, .message, .attention')).toBe('');
});

it('draws the no-form notice in the page’s own dress', () => {
	const root = mount(<DonateNotice />);
	expect(root.querySelector('.notice')?.textContent).toBe(copy.NO_FORM);
	// the card's dress reaches none of it: there is no form here for the form's sheets to paint.
	expect(root.querySelector('[part]')).toBe(null);
});

describe('the thank-you’s employer ask', () => {
	const ASK: EmployerAsk = {
		phase: 'asking',
		giftUrl: 'https://give.example.org/gift/tok_1',
		refused: false,
		refusal: null,
		email: 'donor@example.org'
	};
	const asked = (refusal: EmployerAsk['refusal']): State => ({
		step: 'success',
		employer: {
			...ASK,
			refused: refusal === 'refused' || refusal === 'unconfirmed',
			refusal
		}
	});

	it.each([
		['refused', copy.EMPLOYER_REFUSAL],
		['unconfirmed', copy.EMPLOYER_UNCONFIRMED],
		['blank', copy.EMPLOYER_BLANK]
	] as const)(
		'says why an ask stands refused (%s) in its own words under the box, leaving the region to the card',
		(why, words) => {
			const screen = takeoverFor(asked(why), CONFIG, money);

			expect(screen.employer?.refusal).toBe(words);
			expect(screen.employer?.boxRefused).toBe(why === 'blank');
			// the card says a refusal as it lands, not while it stands (`askSaid` in ./card.tsx).
			expect(screen.announce).toBe('');
		}
	);

	/** the block over a flow the case drives: `refuse` sets the refusal the next Send leaves. */
	function block() {
		const sends: number[] = [];
		let refuse: EmployerAsk['refusal'] = null;
		let draw = (_: EmployerAsk['refusal']) => {};
		function Mounted() {
			const [refusal, setRefusal] = useState<EmployerAsk['refusal']>(null);
			draw = setRefusal;
			return (
				<EmployerAskBlock
					screen={takeoverFor(asked(refusal), CONFIG, money).employer}
					box={{ name: 'employer', value: '', onChange: () => {} }}
					busy={false}
					given={false}
					onSend={() => {
						sends.push(sends.length);
						setRefusal(refuse);
					}}
					onSkip={() => {}}
				/>
			);
		}
		const root = mount(<Mounted />);
		const box = root.querySelector('input');
		const send = root.querySelector('.employer-actions > button[type="submit"]');
		if (!(box instanceof HTMLInputElement) || !(send instanceof HTMLButtonElement)) {
			throw new Error('no employer box or Send');
		}
		return {
			root,
			box,
			send,
			sends,
			refuseWith: (why: EmployerAsk['refusal']) => {
				refuse = why;
			},
			draw: (why: EmployerAsk['refusal']) => act(() => draw(why))
		};
	}

	it('takes a blank Send, muted and pressable, and refuses it under the box with the caret in it', () => {
		const { root, box, send, sends, refuseWith } = block();
		expect(send.getAttribute('aria-disabled')).toBe('true');
		expect(send.hasAttribute('disabled')).toBe(false);

		refuseWith('blank');
		act(() => send.click());

		expect(sends).toHaveLength(1);
		expect(root.querySelector('#employer-problem')?.textContent).toBe(copy.EMPLOYER_BLANK);
		expect(box.getAttribute('aria-invalid')).toBe('true');
		expect(box.getAttribute('aria-describedby')).toBe('employer-hint employer-problem');
		expect(document.activeElement).toBe(box);
	});

	it('describes a blank Send by the ask hint, and drops it once a name is given', () => {
		let give = (_: boolean) => {};
		function Mounted() {
			const [given, setGiven] = useState(false);
			give = setGiven;
			return (
				<EmployerAskBlock
					screen={takeoverFor(asked(null), CONFIG, money).employer}
					box={{ name: 'employer', value: '', onChange: () => {} }}
					busy={false}
					given={given}
					onSend={() => {}}
					onSkip={() => {}}
				/>
			);
		}
		const root = mount(<Mounted />);
		const send = root.querySelector('.employer-actions > button[type="submit"]');
		if (!(send instanceof HTMLButtonElement)) throw new Error('no Send');

		const hint = document.getElementById(send.getAttribute('aria-describedby') ?? '');
		expect(hint?.textContent).toBe(copy.EMPLOYER_ASK_HINT);
		expect(root.contains(hint)).toBe(true);

		act(() => give(true));
		expect(send.hasAttribute('aria-disabled')).toBe(false);
		expect(send.hasAttribute('aria-describedby')).toBe(false);
	});

	it('puts the caret back in the box on a blank Send repeated', () => {
		const { box, send, sends, refuseWith } = block();
		refuseWith('blank');
		act(() => send.click());

		act(() => send.focus());
		act(() => send.click());

		expect(sends).toHaveLength(2);
		expect(document.activeElement).toBe(box);
	});

	it('marks nothing about the box over a write that was refused', () => {
		const { box, send, draw } = block();
		act(() => send.focus());

		draw('unconfirmed');

		expect(box.hasAttribute('aria-invalid')).toBe(false);
		expect(document.activeElement).toBe(send);
	});
});

describe('a saved pledge’s screens', () => {
	const STOCK: Pledge = {
		id: 'p1',
		method: 'stock',
		reference: 'CFCP-AAPL-7Q2D',
		receiptTo: 'maya.okafor@example.org',
		ticker: 'AAPL',
		shares: '50',
		deliverTo: 'Harbor Street Securities',
		dtcNumber: '0164',
		accountNumber: 'Z12-345678',
		accountName: 'Cedar Fork Community Pantry Inc.'
	};
	const IRA: Pledge = {
		id: 'p2',
		method: 'ira_qcd',
		reference: 'CFCP-IRA-4K9M',
		receiptTo: 'maya.okafor@example.org',
		amountMinor: 10_000,
		custodian: 'Fidelity Investments',
		payeeName: 'Cedar Fork Community Pantry Inc.',
		ein: '47-3829105',
		mailingAddress: '412 Alder Lane, Suite 3\nCedar Fork, OR 97330'
	};
	const ORG: FormConfig = { ...CONFIG, orgLegalName: 'Cedar Fork Community Pantry Inc.' };
	const NOT_ADVICE =
		'This is general information, not tax advice. Talk to your tax adviser about your own situation.';

	function pledged(
		pledge: Pledge,
		phase: 'pending' | 'telling' | 'told',
		refused = false,
		onCopied?: (words: string) => void
	): HTMLElement {
		return draw({ step: 'pledged', pledge, phase, refused }, ORG, onCopied);
	}

	/** each row of one list as its label, its value and the name of its Copy, if it has one. */
	function rows(root: HTMLElement, list: string): (string | null)[][] {
		const dl = root.querySelector(`.${list}`);
		if (!(dl instanceof HTMLElement) || dl.hidden) return [];
		return [...dl.querySelectorAll('.pledge-row')].map((row) => [
			row.querySelector('dt')?.textContent ?? '',
			row.querySelector('dd')?.textContent ?? '',
			row.querySelector('button')?.getAttribute('aria-label') ?? null
		]);
	}

	/** the notice standing, as its role (`''` for none), its title and its body. */
	function notices(root: HTMLElement): string[][] {
		return [...root.querySelectorAll<HTMLElement>('.ds-notice-card')]
			.filter((node) => !node.hidden)
			.map((node) => [
				node.getAttribute('role') ?? '',
				node.querySelector('.ds-notice-card-title')?.textContent ?? '',
				node.querySelector('.ds-notice-card-body')?.textContent ?? ''
			]);
	}

	function benefits(root: HTMLElement): string[] {
		const panel = root.querySelector('.pledge-benefits');
		if (!(panel instanceof HTMLElement) || panel.hidden) return [];
		return [...panel.querySelectorAll('.benefits > *')].map((node) => node.textContent ?? '');
	}

	function primary(root: HTMLElement): string {
		const node = root.querySelector('button[part~="action"]');
		return node instanceof HTMLElement && !node.hidden ? (node.textContent ?? '') : '';
	}

	function link(root: HTMLElement): HTMLAnchorElement | null {
		const node = root.querySelector('.foot > a');
		return node instanceof HTMLAnchorElement && !node.hidden ? node : null;
	}

	const STOCK_DETAILS = [
		['Deliver to', 'Harbor Street Securities', null],
		['DTC number', '0164', 'Copy DTC number'],
		['Account number', 'Z12-345678', 'Copy account number'],
		['Account name', 'Cedar Fork Community Pantry Inc.', null],
		['Reference', 'CFCP-AAPL-7Q2D', 'Copy reference']
	];
	const STOCK_BENEFITS = [
		'Benefits of donating appreciated stock',
		'If you itemize and give shares you have held for more than a year, you may be able to deduct their market value on the day of the gift, and you generally avoid the capital gains tax you would owe if you sold them. Deduction limits apply.',
		NOT_ADVICE
	];

	it('lists a pending stock gift’s transfer details, each value a donor hands on with its Copy', () => {
		const root = pledged(STOCK, 'pending');

		expect(heading(root)).toBe('Your stock gift is pending');
		expect(shown(root, '.prose')).toBe(
			'Ask your broker to transfer these shares using the details below. Your gift counts when they arrive.'
		);
		expect(rows(root, 'pledge-summary')).toEqual([
			['Shares', '50', null],
			['Ticker', 'AAPL', null]
		]);
		expect(rows(root, 'pledge-details')).toEqual(STOCK_DETAILS);
		expect(benefits(root)).toEqual(STOCK_BENEFITS);
		expect(notices(root)).toEqual([]);
		expect(primary(root)).toBe('I’ve contacted my broker');
		expect(link(root)?.textContent).toBe('Email these instructions');
		expect(link(root)?.getAttribute('href')).toMatch(/^mailto:\?subject=Stock%20gift%20to%20/);
		expect(root.querySelector('[disabled]')).toBeNull();
	});

	it('puts the error notice over Try again where the told press did not land, the pledge still listed', () => {
		const root = pledged(STOCK, 'pending', true);

		expect(heading(root)).toBe('Your stock gift is pending');
		expect(notices(root)).toEqual([
			[
				'',
				'We couldn’t tell the organization',
				'Your gift is saved. Check your connection and try again.'
			]
		]);
		// said by the card's region rather than the notice's, and cleared while the next press is out.
		const refused = { step: 'pledged', pledge: STOCK, refused: true } as const;
		expect(takeoverFor({ ...refused, phase: 'pending' }, ORG, money).announce).toBe(
			'We couldn’t tell the organization. Your gift is saved. Check your connection and try again.'
		);
		expect(takeoverFor({ ...refused, phase: 'telling' }, ORG, money).announce).toBe('');
		// under the benefits panel, directly over the press it asks for again.
		const notice = root.querySelector('.ds-notice-card-destructive');
		expect(notice?.previousElementSibling?.classList.contains('pledge-benefits')).toBe(true);
		expect(rows(root, 'pledge-details')).toEqual(STOCK_DETAILS);
		expect(primary(root)).toBe('Try again');
		expect(link(root)?.textContent).toBe('Email these instructions');
		expect(root.querySelector('[disabled]')).toBeNull();
	});

	it('says a pledge the told press could not find is not saved, and that Try again saves it anew', () => {
		const lost = { step: 'pledged', pledge: STOCK, refused: true, resave: 'needed' } as const;
		const root = draw({ ...lost, phase: 'pending' }, ORG);
		const body =
			'We couldn’t find your gift. Press Try again to save it again under a new reference.';

		expect(notices(root)).toEqual([['', 'We couldn’t tell the organization', body]]);
		expect(root.querySelector('.ds-notice-card-destructive')?.hasAttribute('hidden')).toBe(false);
		expect(takeoverFor({ ...lost, phase: 'pending' }, ORG, money).announce).toBe(
			`We couldn’t tell the organization. ${body}`
		);
		expect(takeoverFor({ ...lost, phase: 'telling' }, ORG, money).announce).toBe('');
		expect(primary(root)).toBe('Try again');
		expect(rows(root, 'pledge-details')).toEqual(STOCK_DETAILS);
	});

	it('names the new reference once the pledge is saved again, over the press that tells', () => {
		const anew: Pledge = { ...STOCK, id: 'p3', reference: 'CFCP-AAPL-8Z3P' };
		const resaved = { step: 'pledged', pledge: anew, refused: false, resave: 'done' } as const;
		const root = draw({ ...resaved, phase: 'pending' }, ORG);

		expect(heading(root)).toBe('Your stock gift is pending');
		expect(notices(root)).toEqual([
			[
				'',
				'We saved your gift again',
				'Your new reference is CFCP-AAPL-8Z3P. Use it for your transfer.'
			]
		]);
		// the info notice heads the block, over the lists that carry the new reference.
		const notice = root.querySelector('.ds-notice-card-info');
		expect(notice?.nextElementSibling?.classList.contains('pledge-summary')).toBe(true);
		expect(rows(root, 'pledge-details').at(-1)).toEqual([
			'Reference',
			'CFCP-AAPL-8Z3P',
			'Copy reference'
		]);
		expect(takeoverFor({ ...resaved, phase: 'pending' }, ORG, money).announce).toBe(
			'We saved your gift again. Your new reference is CFCP-AAPL-8Z3P. Use it for your transfer.'
		);
		expect(takeoverFor({ ...resaved, phase: 'telling' }, ORG, money).announce).toBe('');
		expect(primary(root)).toBe('I’ve contacted my broker');
		expect(root.querySelector('[disabled]')).toBeNull();
	});

	it('thanks a donor who told the organisation, naming where the receipt goes once the shares arrive', () => {
		const root = pledged(STOCK, 'told');

		expect(heading(root)).toBe('Thank you');
		expect(notices(root)).toEqual([
			[
				'',
				'We’ve told the organization',
				'Your gift counts when the shares arrive. We’ll email a receipt to maya.okafor@example.org then.'
			]
		]);
		expect(
			takeoverFor({ step: 'pledged', pledge: STOCK, phase: 'told', refused: false }, ORG, money)
				.arrival
		).toBe(
			'We’ve told the organization. Your gift counts when the shares arrive. We’ll email a receipt to maya.okafor@example.org then.'
		);
		expect(rows(root, 'pledge-summary')).toEqual([
			['Shares', '50', null],
			['Ticker', 'AAPL', null]
		]);
		expect(rows(root, 'pledge-details')).toEqual([]);
		expect(benefits(root)).toEqual([]);
		expect(primary(root)).toBe('');
		expect(link(root)).toBeNull();
		expect(controls(root)).toEqual(['Done']);
		expect(root.querySelector('.foot > button')?.className).toBe(
			'ds-btn ds-btn-secondary ds-btn-lg'
		);
		expect(root.querySelector('[disabled]')).toBeNull();
	});

	// the form's sheets size a pending screen by a takeover whose own shown pledge holds an unhidden
	// details list, and this page draws its pledge screens in the element's tree so those rules reach
	// them and no other takeover.
	describe('the form’s pending-screen rules', () => {
		const require = createRequire(import.meta.url);
		const PENDING = '.takeover:has(> .pledge:not([hidden])):has(.pledge-details:not([hidden]))';
		const scoped = ['parts.css', 'layout.css'].flatMap((sheet) =>
			[
				...readFileSync(require.resolve(`@better-giving/form/styles/${sheet}`), 'utf8')
					.replace(/\/\*[\s\S]*?\*\//g, '')
					.matchAll(/([^{}]+)\{/g)
			]
				.flatMap(([, list]) => (list ?? '').split(','))
				.map((selector) => selector.trim())
				.filter((selector) => selector.startsWith(PENDING))
		);

		it.each([
			['stock', STOCK],
			['IRA (QCD)', IRA]
		])('reach every part they name on a pending %s screen', (_rail, pledge) => {
			const root = pledged(pledge, 'pending');
			expect(scoped.length).toBeGreaterThan(0);
			expect(scoped.filter((selector) => root.querySelector(selector) === null)).toEqual([]);
			expect(link(root)?.className).toBe('ds-btn ds-btn-secondary ds-btn-lg');
		});

		it('reach nothing on the thank-you', () => {
			const root = pledged(STOCK, 'told');
			expect(scoped.filter((selector) => root.querySelector(selector) !== null)).toEqual([]);
		});

		// `> .pledge` in every rule is what this page's tree has to keep true.
		it.each([
			['stock', STOCK],
			['IRA (QCD)', IRA]
		])('find the %s pledge a direct child of the takeover section', (_rail, pledge) => {
			const block = pledged(pledge, 'pending').querySelector('.pledge');
			expect(block?.parentElement?.matches('section.takeover')).toBe(true);
		});

		it.each<[string, State, FormConfig?]>([
			['card thank-you', { step: 'success' }],
			['crypto thank-you', { step: 'success', method: 'crypto' }, COINS],
			['stock thank-you', { step: 'pledged', pledge: STOCK, phase: 'told', refused: false }, ORG],
			['IRA (QCD) thank-you', { step: 'pledged', pledge: IRA, phase: 'told', refused: false }, ORG],
			[
				'correction',
				{
					step: 'confirm',
					fv: GIFT,
					quote: QUOTE,
					reconciliation: {
						kind: 'adjusted',
						shownTotalMinor: 2575,
						totalMinor: 2606,
						deltaMinor: 31
					},
					method: 'card'
				}
			],
			[
				'mandate',
				{ step: 'mandate', fv: GIFT, quote: { ...QUOTE, mandate: { text: 'You authorise.' } } }
			],
			['redirecting', { step: 'redirecting', method: 'card' }],
			['processing', { step: 'processing', method: 'ach' }],
			['indeterminate', { step: 'indeterminate' }],
			['verification', { step: 'awaitingVerification', deadline: null }],
			['verification closed', { step: 'verificationExpired' }],
			['crypto address', AWAITING, COINS],
			['crypto address closed', { ...AWAITING, closed: true }, COINS],
			['crypto address expired', { step: 'depositExpired' }, COINS],
			['failure', { step: 'failed', message: 'Your card was declined.' }],
			['resuming', { step: 'working', phase: 'resuming' }],
			['confirming', { step: 'working', fv: GIFT, phase: 'confirming', method: 'card' }]
		])('reach nothing on the %s', (_screen, state, config) => {
			const root = draw(state, config);
			expect(scoped.filter((selector) => root.querySelector(selector) !== null)).toEqual([]);
		});
	});

	it('lists a pending IRA (QCD) gift’s payee details, the address on one line', () => {
		const root = pledged(IRA, 'pending');

		expect(heading(root)).toBe('Your IRA (QCD) gift is pending');
		expect(shown(root, '.prose')).toBe(
			'Ask your custodian to send this gift using the details below. Your gift counts when it arrives.'
		);
		expect(rows(root, 'pledge-summary')).toEqual([
			['Amount', '$100.00', null],
			['Custodian', 'Fidelity Investments', null]
		]);
		expect(rows(root, 'pledge-details')).toEqual([
			['Payee name', 'Cedar Fork Community Pantry Inc.', null],
			['EIN', '47-3829105', 'Copy EIN'],
			['Mailing address', '412 Alder Lane, Suite 3, Cedar Fork, OR 97330', 'Copy mailing address'],
			['Reference', 'CFCP-IRA-4K9M', 'Copy reference']
		]);
		expect(benefits(root)).toEqual([
			'Benefits of giving from an IRA',
			'If you are 70½ or older, you can give up to the IRS yearly limit from your traditional IRA. Your IRA custodian must pay us directly, not you and not a donor-advised fund. It can count toward any required minimum distribution and isn’t added to your taxable income (you can’t also deduct it).',
			'This is general information, not tax advice. Talk to your tax adviser or IRA custodian about your own situation.'
		]);
		expect(primary(root)).toBe('I’ve asked my custodian');
		expect(link(root)?.getAttribute('href')).toMatch(/^mailto:\?subject=IRA%20\(QCD\)%20gift/);
		expect(root.querySelector('[disabled]')).toBeNull();
	});

	it('words the IRA (QCD) error and thank-you in the same notices', () => {
		const refused = pledged(IRA, 'pending', true);
		expect(notices(refused).map(([role, title]) => [role, title])).toEqual([
			['', 'We couldn’t tell the organization']
		]);
		expect(primary(refused)).toBe('Try again');
		expect(refused.querySelector('[disabled]')).toBeNull();

		const told = pledged(IRA, 'told');
		expect(heading(told)).toBe('Thank you');
		expect(notices(told)).toEqual([
			[
				'',
				'We’ve told the organization',
				'Your gift counts when it arrives. We’ll email a receipt to maya.okafor@example.org then.'
			]
		]);
		expect(rows(told, 'pledge-summary')).toEqual([
			['Amount', '$100.00', null],
			['Custodian', 'Fidelity Investments', null]
		]);
		expect(controls(told)).toEqual(['Done']);
		expect(told.querySelector('[disabled]')).toBeNull();
	});

	it.each([
		['stock', STOCK, 'Your gift counts when the shares arrive.'],
		['IRA (QCD)', IRA, 'Your gift counts when it arrives.']
	])(
		'leaves the receipt out of a %s thank-you whose pledge has no address',
		(_rail, pledge, body) => {
			for (const receiptTo of ['', '  ']) {
				const blank: Pledge = { ...pledge, receiptTo };
				expect(notices(pledged(blank, 'told'))).toEqual([
					['', 'We’ve told the organization', body]
				]);
				expect(
					takeoverFor({ step: 'pledged', pledge: blank, phase: 'told', refused: false }, ORG, money)
						.arrival
				).toBe(`We’ve told the organization. ${body}`);
			}
		}
	);

	it('names a trimmed address in the thank-you', () => {
		const padded: Pledge = { ...IRA, receiptTo: ' maya.okafor@example.org ' };
		expect(notices(pledged(padded, 'told'))).toEqual([
			[
				'',
				'We’ve told the organization',
				'Your gift counts when it arrives. We’ll email a receipt to maya.okafor@example.org then.'
			]
		]);
	});

	it('marks the told press busy while it is in flight, still pressable', () => {
		const root = document.createElement('div');
		document.body.appendChild(root);
		const mounted = createRoot(root);
		act(() => {
			mounted.render(
				<TakeoverScreen
					screen={takeoverFor(
						{ step: 'pledged', pledge: STOCK, phase: 'telling', refused: false },
						ORG,
						money
					)}
					hidden={false}
					busy
					receipt={null}
					headingRef={createRef<HTMLHeadingElement>()}
					sectionRef={createRef<HTMLElement>()}
					deposit={null}
					employer={null}
					onPrimary={() => {}}
					onSecondary={() => {}}
					onCopied={() => {}}
					challengeMount={createRef<HTMLDivElement>()}
				/>
			);
		});
		onTestFinished(() => {
			act(() => mounted.unmount());
			root.remove();
		});
		const press = root.querySelector('button[part~="action"]');
		expect(press?.getAttribute('aria-busy')).toBe('true');
		expect(press?.textContent).toBe('I’ve contacted my broker');
		expect(press?.hasAttribute('disabled')).toBe(false);
	});

	describe('a Copy', () => {
		function clipboard(writeText: (text: string) => Promise<void>) {
			Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
			onTestFinished(() => {
				Reflect.deleteProperty(navigator, 'clipboard');
			});
		}

		function copyOf(root: HTMLElement, name: string): HTMLButtonElement {
			const node = root.querySelector(`button[aria-label="${name}"]`);
			if (!(node instanceof HTMLButtonElement)) throw new Error(`no ${name}`);
			return node;
		}

		it('copies its value, shows the tick and says so on the card’s region', async () => {
			const written: string[] = [];
			clipboard(async (text) => {
				written.push(text);
			});
			const said: string[] = [];
			const root = pledged(STOCK, 'pending', false, (words) => said.push(words));
			const button = copyOf(root, 'Copy reference');

			// described by the value it copies, so what it copies is said after its name.
			expect(root.querySelector(`#${button.getAttribute('aria-describedby')}`)?.textContent).toBe(
				'CFCP-AAPL-7Q2D'
			);
			await act(async () => {
				button.click();
			});

			expect(written).toEqual(['CFCP-AAPL-7Q2D']);
			expect(button.dataset.outcome).toBe('copied');
			expect(said).toEqual(['Reference copied.']);
		});

		// a `<dl>`'s row `<div>` holds `<dt>` and `<dd>` and nothing else
		// (https://html.spec.whatwg.org/multipage/grouping-content.html#the-dl-element), so a Copy stands
		// in the `<dd>` of the value it copies, described by the value's own `<span>` there.
		it('keeps each list to rows of a term and its description, with every Copy in its value', () => {
			const root = pledged(IRA, 'pending', false, () => {});
			const lists = [...root.querySelectorAll('.pledge dl')];
			expect(lists.length).toBeGreaterThan(0);
			for (const list of lists) {
				for (const row of list.children) {
					expect(row.tagName).toBe('DIV');
					expect([...row.children].map((node) => node.tagName)).toEqual(['DT', 'DD']);
				}
			}
			const copies = [...root.querySelectorAll('.pledge .copy')];
			expect(copies.length).toBeGreaterThan(0);
			for (const button of copies) {
				expect(button.parentElement?.tagName).toBe('DD');
				const value = root.querySelector(`#${button.getAttribute('aria-describedby')}`);
				expect(value?.tagName).toBe('SPAN');
				expect(value?.parentElement).toBe(button.parentElement);
			}
		});

		it('selects the value for copying by hand where the clipboard refused it', async () => {
			clipboard(() => Promise.reject(new Error('denied')));
			const said: string[] = [];
			const root = pledged(IRA, 'pending', false, (words) => said.push(words));
			const button = copyOf(root, 'Copy EIN');

			await act(async () => {
				button.click();
			});

			expect(button.dataset.outcome).toBe('failed');
			expect(said).toEqual(['EIN not copied. It is selected so you can copy it.']);
			expect(document.getSelection()?.toString()).toBe('47-3829105');
		});
	});
});
