import type {
	PaymentChangeLike,
	PaymentElementLike,
	StripeLike
} from '@better-giving/form/embed/stripe';
import type { ChallengeSeams } from '@better-giving/form/embed/challenge';
import type { TurnstileLike } from '@better-giving/form/embed/turnstile';
import type { FeeRules, FormConfig } from '@better-giving/form/v1';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { DonateCard } from './card';
import * as copy from './copy';

// the consent under the note on this page's own card, held to the element's render conditions
// (packages/form/src/views.ts, `notePublicRow`). the flags themselves are
// the flow's (packages/form/src/checkout.machine.ts, `TOGGLE_NOTE_PUBLIC`), so what is asserted
// here is that this card draws off them and posts what they hold.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no popover methods, and the closed choices' lists (./choice.tsx) are shown as one.
if (!('showPopover' in HTMLElement.prototype)) {
	Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {} });
}

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
	frequencies: ['one_time'],
	paymentMethods: ['card'],
	feeCoverage: 'optional',
	feeRules: FEE_RULES,
	locale: 'en-US',
	orgLegalName: 'Helping Hands',
	ein: '12-3456789',
	deductibilityStatement: 'Helping Hands is a 501(c)(3).',
	turnstileSiteKey: '1x00000000000000000000AA'
};

/** a payment provider that never charges, and reports a rail chosen when `pick` is called. */
function stripe() {
	const change: ((payload: PaymentChangeLike) => void)[] = [];
	const element = {
		mount: () => {},
		focus: () => {},
		collapse: () => {},
		on: (event: string, handler: (payload: PaymentChangeLike) => void) => {
			if (event === 'change') change.push(handler);
		},
		off: () => {},
		destroy: () => {}
	} as unknown as PaymentElementLike;
	const sdk = {
		elements: () => ({ create: () => element, update: async () => {}, submit: async () => ({}) }),
		confirmPayment: () => new Promise(() => {}),
		retrievePaymentIntent: async () => ({})
	} as unknown as StripeLike;
	return {
		load: async () => sdk,
		pick: (type: string) => {
			act(() => {
				for (const handler of [...change]) {
					handler({ collapsed: false, empty: false, value: { type } });
				}
			});
		}
	};
}

/** a challenge widget that answers with a token as soon as it is drawn. */
const CHALLENGE: ChallengeSeams = {
	turnstile: {
		load: async () => {
			const api: TurnstileLike = {
				render: (_node, options) => {
					options.callback?.('tok_spec');
					return 'widget-1';
				},
				reset: () => {},
				remove: () => {}
			};
			return api;
		},
		delay: () => () => {}
	}
};

async function flush(): Promise<void> {
	await act(async () => {
		for (let at = 0; at < 4; at += 1) await Promise.resolve();
	});
}

