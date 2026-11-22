import type { ChallengeSeams } from '@better-giving/form/embed/challenge';
import type {
	PaymentChangeLike,
	PaymentElementLike,
	StripeLike
} from '@better-giving/form/embed/stripe';
import type { TurnstileLike } from '@better-giving/form/embed/turnstile';
import type { FeeRules, FormConfig } from '@better-giving/form/v1';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { DonateCard } from './card';
import {
	ProgramClosedPage,
	ProgramPage,
	type ProgramPageProgram,
	type ProgramPageProps
} from './program-page';
import { StaffMarkerContext } from './staff-marker-context';

// a program's public page and the screen an archived or unknown program gets, through
// `ProgramPage` and `ProgramClosedPage` in ./program-page.tsx: what each draws, the landmarks a
// reader moves by, and the program the card sends with the gift, which is the page's whole point.

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

/** the config the route builds for a program page: no `program`, so the card offers none. */
const CONFIG: FormConfig = {
	formId: 'ff000000-0000-4000-8000-000000000002',
	providers: [{ name: 'stripe', publishableKey: 'pk_test_spec' }],
	currency: 'usd',
	suggestedAmountsMinor: [2500, 5000, 10000],
	minAmountMinor: 500,
	maxAmountMinor: 500000,
	frequencies: ['one_time', 'monthly'],
	paymentMethods: ['card'],
	feeCoverage: 'optional',
	feeRules: FEE_RULES,
	locale: 'en-US',
	orgLegalName: 'Cedar Fork Community Pantry Inc.',
	ein: '47-3829105',
	deductibilityStatement: 'Cedar Fork Community Pantry Inc. is a 501(c)(3).',
	turnstileSiteKey: '1x00000000000000000000AA'
};

const COATS: ProgramPageProgram = {
	id: 'prog-coats',
	name: 'Winter coats',
	description:
		'Every October we collect, clean and hand out warm coats to neighbors who can’t afford one.\n\n$50 outfits one child from hood to hem.',
	photoImageId: 'img-coats'
};

const ORG: ProgramPageProps['org'] = {
	name: 'Cedar Fork Community Pantry Inc.',
	info: {
		legalName: 'Cedar Fork Community Pantry Inc.',
		ein: '47-3829105',
		addressLines: ['412 Alder Lane, Suite 3', 'Cedar Fork, OR 97330'],
		email: null,
		socialLinks: []
	}
};

/** the challenge widget, minting a token as soon as it is drawn and again on every reset. */
const CHALLENGE: ChallengeSeams = {
	turnstile: {
		load: async () => {
			let answer: (token: string) => void = () => {};
			let minted = 0;
			const mint = (): void => {
				minted += 1;
				answer(`tok_minted_${minted}`);
			};
			const api: TurnstileLike = {
				render: (_node, options) => {
					answer = options.callback ?? (() => {});
					mint();
					return 'widget-1';
				},
				reset: mint,
				remove: () => {}
			};
			return api;
		},
		delay: () => () => {}
	}
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
		seams: {
			payment: { stripe: { load: async () => stripe, delay: () => () => {} } },
			challenge: CHALLENGE
		},
		pick: (type: string) => {
			act(() => {
				for (const handler of [...change]) {
					handler({ collapsed: false, empty: false, value: { type } });
				}
			});
		}
	};
}

