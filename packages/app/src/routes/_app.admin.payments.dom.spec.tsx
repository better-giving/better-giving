import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { envLine, RECREATE_APP, setupWebhookCommand } from '@better-giving/operator/deploy-split';
import { describe, expect, it, onTestFinished } from 'vitest';
import Payments from './_app.admin.payments';

// what the Payments screen says about each processor, mounted in a stub with the loader's answer
// handed in. what is asserted is the words a reader meets, scoped to the card each belongs to, and
// what a press posts.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** mounts `tree` into a document that lives as long as the case, and hands back its root element. */
function mount(tree: ReactNode): HTMLElement {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

type Drawn = Parameters<typeof Payments>[0]['loaderData'];
type Card = Drawn['cards'][number];

const OTHERS: Drawn['others'] = [
	{ processor: 'stripe', label: 'Stripe' },
	{ processor: 'paypal', label: 'PayPal' },
	{ processor: 'chariot', label: 'Chariot' },
	{ processor: 'nowpayments', label: 'NOWPayments' }
];

/** a working Stripe card: every reading in, nothing to do. */
const STRIPE: Card = {
	processor: 'stripe',
	label: 'Stripe',
	unreadable: null,
	rails: [
		{ rail: 'card', label: 'Card', standing: 'approved', note: null },
		{ rail: 'ach', label: 'Bank account', standing: 'never_requested', note: null }
	],
	link: 'everywhere',
	notices: 'working',
	endpointListed: true,
	recurring: 'ready',
	charityRate: null
};

/** the screen drawn from `drawn`, with every press recorded as the body it posted. */
function screen(drawn: Partial<Drawn>, answer: unknown = null) {
	const posted: FormData[] = [];
	const Stub = createRoutesStub([
		{
			path: '/admin/payments',
			action: async ({ request }) => {
				posted.push(await request.formData());
				return answer;
			},
			Component: () =>
				createElement(Payments as never, {
					loaderData: { cards: [], others: [], ...drawn },
					actionData: undefined,
					params: {},
					matches: []
				})
		}
	]);
	return { root: mount(createElement(Stub, { initialEntries: ['/admin/payments'] })), posted };
}

/** the card a heading names, which is what each assertion below is scoped to. */
function card(root: HTMLElement, heading: string): HTMLElement {
	const found = [...root.querySelectorAll('section')].find(
		(section) => section.querySelector('h2')?.textContent === heading
	);
	if (found === undefined) throw new Error(`the screen drew no card headed ${heading}`);
	return found;
}

describe('a deployment with no processor set up', () => {
	it('says no form can go live, with the server steps inside the banner', () => {
		const { root } = screen({ others: OTHERS });
		const banner = root.querySelector<HTMLElement>('.adm-banner');

		expect(banner?.textContent).toContain('No payment processor is set up');
		expect(banner?.textContent).toContain(
			'No donation form can go live until one is. Ask whoever set up this site to add one.'
		);
		const body = banner?.querySelector<HTMLElement>('.adm-banner__body');
		expect(body?.querySelector('h3')?.textContent).toBe('For whoever runs the server');
		expect([...(body?.querySelectorAll('pre') ?? [])].map((slab) => slab.textContent)).toEqual([
			'docker compose run --rm app node scripts/setup-webhook.ts stripe',
			'docker compose up -d --force-recreate app'
		]);
	});

	it('lists every processor as not set up, with where to read how to add one', () => {
		const others = card(screen({ others: OTHERS }).root, 'Not set up');

		expect([...others.querySelectorAll('.adm-status__label')].map((l) => l.textContent)).toEqual([
			'Stripe',
			'PayPal',
			'Chariot',
			'NOWPayments'
		]);
		expect(others.querySelector('a')?.getAttribute('href')).toBe(
			'https://github.com/better-giving/better-giving/blob/main/DEPLOY.md#payments'
		);
		expect(others.querySelector('a')?.textContent).toContain('How to add one');
	});
});

/** the words of each line on a card's ledger under `heading`, as label then word. */
function lines(section: HTMLElement, heading: string): string[][] {
	const block = [...section.querySelectorAll<HTMLElement>('.adm-named')].find(
		(named) => named.querySelector('h3')?.textContent === heading
	);
	if (block === undefined) throw new Error(`the card drew nothing under ${heading}`);
	return [...block.querySelectorAll('.adm-status__head')].map((head) => [
		head.querySelector('.adm-status__label')?.textContent ?? '',
		head.querySelector('.adm-status__word')?.textContent ?? ''
	]);
}

/** the block a card draws under `heading`, or `undefined` where it draws none. */
function block(section: HTMLElement, heading: string): HTMLElement | undefined {
	return [...section.querySelectorAll<HTMLElement>('.adm-named')].find(
		(named) => named.querySelector('h3')?.textContent === heading
	);
}

describe('a Stripe card', () => {
	it('draws the ways of paying, the notices, the repeating gifts and the events Stripe reports', () => {
		const stripe = card(screen({ cards: [STRIPE], others: OTHERS.slice(1) }).root, 'Stripe');

		expect(stripe.querySelector('.adm-record__head .adm-state')?.textContent).toBe('Set up');
		expect(
			stripe.querySelector('.adm-record__head .adm-state')?.classList.contains('adm-state--done')
		).toBe(true);
		expect(lines(stripe, 'Donation methods')).toEqual([
			['Card', ''],
			['Bank account', 'Not asked for'],
			['Link', '']
		]);
		expect(block(stripe, 'Payment notices')?.textContent).toContain(
			'Stripe tells this site each time a gift is paid.'
		);
		expect(lines(stripe, 'Recurring donations')).toEqual([
			['Monthly', ''],
			['Yearly', '']
		]);
		expect(block(stripe, 'Webhooks')?.querySelector('summary')?.textContent).toBe('16 events');
		expect(stripe.querySelector('.adm-banner')).toBeNull();
	});

	it('offers Register all sites where Link is not showing everywhere, and posts that form', async () => {
		const { root, posted } = screen(
			{ cards: [{ ...STRIPE, link: 'not_everywhere' }] },
			{ wallets: { state: 'levelled', failed: [] } }
		);
		const methods = block(card(root, 'Stripe'), 'Donation methods');
		expect(lines(card(root, 'Stripe'), 'Donation methods').at(-1)).toEqual([
			'Link',
			'Not showing everywhere'
		]);
		expect(methods?.textContent).toContain('Link shows only on sites registered with Stripe.');

		await press(methods, 'Register all sites');

		expect(posted.map((body) => Object.fromEntries(body))).toEqual([
			{ __form_id__: 'payments-wallets' }
		]);
	});

	it('names each site the press could not register', async () => {
		const { root } = screen(
			{ cards: [{ ...STRIPE, link: 'not_everywhere' }] },
			{
				wallets: {
					state: 'levelled',
					failed: [{ host: 'www.hope.example', detail: 'Stripe refused it.' }]
				}
			}
		);
		const methods = block(card(root, 'Stripe'), 'Donation methods');

		await press(methods, 'Register all sites');

		expect(methods?.textContent).toContain('www.hope.example Stripe refused it.');
	});

	it('says which reads it lost and the port’s sentence, and draws the rest', () => {
		const stripe = card(
			screen({
				cards: [
					{
						...STRIPE,
						rails: null,
						link: null,
						unreadable: {
							says: ['which ways of paying it can take', 'which sites draw wallet buttons'],
							detail: 'Stripe refused `STRIPE_SECRET_KEY`.'
						}
					}
				]
			}).root,
			'Stripe'
		);

		expect(stripe.textContent).toContain(
			'This deployment couldn’t read your Stripe account, so it can’t say which ways of paying it can take or which sites draw wallet buttons.'
		);
		expect(stripe.querySelector('code')?.textContent).toBe('STRIPE_SECRET_KEY');
		expect(block(stripe, 'Donation methods')).toBeUndefined();
		expect(block(stripe, 'Recurring donations')).toBeDefined();
	});
});

/** clicks the button named `name` inside `within`, and lets the press and its answer land. */
async function press(within: HTMLElement | undefined, name: string): Promise<void> {
	const button = [...(within?.querySelectorAll('button') ?? [])].find(
		(one) => one.textContent === name
	);
	if (button === undefined) throw new Error(`no ${name} button`);
	await act(async () => {
		button.click();
	});
	await act(async () => {
		await new Promise((settle) => setTimeout(settle, 0));
	});
}

describe('payment notices', () => {
	/** the commands a banner under Payment notices hands whoever runs the server. */
	const commands = (notices: HTMLElement | null | undefined) =>
		[...(notices?.querySelectorAll('pre') ?? [])].map((slab) => slab.textContent);

	it('says notices aren’t set up where the value is not in .env, with the setup script', () => {
		const stripe = card(
			screen({ cards: [{ ...STRIPE, notices: 'unset', endpointListed: false }] }).root,
			'Stripe'
		);
		const notices = block(stripe, 'Payment notices');
		const banner = notices?.querySelector<HTMLElement>('.adm-banner');
		const badge = stripe.querySelector('.adm-record__head .adm-state');

		expect(badge?.textContent).toBe('Not taking gifts');
		expect(badge?.classList.contains('adm-state--attention')).toBe(true);
		expect(banner?.querySelector('.adm-banner__word')?.textContent).toBe(
			'Payment notices aren’t set up'
		);
		expect(banner?.textContent).toContain(
			'Donation forms stay offline until Stripe can tell this site about payments. No donor can give through Stripe yet.'
		);
		expect(banner?.textContent).not.toContain('Gifts are charged');
		expect(commands(banner)).toEqual([setupWebhookCommand('stripe'), RECREATE_APP]);
	});

	it('keeps an endpoint Stripe already lists, sending the deployer to its secret and not the script', () => {
		const notices = block(
			card(
				screen({ cards: [{ ...STRIPE, notices: 'unset', endpointListed: true }] }).root,
				'Stripe'
			),
			'Payment notices'
		);

		expect(notices?.querySelector('.adm-banner__body')?.textContent).toContain(
			`Stripe’s dashboard lists an endpoint for this address under Workbench → Webhooks. Keep it: switch it on there if it is off, reveal its signing secret, put it in .env as ${envLine('STRIPE_WEBHOOK_SECRET')}, then recreate the app:`
		);
		expect(commands(notices)).toEqual([RECREATE_APP]);
	});

	it('offers the script only where Stripe lists no endpoint, where the account could not say', () => {
		const notices = block(
			card(
				screen({ cards: [{ ...STRIPE, notices: 'unset', endpointListed: null }] }).root,
				'Stripe'
			),
			'Payment notices'
		);

		expect(notices?.querySelector('.adm-banner__body')?.textContent).toContain(
			`If Stripe’s dashboard lists an endpoint for this address under Workbench → Webhooks, keep it: reveal its signing secret, put it in .env as ${envLine('STRIPE_WEBHOOK_SECRET')}, then recreate the app. Only if none is listed, run the first command below, put the line it prints in .env, then recreate the app:`
		);
		expect(commands(notices)).toEqual([setupWebhookCommand('stripe'), RECREATE_APP]);
	});

	it('says notices are not arriving where they fail at the processor', () => {
		const stripe = card(
			screen({ cards: [{ ...STRIPE, notices: 'failing', endpointListed: false }] }).root,
			'Stripe'
		);
		const notices = block(stripe, 'Payment notices');
		const badge = stripe.querySelector('.adm-record__head .adm-state');

		expect(badge?.textContent).toBe('Set up');
		expect(badge?.classList.contains('adm-state--done')).toBe(true);

		expect(notices?.querySelector('.adm-banner__word')?.textContent).toBe(
			'Payment notices are not arriving'
		);
		expect(notices?.textContent).toContain(
			'Donors are being charged, but their gifts stay pending here until Stripe confirms them.'
		);
		expect(notices?.querySelector('.adm-banner__body h3')?.textContent).toBe(
			'For whoever runs the server'
		);
	});

	const NOWPAYMENTS: Card = {
		...STRIPE,
		processor: 'nowpayments',
		label: 'NOWPayments',
		rails: null,
		link: null,
		recurring: null,
		endpointListed: null
	};

	it('says what an unset IPN secret costs crypto gifts, and sends the deployer to generate one', () => {
		const nowpayments = card(
			screen({ cards: [{ ...NOWPAYMENTS, notices: 'unset' }] }).root,
			'NOWPayments'
		);
		const notices = block(nowpayments, 'Payment notices');
		const badge = nowpayments.querySelector('.adm-record__head .adm-state');

		expect(badge?.textContent).toBe('Not taking gifts');
		expect(badge?.classList.contains('adm-state--attention')).toBe(true);
		expect(notices?.querySelector('.adm-banner')?.textContent).toContain(
			'Donation forms stay offline until NOWPayments can tell this site about payments. No donor can give through NOWPayments yet.'
		);
		expect(notices?.textContent).not.toContain('none is marked paid');
		expect(notices?.textContent).not.toContain('half an hour late');
		expect(notices?.querySelector('.adm-banner__body')?.textContent).toContain(
			`Generate an IPN secret under Payment Settings in your NOWPayments dashboard and put it in .env as ${envLine('NOWPAYMENTS_IPN_SECRET')}. NOWPayments shows it once, and generating a new one replaces the old. Then recreate the app:`
		);
		expect(commands(notices)).toEqual([RECREATE_APP]);
		expect(nowpayments.querySelector('.adm-hint')?.textContent).toBe('Crypto');
	});

	it('draws a set IPN secret no notice has confirmed as a note, not a warning', () => {
		const nowpayments = card(
			screen({ cards: [{ ...NOWPAYMENTS, notices: 'unconfirmed' }] }).root,
			'NOWPayments'
		);
		const notices = block(nowpayments, 'Payment notices');
		const badge = nowpayments.querySelector('.adm-record__head .adm-state');

		expect(badge?.textContent).toBe('Set up');
		expect(badge?.classList.contains('adm-state--done')).toBe(true);

		expect(notices?.querySelector('.adm-banner')).toBeNull();
		expect(notices?.querySelector('.adm-status__word')?.textContent).toBe('Not confirmed yet');
		expect(notices?.textContent).toContain(
			'The IPN secret is set. It’s confirmed the first time NOWPayments tells this site a crypto gift was paid within half an hour of the donor starting it.'
		);
	});
});

describe('Set up recurring gifts', () => {
	const ABSENT: Card = { ...STRIPE, recurring: 'absent' };

	it('is offered where the account holds nothing, and posts the processor it is about', async () => {
		const { root, posted } = screen(
			{ cards: [ABSENT] },
			{ recurring: { label: 'Stripe', outcome: 'set_up', detail: null } }
		);
		const recurring = block(card(root, 'Stripe'), 'Recurring donations');
		expect(lines(card(root, 'Stripe'), 'Recurring donations')).toEqual([
			['Monthly', 'Not set up'],
			['Yearly', 'Not set up']
		]);

		await press(recurring, 'Set up recurring gifts');

		expect(posted.map((body) => Object.fromEntries(body))).toEqual([
			{ __form_id__: 'payments-recurring', processor: 'stripe' }
		]);
		expect(recurring?.querySelector('[role="status"]')?.textContent).toBe(
			'Your Stripe account can now collect gifts that repeat.'
		);
	});

	it('says it could not, with the processor’s sentence, where the press failed', async () => {
		const { root } = screen(
			{ cards: [ABSENT] },
			{
				recurring: {
					label: 'Stripe',
					outcome: 'failed',
					detail: 'Stripe holds an archived product.'
				}
			}
		);
		const recurring = block(card(root, 'Stripe'), 'Recurring donations');

		await press(recurring, 'Set up recurring gifts');

		expect(recurring?.textContent).toContain(
			'This deployment could not set it up on your Stripe account, and nothing was changed.'
		);
		expect(recurring?.textContent).toContain('Stripe holds an archived product.');
	});

	it('is not offered where the account already holds it', () => {
		const recurring = block(
			card(screen({ cards: [STRIPE] }).root, 'Stripe'),
			'Recurring donations'
		);

		expect(recurring?.querySelector('button')).toBeNull();
	});
});

describe('a PayPal card', () => {
	const PAYPAL: Card = {
		...STRIPE,
		processor: 'paypal',
		label: 'PayPal',
		rails: null,
		link: null,
		charityRate: true
	};

	it('says what it takes in a line where it draws no ledger, and no Webhooks block', () => {
		const paypal = card(screen({ cards: [PAYPAL] }).root, 'PayPal');

		expect(paypal.querySelector('.adm-hint')?.textContent).toBe('PayPal and Venmo');
		expect(block(paypal, 'Donation methods')).toBeUndefined();
		expect(block(paypal, 'Webhooks')).toBeUndefined();
	});

	it('states the charity rate as .env sets it', () => {
		const approved = card(screen({ cards: [PAYPAL] }).root, 'PayPal');
		expect(lines(approved, 'Charity rate')).toEqual([['Approved by PayPal', '']]);

		const standard = card(screen({ cards: [{ ...PAYPAL, charityRate: false }] }).root, 'PayPal');
		expect(lines(standard, 'Charity rate')).toEqual([['Standard rate', '']]);
		expect(block(standard, 'Charity rate')?.textContent).toContain('PAYPAL_CHARITY_RATE_APPROVED');
	});

	it('draws no charity rate on a processor that has none', () => {
		expect(block(card(screen({ cards: [STRIPE] }).root, 'Stripe'), 'Charity rate')).toBeUndefined();
	});

	it('says it is not taking gifts, and donation forms stay offline, where notices are unset', () => {
		const paypal = card(screen({ cards: [{ ...PAYPAL, notices: 'unset' }] }).root, 'PayPal');
		const banner = block(paypal, 'Payment notices')?.querySelector<HTMLElement>('.adm-banner');
		const badge = paypal.querySelector('.adm-record__head .adm-state');

		expect(badge?.textContent).toBe('Not taking gifts');
		expect(badge?.classList.contains('adm-state--attention')).toBe(true);
		expect(banner?.textContent).toContain(
			'Donation forms stay offline until PayPal can tell this site about payments. No donor can give through PayPal yet.'
		);
		expect(banner?.textContent).not.toContain('Gifts are charged');
	});
});

describe('a Chariot card', () => {
	const CHARIOT: Card = {
		...STRIPE,
		processor: 'chariot',
		label: 'Chariot',
		rails: null,
		link: null
	};

	it('says it is not taking gifts, and donation forms stay offline, where notices are unset', () => {
		const chariot = card(screen({ cards: [{ ...CHARIOT, notices: 'unset' }] }).root, 'Chariot');
		const banner = block(chariot, 'Payment notices')?.querySelector<HTMLElement>('.adm-banner');
		const badge = chariot.querySelector('.adm-record__head .adm-state');

		expect(badge?.textContent).toBe('Not taking gifts');
		expect(badge?.classList.contains('adm-state--attention')).toBe(true);
		expect(banner?.textContent).toContain(
			'Donation forms stay offline until Chariot can tell this site about payments. No donor can give through Chariot yet.'
		);
		expect(banner?.textContent).not.toContain('Gifts are charged');
	});
});