async function card() {
	const payment = stripe();
	const host = document.createElement('div');
	document.body.appendChild(host);
	const mounted = createRoot(host);
	act(() => {
		mounted.render(
			<DonateCard
				config={CONFIG}
				seams={{
					payment: { stripe: { load: payment.load, delay: () => () => {} } },
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
	await flush();
	return { root: host, payment };
}

function box(root: HTMLElement, selector: string): HTMLInputElement {
	const node = root.querySelector(selector);
	if (!(node instanceof HTMLInputElement)) throw new Error(`no input matched ${selector}`);
	return node;
}

function press(node: Element | null): void {
	if (!(node instanceof HTMLElement)) throw new Error('nothing to press');
	act(() => {
		node.click();
	});
}

/** the amount radio a donor reads as `name` (`$25`): the label wrapping it names it. */
function amountRadio(root: HTMLElement, name: string): HTMLInputElement {
	const radio = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
		(each) => each.closest('label')?.textContent === name
	);
	if (radio === undefined) throw new Error(`no amount named ${name}`);
	return radio;
}

/** a keystroke's value, through the prototype setter react's change tracking reads. */
function type(node: HTMLInputElement | HTMLTextAreaElement, value: string): void {
	act(() => {
		const proto = Object.getPrototypeOf(node) as object;
		Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(node, value);
		node.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

const NOTE_TOGGLE = '.disclosure.note > .check-row input[type="checkbox"]';
const PUBLIC = '#note-public';
const ANONYMOUS = '#note-anonymous';

it('draws neither row while the note is shut', async () => {
	const { root } = await card();

	expect(root.querySelector(PUBLIC)).toBeNull();
	expect(root.querySelector(ANONYMOUS)).toBeNull();
});

it('draws the first row unticked when the note opens, named by its words and described by the hint', async () => {
	const { root } = await card();
	press(box(root, NOTE_TOGGLE));

	const shown = box(root, PUBLIC);
	expect(shown.checked).toBe(false);
	expect(root.querySelector(ANONYMOUS)).toBeNull();
	expect(root.querySelector(`#${shown.getAttribute('aria-labelledby')}`)?.textContent).toBe(
		'Show my note on Helping Hands’s page'
	);
	expect(root.querySelector(`#${shown.getAttribute('aria-describedby')}`)?.textContent).toBe(
		copy.NOTE_PUBLIC_HINT
	);
	// the box comes after the note in the tree, so Tab reaches it from the note.
	const note = root.querySelector('#note');
	expect(note?.compareDocumentPosition(shown)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

it('draws the second row unticked once the first is ticked, keeping the first box in place', async () => {
	const { root } = await card();
	press(box(root, NOTE_TOGGLE));
	type(root.querySelector('textarea#note') as HTMLTextAreaElement, 'For the river project.');
	const shown = box(root, PUBLIC);
	shown.focus();
	press(shown);

	expect(box(root, PUBLIC)).toBe(shown);
	expect(shown.checked).toBe(true);
	expect(document.activeElement).toBe(shown);
	const anonymous = box(root, ANONYMOUS);
	expect(anonymous.checked).toBe(false);
	expect(anonymous.closest('.check-row')?.classList.contains('sub')).toBe(true);
	expect(shown.compareDocumentPosition(anonymous)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

it('groups the two rows under the first one’s words, so the second is never read without them', async () => {
	const { root } = await card();
	press(box(root, NOTE_TOGGLE));
	press(box(root, PUBLIC));

	const group = box(root, ANONYMOUS).closest('[role="group"]');
	expect(group?.contains(box(root, PUBLIC))).toBe(true);
	expect(root.querySelector(`#${group?.getAttribute('aria-labelledby')}`)?.textContent).toBe(
		'Show my note on Helping Hands’s page'
	);
});

it('keeps showing the first-name hint as the first box’s description while Anonymous is ticked, and after untick', async () => {
	const { root } = await card();
	press(box(root, NOTE_TOGGLE));
	press(box(root, PUBLIC));
	press(box(root, ANONYMOUS));

	expect(box(root, ANONYMOUS).checked).toBe(true);
	expect(root.querySelector('#note-public-hint')?.textContent).toBe(copy.NOTE_PUBLIC_HINT);
	expect(box(root, PUBLIC).getAttribute('aria-describedby')).toBe('note-public-hint');

	press(box(root, ANONYMOUS));
	expect(root.querySelector('#note-public-hint')?.textContent).toBe(copy.NOTE_PUBLIC_HINT);
	expect(box(root, PUBLIC).getAttribute('aria-describedby')).toBe('note-public-hint');
});

it('resets the second row when the first is unticked, and both when the note is', async () => {
	const { root } = await card();
	press(box(root, NOTE_TOGGLE));
	press(box(root, PUBLIC));
	press(box(root, ANONYMOUS));
	expect(box(root, ANONYMOUS).checked).toBe(true);

	press(box(root, PUBLIC));
	expect(root.querySelector(ANONYMOUS)).toBeNull();
	press(box(root, PUBLIC));
	expect(box(root, ANONYMOUS).checked).toBe(false);

	press(box(root, ANONYMOUS));
	press(box(root, NOTE_TOGGLE));
	expect(root.querySelector(PUBLIC)).toBeNull();
	press(box(root, NOTE_TOGGLE));
	expect(box(root, PUBLIC).checked).toBe(false);
	expect(root.querySelector(ANONYMOUS)).toBeNull();
});

describe('the gift it posts', () => {
	/** the quote requests the card posts, each read back as the body it sent; none is answered. */
	function sent(): Record<string, unknown>[] {
		const bodies: Record<string, unknown>[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn((_url: string, init?: RequestInit) => {
				bodies.push(JSON.parse(String(init?.body)));
				return new Promise<Response>(() => {});
			})
		);
		onTestFinished(() => {
			vi.unstubAllGlobals();
		});
		return bodies;
	}

	const CONTINUE = 'section.step:not([hidden]) > button[part~="action"]';

	/** a note written and the ticks pressed, then the gift given by card. */
	async function give(ticks: readonly string[]): Promise<Record<string, unknown>> {
		const bodies = sent();
		const { root, payment } = await card();
		press(amountRadio(root, '$25'));
		press(box(root, NOTE_TOGGLE));
		type(root.querySelector('textarea#note') as HTMLTextAreaElement, 'For the river project.');
		for (const tick of ticks) press(box(root, tick));
		press(root.querySelector(CONTINUE));
		await flush();
		type(box(root, '#email'), 'donor@example.org');
		type(box(root, '#first-name'), 'Ada');
		type(box(root, '#last-name'), 'Lovelace');
		press(root.querySelector(CONTINUE));
		await flush();
		payment.pick('card');
		press(root.querySelector('button[part~="submit"]'));
		expect(bodies).toHaveLength(1);
		const [body] = bodies;
		if (body === undefined) throw new Error('nothing posted');
		return body;
	}

	it('carries neither flag where neither box was ticked', async () => {
		const body = await give([]);
		expect(body).toMatchObject({ note: 'For the river project.' });
		expect(body).not.toHaveProperty('note_public');
		expect(body).not.toHaveProperty('note_anonymous');
	});

	it('carries note_public alone where only the first was ticked', async () => {
		const body = await give([PUBLIC]);
		expect(body).toMatchObject({ note: 'For the river project.' });
		expect(body).toMatchObject({ note_public: true });
		expect(body).not.toHaveProperty('note_anonymous');
	});

	it('carries both where both were ticked', async () => {
		const body = await give([PUBLIC, ANONYMOUS]);
		expect(body).toMatchObject({ note: 'For the river project.' });
		expect(body).toMatchObject({ note_public: true, note_anonymous: true });
	});

	// a note that was asked for is required (`missingAmountDecisions` in packages/form/src/value.ts),
	// so a ticked box over a blank note never reaches a post as a flag with nothing to show.
	it('posts nothing where a box is ticked over a blank note, and goes on once the note is written', async () => {
		const bodies = sent();
		const { root } = await card();
		press(amountRadio(root, '$25'));
		press(box(root, NOTE_TOGGLE));
		press(box(root, PUBLIC));

		press(root.querySelector(CONTINUE));
		await flush();

		expect(root.querySelector('section.step:not([hidden]) #email')).toBeNull();
		expect(bodies).toEqual([]);

		type(root.querySelector('textarea#note') as HTMLTextAreaElement, 'For the river project.');
		press(root.querySelector(CONTINUE));
		await flush();

		expect(root.querySelector('section.step:not([hidden]) #email')).not.toBeNull();
	});
});
