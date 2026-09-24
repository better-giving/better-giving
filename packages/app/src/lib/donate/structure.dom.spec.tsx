import type { PaymentElementLike, StripeLike } from '@better-giving/form/embed/stripe';
import type { ChallengeSeam, TurnstileLike } from '@better-giving/form/embed/turnstile';
import type { FeeRules, FormConfig } from '@better-giving/form/v1';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished } from 'vitest';
import { DonateCard } from './card';

// the structure the form's sheets are written against, as this page draws it.
//
// this page draws the card by hand and dresses it from @better-giving/form's sheets, and several of
// their rules reach an element through the exact sibling or child it stands beside. the embed's own
// markup (the form package's views.ts) is what those rules are tested against there; nothing else
// would notice a wrapper added or a node moved here, because a rule that stops matching drops its
// declarations and errors nowhere. so each rule is matched against the element it is written for, in
// the state that draws the structure.
//
// the selector text is the sheet's own, copied verbatim. a rule reworded there has to be copied here
// again, which is the point: this list is what the page promises to keep matching.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no popover methods, and the closed choices' lists (./choice.tsx) are shown as one.
if (!('showPopover' in HTMLElement.prototype)) {
	Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {} });
}

/** packages/form/src/styles/layout.css */
const LAYOUT = {
	summaryThenGroup: "[part~='summary'] + .group",
	refusedField:
		":is(.field-row, .disclosure-inner, .dedication) > [part~='field']:has(+ .message:not([hidden]))",
	refusedTilesMessage: '.group > .tiles ~ .message',
	refusedGroup: '.group:has(+ .message:not([hidden]))',
	refusedDedicationTrigger: ".dedication:has(> .message:not([hidden])) > [data-part='trigger']"
} as const;

/** packages/form/src/styles/parts.css */
const PARTS = {
	floatingWords: ".floating > [part~='label'] > .label-words",
	feeWords: '.fee-decision > .row-label',
	feeSwitch: '.fee-decision > .switch',
	feeNoted: '.fee-decision:has(+ .fee-note:not([hidden]))',
	feePassThrough: '.fee-decision:not([hidden]) ~ :is(.fee-note, .figure)'
} as const;

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
	suggestedAmountsMinor: [1000, 2500, 5000],
	minAmountMinor: 500,
	maxAmountMinor: 500000,
	frequencies: ['one_time', 'monthly'],
	paymentMethods: ['card'],
	feeCoverage: 'optional',
	feeRules: FEE_RULES,
	locale: 'en-US',
	orgLegalName: 'Helping Hands',
	ein: '12-3456789',
	deductibilityStatement: 'Helping Hands is a 501(c)(3).',
	turnstileSiteKey: '1x00000000000000000000AA'
};

/** a payment provider that mounts, reports nothing, and never charges. */
function stripe(): StripeLike {
	const element = {
		mount: () => {},
		focus: () => {},
		collapse: () => {},
		on: () => {},
		off: () => {},
		destroy: () => {}
	} as unknown as PaymentElementLike;
	return {
		elements: () => ({ create: () => element, update: async () => {}, submit: async () => ({}) }),
		confirmPayment: () => new Promise(() => {}),
		retrievePaymentIntent: async () => ({})
	} as unknown as StripeLike;
}

const CHALLENGE: ChallengeSeam = {
	load: async () => {
		const api: TurnstileLike = { render: () => 'widget-1', reset: () => {}, remove: () => {} };
		return api;
	},
	delay: () => () => {}
};

async function card(): Promise<HTMLElement> {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const mounted = createRoot(host);
	act(() => {
		mounted.render(
			<DonateCard
				config={CONFIG}
				seams={{
					payment: { stripe: { load: async () => stripe(), delay: () => () => {} } },
					challenge: CHALLENGE
				}}
			/>
		);
	});
	onTestFinished(() => {
		act(() => {
			mounted.unmount();
		});
		host.remove();
	});
	await act(async () => {
		for (let at = 0; at < 4; at += 1) await Promise.resolve();
	});
	return host;
}

function one(root: HTMLElement, selector: string): HTMLElement {
	const node = root.querySelector(selector);
	if (!(node instanceof HTMLElement)) throw new Error(`nothing matched ${selector}`);
	return node;
}

function press(node: HTMLElement): void {
	act(() => {
		node.click();
	});
}

function type(root: HTMLElement, selector: string, value: string): void {
	const box = one(root, selector);
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, value);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

const CONTINUE = 'section.step:not([hidden]) > button[part~="action"]';

/**
 * whether a rule reaches one element, asked of the document rather than of the element.
 *
 * happy-dom keeps `Element.matches` answers per element and selector and does not drop one when a
 * sibling's `hidden` changes, so a rule asked about before a refusal answers the same after it;
 * `querySelectorAll` is evaluated afresh. its parser also refuses a `~` relative selector inside
 * `:has()` (it takes `+` and `>`), so that one form, trailing the selector, is evaluated by its
 * definition: the rest of the selector reaches the element and some later sibling matches what
 * follows the `~`.
 */
