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
	venmo: { percent: 0.0349, fixedMinor: 49 }
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