async function mount(node: ReactNode): Promise<HTMLElement> {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const mounted = createRoot(host);
	act(() => {
		mounted.render(node);
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

const payment = paymentProvider();

function programPage(overrides: Partial<ProgramPageProps> = {}) {
	return mount(
		<ProgramPage
			program={COATS}
			org={ORG}
			logo={null}
			look={{ brandColour: null }}
			sharing={{ message: 'Winter coats', url: 'https://cedarfork.example/programs/prog-coats' }}
			config={CONFIG}
			seams={payment.seams}
			{...overrides}
		/>
	);
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

const CONTINUE = 'section.step:not([hidden]) > button[part~="action"]';

async function donate(root: HTMLElement): Promise<void> {
	press(one(root, '.tiles > label:nth-of-type(2)'));
	press(one(root, CONTINUE));
	// the challenge is drawn on arrival at the details step, through a promise chain of its own.
	await act(async () => {
		for (let at = 0; at < 4; at += 1) await Promise.resolve();
	});
	type(root, '#email', 'donor@example.org');
	type(root, '#first-name', 'Ada');
	type(root, '#last-name', 'Lovelace');
	press(one(root, CONTINUE));
	payment.pick('card');
	press(one(root, 'button[part~="submit"]'));
}

/** the text of the element `labelled`'s `aria-labelledby` names. */
function labelOf(root: HTMLElement, labelled: Element): string | null {
	const id = labelled.getAttribute('aria-labelledby');
	return id === null ? null : (root.ownerDocument.getElementById(id)?.textContent ?? null);
}

describe('an active program’s page', () => {
	it('draws the photo, the name, the description, who runs it and the card', async () => {
		const root = await programPage();
		const main = one(root, 'main');
		const photo = one(main, '[data-area="photo"] img');
		expect(photo.getAttribute('src')).toBe('/image/img-coats');
		expect(photo.getAttribute('alt')).toBe('Winter coats');
		expect(one(main, '.ds-eyebrow').textContent).toBe('Program');
		expect(one(main, 'h1').textContent).toBe('Winter coats');
		expect(
			[...main.querySelectorAll('[data-area="description"] p')].map((p) => p.textContent)
		).toEqual([
			'Every October we collect, clean and hand out warm coats to neighbors who can’t afford one.',
			'$50 outfits one child from hood to hem.'
		]);
		const identity = one(main, '[data-area="identity"]');
		expect(identity.textContent).toContain('A program of');
		expect(identity.textContent).toContain('Cedar Fork Community Pantry Inc.');
		expect(identity.textContent).toContain('EIN 47-3829105');
		expect(main.querySelector('[part~="card"]')).not.toBeNull();
	});

	it('draws no image element for a program with no photo', async () => {
		const root = await programPage({ program: { ...COATS, photoImageId: null } });
		expect(root.querySelector('[data-area="photo"]')).toBeNull();
		expect(one(root, 'main').querySelector('img')).toBeNull();
	});

	it('draws no description block for a program with none', async () => {
		const root = await programPage({ program: { ...COATS, description: null } });
		expect(root.querySelector('[data-area="description"]')).toBeNull();
	});

	it('draws a description as plain text, never as markup', async () => {
		const root = await programPage({ program: { ...COATS, description: '<b>Coats</b> for all' } });
		const description = one(root, '[data-area="description"]');
		expect(description.querySelector('b')).toBeNull();
		expect(description.textContent).toBe('<b>Coats</b> for all');
	});

	it('draws the organisation’s initials in the tile where it has no logo, and its logo where it has one', async () => {
		const initialsOnly = await programPage();
		expect(one(initialsOnly, '[data-area="identity"] .ds-avatar').textContent).toBe('CF');

		const withLogo = await programPage({
			logo: { imageId: 'img-logo', width: 200, height: 200 }
		});
		const tile = one(withLogo, '[data-area="identity"] .ds-avatar');
		expect(tile.querySelector('img')?.getAttribute('src')).toBe('/image/img-logo');
		expect(tile.textContent).toBe('');
	});

	it('draws no EIN where the organisation states none', async () => {
		const root = await programPage({ org: { ...ORG, info: { ...ORG.info, ein: null } } });
		expect(one(root, '[data-area="identity"]').textContent).not.toContain('EIN');
	});

	it('has one h1, the card in a section its h2 labels, and Share in a section its heading labels', async () => {
		const root = await programPage();
		expect(root.querySelectorAll('h1')).toHaveLength(1);
		const box = one(root, '[data-area="box"]');
		expect(box.tagName).toBe('SECTION');
		expect(labelOf(root, box)).toBe('Give to Winter coats');
		expect(one(box, 'h2').textContent).toBe('Give to Winter coats');
		expect(box.querySelector('[part~="card"]')).not.toBeNull();
		const share = one(root, '[data-area="share"]');
		expect(share.tagName).toBe('SECTION');
		expect(labelOf(root, share)).toBe('Share this program');
	});

	it('draws no Program select or chooser on the card', async () => {
		const root = await programPage();
		expect(root.querySelector('#program')).toBeNull();
		expect(root.querySelector('[data-area="chooser"]')).toBeNull();
	});

	it('sends the program’s id with the gift as `pageProgramId`', async () => {
		const bodies = sent();
		const root = await programPage();
		await donate(root);
		expect(bodies).toHaveLength(1);
		expect(bodies[0]).toMatchObject({ pageProgramId: 'prog-coats' });
	});

	it('draws the card inert in the preview', async () => {
		const root = await programPage({ preview: true });
		expect(one(root, '[part~="card"]').closest('[inert]')).not.toBeNull();
	});
});

describe('the console link in the footer, for an operator who carries the marker', () => {
	async function asStaff(preview: boolean) {
		const root = await mount(
			<StaffMarkerContext value={true}>
				<ProgramPage
					program={COATS}
					org={ORG}
					logo={null}
					look={{ brandColour: null }}
					sharing={{
						message: 'Winter coats',
						url: 'https://cedarfork.example/programs/prog-coats'
					}}
					config={CONFIG}
					seams={payment.seams}
					preview={preview}
				/>
			</StaffMarkerContext>
		);
		return one(root, 'footer');
	}

	it('is drawn on the page itself', async () => {
		expect((await asStaff(false)).querySelector('a[href="/admin"]')).not.toBeNull();
	});

	// the preview is what a donor sees, and a donor carries no marker.
	it('is not drawn in the editor’s preview', async () => {
		expect((await asStaff(true)).querySelector('a[href="/admin"]')).toBeNull();
	});
});

describe('the donation card handed `pageProgramId`', () => {
	it('starts the flow on it, so every quote carries it', async () => {
		const bodies = sent();
		const root = await mount(
			<DonateCard config={CONFIG} seams={payment.seams} pageProgramId="prog-pantry" />
		);
		await donate(root);
		expect(bodies[0]).toMatchObject({ pageProgramId: 'prog-pantry' });
	});

	it('sends no such key when handed none', async () => {
		const bodies = sent();
		const root = await mount(<DonateCard config={CONFIG} seams={payment.seams} />);
		await donate(root);
		expect(bodies).toHaveLength(1);
		expect(bodies[0]).not.toHaveProperty('pageProgramId');
	});
});

describe('the donation card when the gift endpoint answers the quote as an unknown form', () => {
	const UNKNOWN = {
		error: 'form_not_found',
		message: 'No form with id `ff00…0002` exists on this deployment.',
		fix: 'Check the `form` attribute on the donation element against the snippet shown under Forms in /admin.'
	};
	const STOPPED = 'This program stopped taking gifts. You can still give on the donate page.';
	const CONFIG_READ = `/api/v1/forms/${encodeURIComponent(CONFIG.formId)}/config`;

	/**
	 * the quote refused as the endpoint refuses both a program archived since the page was drawn and a
	 * form that is gone, with the form's config read answering `config`: OK where only the program
	 * closed, the same refusal where the form is gone, or never reached.
	 */
	function answeredUnknown(config: 'reads' | 'gone' | 'unreachable' = 'reads') {
		const unknown = () =>
			new Response(JSON.stringify(UNKNOWN), {
				status: 404,
				headers: { 'content-type': 'application/json' }
			});
		const fetch = vi.fn(async (url: string) => {
			if (url !== CONFIG_READ) return unknown();
			if (config === 'unreachable') throw new TypeError('Failed to fetch');
			return config === 'gone'
				? unknown()
				: new Response(JSON.stringify({ formId: CONFIG.formId }), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					});
		});
		vi.stubGlobal('fetch', fetch);
		return fetch;
	}

	function configReads(fetch: ReturnType<typeof answeredUnknown>): number {
		return fetch.mock.calls.filter(([url]) => url === CONFIG_READ).length;
	}

	async function refused(root: HTMLElement): Promise<void> {
		await donate(root);
		await act(async () => {
			for (let at = 0; at < 4; at += 1) await new Promise((done) => setTimeout(done, 0));
		});
	}

	it('says the program stopped taking gifts and links the donate page, on a program page whose form still reads', async () => {
		const fetch = answeredUnknown('reads');
		const root = await mount(
			<DonateCard config={CONFIG} seams={payment.seams} pageProgramId="prog-coats" />
		);
		await refused(root);
		expect(configReads(fetch)).toBe(1);
		const takeover = one(root, 'section.takeover');
		expect(takeover.hidden).toBe(false);
		expect(takeover.textContent).toContain(STOPPED);
		const link = [...takeover.querySelectorAll('a')].find((a) => a.textContent === 'donate page');
		expect(link?.getAttribute('href')).toBe('/');
		expect(root.textContent).not.toContain(UNKNOWN.message);
		expect(root.textContent).not.toContain(UNKNOWN.fix);
	});

	it('offers no Try again once the program has stopped taking gifts', async () => {
		answeredUnknown();
		const root = await mount(
			<DonateCard config={CONFIG} seams={payment.seams} pageProgramId="prog-coats" />
		);
		await refused(root);
		const takeover = one(root, 'section.takeover');
		const visible = [...takeover.querySelectorAll('button')].filter(
			(button) => !button.hidden && button.closest('[hidden]') === null
		);
		expect(visible).toEqual([]);
	});

	it('keeps the API’s own sentence on a program page whose form’s config is gone too', async () => {
		const fetch = answeredUnknown('gone');
		const root = await mount(
			<DonateCard config={CONFIG} seams={payment.seams} pageProgramId="prog-coats" />
		);
		await refused(root);
		expect(configReads(fetch)).toBe(1);
		const takeover = one(root, 'section.takeover');
		expect(takeover.hidden).toBe(false);
		expect(takeover.textContent).not.toContain(STOPPED);
		expect(takeover.textContent).toContain(UNKNOWN.message);
	});

	it('keeps the API’s own sentence on a program page whose config re-read never arrives', async () => {
		const fetch = answeredUnknown('unreachable');
		const root = await mount(
			<DonateCard config={CONFIG} seams={payment.seams} pageProgramId="prog-coats" />
		);
		await refused(root);
		expect(configReads(fetch)).toBe(1);
		const takeover = one(root, 'section.takeover');
		expect(takeover.textContent).not.toContain(STOPPED);
		expect(takeover.textContent).toContain(UNKNOWN.message);
	});

	it('keeps the API’s own sentence, and reads no config, on a card with no program page', async () => {
		const fetch = answeredUnknown('reads');
		const root = await mount(<DonateCard config={CONFIG} seams={payment.seams} />);
		await refused(root);
		expect(configReads(fetch)).toBe(0);
		const takeover = one(root, 'section.takeover');
		expect(takeover.hidden).toBe(false);
		expect(takeover.textContent).not.toContain(STOPPED);
		expect(takeover.textContent).toContain(UNKNOWN.message);
	});
});

describe('a program not taking gifts', () => {
	async function closed(preview?: boolean) {
		return mount(
			<StaffMarkerContext value={true}>
				<ProgramClosedPage
					org={ORG}
					logo={null}
					look={{ brandColour: null }}
					{...(preview === undefined ? {} : { preview })}
				/>
			</StaffMarkerContext>
		);
	}

	function way(root: HTMLElement): HTMLElement {
		const link = [...root.querySelectorAll<HTMLElement>('main a')].find(
			(found) => found.textContent === 'Go to the donate page'
		);
		if (link === undefined) throw new Error('no way on to the donate page');
		return link;
	}

	it('says it isn’t taking gifts and offers the donate page, with no card', async () => {
		const root = await closed();
		expect(root.querySelectorAll('h1')).toHaveLength(1);
		expect(one(root, 'h1').textContent).toBe('This program isn’t taking gifts');
		expect(one(root, 'main').textContent).toContain(
			'Gifts to it are closed, or the link isn’t right. You can still give to Cedar Fork Community Pantry Inc.'
		);
		expect(one(root, 'main').textContent).not.toContain('..');
		expect(way(root).getAttribute('href')).toBe('/');
		expect(root.querySelector('[part~="card"]')).toBeNull();
	});

	it.each(['Hope Now!', 'Why Not Us?', 'Cedar Fork Pantry'])(
		'ends its sentence with one mark after the name %s',
		async (name) => {
			const root = await mount(
				<ProgramClosedPage org={{ ...ORG, name }} logo={null} look={{ brandColour: null }} />
			);
			const text = one(root, 'main').textContent ?? '';
			const closes = /[.!?]$/.test(name) ? name : `${name}.`;
			expect(text).toContain(`You can still give to ${closes}`);
			expect(text).not.toMatch(/[.!?]{2}/);
		}
	);

	it('keeps the way on, and the console link, in the tab order on the page itself', async () => {
		const root = await closed();
		expect(way(root).tabIndex).toBe(0);
		expect(one(root, 'footer').querySelector('a[href="/admin"]')).not.toBeNull();
	});

	it('takes the way on out of the tab order, and draws no console link, in the preview', async () => {
		const root = await closed(true);
		expect(way(root).tabIndex).toBe(-1);
		expect(root.querySelector('footer a[href="/admin"]')).toBeNull();
	});

	it('keeps the site nav and the footer', async () => {
		const root = await closed();
		expect(root.querySelector('.ds-site-nav')).not.toBeNull();
		expect(root.querySelector('footer')).not.toBeNull();
	});
});