function matches(node: Element, selector: string): boolean {
	const all = (query: string) => [...document.querySelectorAll(query)];
	const later = /^(.*):has\(~ (.*)\)$/.exec(selector);
	if (later === null) return all(selector).includes(node);
	const [, own = '', sibling = ''] = later;
	if (!all(own).includes(node)) return false;
	const siblings = all(sibling);
	for (let next = node.nextElementSibling; next !== null; next = next.nextElementSibling) {
		if (siblings.includes(next)) return true;
	}
	return false;
}

/** every element a rule reaches, so a rule matching a stray node as well as its own is caught. */
function reached(root: HTMLElement, selector: string): HTMLElement[] {
	return [...root.querySelectorAll('*')].filter(
		(node): node is HTMLElement => node instanceof HTMLElement && matches(node, selector)
	);
}

it('reaches the amount’s refusal after the tray, and nothing else, when an amount is refused', async () => {
	const root = await card();
	press(one(root, '.tiles > label.other'));
	type(root, '#amount-entry', '1.00');
	press(one(root, CONTINUE));

	expect(one(root, '#amount-problem').hidden).toBe(false);
	expect(reached(root, LAYOUT.refusedTilesMessage)).toEqual([one(root, '#amount-problem')]);
});

it('reaches the box of a refused note, in the disclosure’s body', async () => {
	const root = await card();
	press(one(root, '.tiles > label:nth-of-type(2)'));
	press(one(root, '.disclosure.note input[type="checkbox"]'));
	const note = one(root, '#note');
	expect(matches(note, LAYOUT.refusedField)).toBe(false);

	press(one(root, CONTINUE));

	expect(one(root, '#note-problem').hidden).toBe(false);
	expect(matches(note, LAYOUT.refusedField)).toBe(true);
});

it('reaches the honoree’s box and the select beside it when a dedication is refused', async () => {
	const root = await card();
	press(one(root, '.tiles > label:nth-of-type(2)'));
	press(one(root, '.disclosure.tribute input[type="checkbox"]'));
	const honoree = one(root, '#tribute-honoree');
	const trigger = one(root, '#tribute-kind');
	expect(matches(trigger, LAYOUT.refusedDedicationTrigger)).toBe(false);

	press(one(root, CONTINUE));

	expect(one(root, '#tribute-honoree-problem').hidden).toBe(false);
	expect(matches(honoree, LAYOUT.refusedField)).toBe(true);
	expect(reached(root, LAYOUT.refusedDedicationTrigger)).toEqual([trigger]);
});

it('reaches the refused box in a plain row and in a floating one, and the floating label’s words', async () => {
	const root = await card();
	press(one(root, '.tiles > label:nth-of-type(2)'));
	press(one(root, CONTINUE));

	expect(reached(root, PARTS.floatingWords)).toEqual([
		one(root, 'label[for="first-name"] > span'),
		one(root, 'label[for="last-name"] > span')
	]);

	press(one(root, CONTINUE));

	const email = one(root, '#email');
	const first = one(root, '#first-name');
	expect(email.closest('.field-row')?.className).toBe('field-row');
	expect(first.closest('.field-row')?.className).toBe('field-row floating');
	expect(matches(email, LAYOUT.refusedField)).toBe(true);
	expect(matches(first, LAYOUT.refusedField)).toBe(true);
});

it('reaches the payment group under the summary, the fee decision’s parts, and the refused group', async () => {
	const root = await card();
	press(one(root, '.tiles > label:nth-of-type(2)'));
	press(one(root, CONTINUE));
	type(root, '#email', 'donor@example.org');
	type(root, '#first-name', 'Ada');
	type(root, '#last-name', 'Lovelace');
	press(one(root, CONTINUE));

	const give = one(root, 'section.step-give');
	const group = one(give, '.group:has(> [part~="payment"])');
	expect(reached(root, LAYOUT.summaryThenGroup)).toEqual([group]);

	const decision = one(root, 'label.fee-decision');
	expect(decision.hidden).toBe(false);
	expect(reached(root, PARTS.feeWords)).toEqual([one(decision, 'span.row-label')]);
	expect(reached(root, PARTS.feeSwitch)).toEqual([one(decision, 'span.switch')]);
	expect(one(root, '#fee-note').hidden).toBe(false);
	expect(reached(root, PARTS.feeNoted)).toEqual([decision]);
	// happy-dom answers `~ :is(a, b)` with the first sibling alone, so each branch is asked on its own.
	const [head = '', branches = ''] = PARTS.feePassThrough.split(/:is\((.*)\)$/);
	const passed = branches.split(', ').flatMap((branch) => reached(root, head + branch));
	expect(passed).toEqual([one(root, '#fee-note'), one(root, 'label.fee-decision ~ .figure')]);

	expect(matches(group, LAYOUT.refusedGroup)).toBe(false);
	press(one(root, 'button[part~="submit"]'));

	expect(one(root, '#payment-problem').hidden).toBe(false);
	expect(reached(root, LAYOUT.refusedGroup)).toEqual([group]);
});
