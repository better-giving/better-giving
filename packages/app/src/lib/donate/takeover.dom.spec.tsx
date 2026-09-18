import type { State } from '@better-giving/form/connect';
import { formatMinor } from '@better-giving/form/money';
import type { FeeRules, FormConfig, Quote } from '@better-giving/form/v1';
import type { FormValue } from '@better-giving/form/value';
import { act, createRef, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished } from 'vitest';
import * as copy from './copy';
import { DonateNotice } from './notice';
import { takeoverFor, TakeoverScreen } from './takeover';

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
	crypto: { percent: 0.01, fixedMinor: 0 }
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
function draw(state: State): HTMLElement {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const mounted = createRoot(host);
	act(() => {
		mounted.render(
			<TakeoverScreen
				screen={takeoverFor(state, CONFIG, money)}
				hidden={false}
				busy={false}
				receipt={null}
				headingRef={createRef<HTMLHeadingElement>()}
				deposit={null}
				onPrimary={() => {}}
				onSecondary={() => {}}
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
	const root = draw({ step: 'success' });

	expect(heading(root)).toBe(copy.SUCCESS_HEADING);
	expect(shown(root, '.prose')).toBe(copy.successBody('Helping Hands'));
	expect(controls(root)).toEqual([copy.BACK_TO_START]);
	// no failure survives onto this screen: the render is total over the descriptor.
	expect(shown(root, '.message')).toBe('');
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
	const screen = takeoverFor({ step: 'success', method: 'crypto' }, COINS, money);
	expect(screen.receipt).toBe('none');
	expect(screen.announce).toBe('Your gift arrived.');

	const root = draw({ step: 'success', method: 'crypto' });
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

it('draws nothing at all on a numbered step', () => {
	const root = draw({ step: 'amount', missing: [] });

	expect(heading(root)).toBe('');
	expect(controls(root)).toEqual([]);
	expect(shown(root, '.prose, .aside, .message, .attention')).toBe('');
});

it('draws the no-form notice in the page’s own dress, naming nobody it was given nobody for', () => {
	const bare = mount(<DonateNotice orgName={null} />);
	expect(bare.querySelector('.notice')?.textContent).toBe(copy.NO_FORM);
	expect(bare.querySelector('h1')).toBe(null);
	// the card's dress reaches none of it: there is no form here for the form's sheets to paint.
	expect(bare.querySelector('[part]')).toBe(null);

	const named = mount(<DonateNotice orgName="Helping Hands" />);
	expect(named.querySelector('.org-name')?.textContent).toBe('Helping Hands');
});
