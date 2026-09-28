import type {
	PaymentChangeLike,
	PaymentElementLike,
	StripeLike
} from '@better-giving/form/embed/stripe';
import type { ChallengeSeam, TurnstileLike } from '@better-giving/form/embed/turnstile';
import type { FeeRules, FormConfig } from '@better-giving/form/v1';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { ProgramMode } from '../forms/program-modes';
import { defaultDonationPage } from '../page/defaults';
import { DonateCard } from './card';
import { PageView, type PageViewProps } from './page-view';

// the Donation page's program chooser and the donation card, mounted together the way a route
// mounts them: the chooser's pick held beside the page and handed to the card as `pageProgram`
// wherever the page draws the chooser. what is asserted is the gift the card posts, which is the
// only place the pick is worth anything.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no popover methods, and the card's closed choices (./choice.tsx) are shown as one.
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

const PROGRAMS = [
	{ id: 'prog-food', name: 'Food pantry' },
	{ id: 'prog-coats', name: 'Winter coats' }
];

/** a form carrying no program at all. */
const NO_PROGRAM: FormConfig = {
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
	orgLegalName: 'Northside Neighbors',
	ein: '84-2913377',
	deductibilityStatement: 'Northside Neighbors is a 501(c)(3).',
	turnstileSiteKey: '1x00000000000000000000AA'
};

const CONFIG: FormConfig = { ...NO_PROGRAM, program: { mode: 'choice', options: PROGRAMS } };

const CHALLENGE: ChallengeSeam = {
	load: async () => {
		const api: TurnstileLike = { render: () => 'widget-1', reset: () => {}, remove: () => {} };
		return api;
	},
	delay: () => () => {}
};

/** the card processor, as a plain object, with the one report the flow needs off it: the rail. */
function paymentProvider() {
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
	const stripe = {
		elements: () => ({ create: () => element, update: async () => {}, submit: async () => ({}) }),
		confirmPayment: () => new Promise(() => {}),
		retrievePaymentIntent: async () => ({})
	} as unknown as StripeLike;
	return {
		load: async () => stripe,
		pick: (type: string) => {
			act(() => {
				for (const handler of [...change]) {
					handler({ collapsed: false, empty: false, value: { type } });
				}
			});
		}
	};
}

type Over = { readonly programMode: ProgramMode; readonly config: FormConfig };

/** the Donation page as a route mounts it, holding the chooser's pick for the card. */
async function donationPage({ programMode, config }: Over) {
	const payment = paymentProvider();
	const seams = {
		payment: { stripe: { load: payment.load, delay: () => () => {} } },
		challenge: CHALLENGE
	};
	const programs = config.program?.mode === 'choice' ? config.program.options : [];

	function Page() {
		const [chosen, setChosen] = useState<string | null>(null);
		const props: PageViewProps = {
			type: 'donation_page',
			page: defaultDonationPage({ name: 'Northside Neighbors' }),
			pageName: null,
			org: {
				name: 'Northside Neighbors',
				mission: null,
				vision: null,
				info: {
					legalName: 'Northside Neighbors',
					ein: '84-2913377',
					addressLines: ['40 Elm Street', 'Easton, PA 18042'],
					email: null,
					links: []
				}
			},
			look: { brandColour: null, shade: 'warm', corner: 'round' },
			sharing: { channels: [], message: '', url: 'https://give.example.org/donate' },
			goal: null,
			money: { locale: config.locale, currency: config.currency },
			programs,
			programMode,
			chosenProgramId: chosen,
			onProgramPick: setChosen,
			donationBox: ({ hideProgramSelect }) => (
				<DonateCard
					config={config}
					seams={seams}
					{...(hideProgramSelect ? { pageProgram: chosen } : {})}
				/>
			)
		};
		return <PageView {...props} />;
	}

	const host = document.createElement('div');
	document.body.appendChild(host);
	const mounted = createRoot(host);
	act(() => {
		mounted.render(<Page />);
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
	return { root: host, payment };
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
	if (!(box instanceof HTMLInputElement)) throw new Error(`${selector} is not an input`);
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, value);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

const CHOOSER = '[data-block="program-chooser"]';
const CONTINUE = 'section.step:not([hidden]) > button[part~="action"]';

/** a chooser card picked by the words it shows. */
function pickCard(root: HTMLElement, name: string): void {
	const card = [...root.querySelectorAll<HTMLLabelElement>(`${CHOOSER} label`)].find(
		(label) => label.querySelector('.page-choose-name')?.textContent === name
	);
	const radio = card?.querySelector<HTMLInputElement>('input[type="radio"]');
	if (radio == null) throw new Error(`no ${name} on the chooser`);
	press(radio);
}

/** the quote requests the card posts, read back as the bodies it sent; none is answered. */
function sent(): Record<string, unknown>[] {
	const bodies: Record<string, unknown>[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn((_url: string, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)));
			return new Promise<Response>(() => {});
		})
	);
	return bodies;
}

function donate(root: HTMLElement, payment: { pick(type: string): void }): void {
	press(one(root, '.tiles > label:nth-of-type(2)'));
	press(one(root, CONTINUE));
	type(root, '#email', 'donor@example.org');
	type(root, '#first-name', 'Ada');
	type(root, '#last-name', 'Lovelace');
	press(one(root, CONTINUE));
	payment.pick('card');
	press(one(root, 'button[part~="submit"]'));
}

describe('the Donation page where donors choose the program', () => {
	const choice: Over = { programMode: 'choice', config: CONFIG };

	it('lists the card’s own programs on the chooser, and the card draws no select of its own', async () => {
		const { root } = await donationPage(choice);
		const names = [...root.querySelectorAll(`${CHOOSER} .page-choose-name`)].map(
			(node) => node.textContent
		);
		expect(names).toEqual(['Where it’s needed most', 'Food pantry', 'Winter coats']);
		expect(root.querySelector('#program')).toBeNull();
	});

	it('sends the program a chooser card picked with the gift', async () => {
		const bodies = sent();
		const { root, payment } = await donationPage(choice);
		pickCard(root, 'Winter coats');
		donate(root, payment);
		expect(bodies).toHaveLength(1);
		expect(bodies[0]).toMatchObject({ programId: 'prog-coats' });
	});

	it('sends the later pick where the donor picks again', async () => {
		const bodies = sent();
		const { root, payment } = await donationPage(choice);
		pickCard(root, 'Winter coats');
		pickCard(root, 'Food pantry');
		donate(root, payment);
		expect(bodies[0]).toMatchObject({ programId: 'prog-food' });
	});
});

describe('the Donation page drawing no chooser', () => {
	it.each([
		['no program', { programMode: 'none', config: NO_PROGRAM }],
		[
			'one program',
			{
				programMode: 'pinned',
				config: { ...CONFIG, program: { mode: 'pinned', name: 'Food pantry' } }
			}
		]
	] satisfies [string, Over][])('draws none under %s', async (_, over) => {
		const { root } = await donationPage(over);
		expect(root.querySelector(CHOOSER)).toBeNull();
	});

	it('leaves the choice to the card’s own select where there is one program to choose', async () => {
		const bodies = sent();
		const { root, payment } = await donationPage({
			programMode: 'choice',
			config: { ...CONFIG, program: { mode: 'choice', options: PROGRAMS.slice(0, 1) } }
		});
		expect(root.querySelector(CHOOSER)).toBeNull();
		expect(root.querySelector('#program')).not.toBeNull();
		donate(root, payment);
		expect(bodies[0]).not.toHaveProperty('programId');
	});
});
