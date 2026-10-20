import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { CropSquare } from '$lib/admin/settings/logo-crop';
import Settings from './_app.admin.settings';

// what the Settings screen says about the two things a deployment can be missing without any box
// on it being wrong — the mail values, which are set in `.env`, and the notification address — and
// what its logo, its brand colour and its link rows do as they are used.
//
// mounted rather than rendered to a string, inside a stub because the screen's forms and its
// fetchers do not render without a router. what is asserted is the words a reader meets, scoped to
// the card each belongs to, and what reaches the logo's address.
//
// happy-dom lays nothing out and decodes no image, so the crop card's image is given the size a
// browser would measure (`measure` below), and the crop and resize a save runs are
// ../lib/admin/settings/logo-square.spec.ts's: here they are stood in for by one that records the
// square it was handed and returns a file of its own.

const squareLogo = vi.hoisted(() =>
	vi.fn(async (_file: File, _square: CropSquare) => ({
		ok: true as const,
		blob: new Blob(['square'], { type: 'image/png' })
	}))
);

vi.mock('$lib/admin/settings/logo-square', () => ({ squareLogo }));

afterEach(() => {
	squareLogo.mockClear();
	vi.restoreAllMocks();
});

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * mounts `tree` into a document that lives as long as the case, and hands back its root element.
 *
 * `appendChild` rather than `append`: worker-configuration.d.ts declares HTMLRewriter's `Element`,
 * which merges into the DOM's and brings an `append(content, options)` that wins here.
 */
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

const DETAILS = {
	legal_name: 'Riverbank Trust',
	tax_id: '12-3456789',
	address_line1: '1 Main St',
	address_line2: '',
	city: 'Springfield',
	region: '',
	postal_code: '',
	country: 'US',
	mission: '',
	vision: '',
	brand_colour: '',
	social_links: [] as string[]
};

type Drawn = {
	readonly notificationEmail: string | null;
	readonly mail: { readonly from: string; readonly host: string } | null;
	readonly details?: Partial<typeof DETAILS> | undefined;
	readonly logo?: { readonly id: string; readonly src: string } | null | undefined;
};

/** one request to the logo's address: its method, and the body it carried. */
type Sent = { readonly method: string; readonly body: FormData | null };

/**
 * the screen, with the logo's address answering as `answer` says. every request that reaches the
 * address is recorded in `sent`.
 */
function screen(
	{ details, logo, ...over }: Drawn,
	answer: (request: Request) => Promise<unknown> = async () => ({ logo: null })
): { readonly root: HTMLElement; readonly sent: Sent[] } {
	const sent: Sent[] = [];
	const Stub = createRoutesStub([
		{
			path: '/admin/settings',
			Component: () =>
				createElement(Settings as never, {
					loaderData: {
						details: { ...DETAILS, ...details },
						logo: logo ?? null,
						saved: null,
						version: 0,
						...over
					},
					actionData: undefined,
					params: {},
					matches: []
				})
		},
		{
			path: '/admin/settings/logo',
			action: async ({ request }) => {
				const body = request.method === 'POST' ? await request.formData() : null;
				sent.push({ method: request.method, body });
				return answer(request);
			}
		}
	]);
	return { root: mount(createElement(Stub, { initialEntries: ['/admin/settings'] })), sent };
}

/** the card a heading names, which is what each assertion below is scoped to. */
function card(root: HTMLElement, heading: string): HTMLElement {
	const found = [...root.querySelectorAll('section')].find(
		(section) => section.querySelector('h2')?.textContent === heading
	);
	if (found === undefined) throw new Error(`the screen drew no card headed ${heading}`);
	return found;
}

const SET = { from: 'giving@riverbanktrust.org', host: 'smtp.riverbanktrust.org' };

describe('the mail card', () => {
	it('says receipts are not going out, and what the server runner does about it, with no mail set', () => {
		const mail = card(
			screen({ notificationEmail: 'ops@riverbanktrust.org', mail: null }).root,
			'Mail'
		);

		expect(mail.querySelector('[role="status"]')?.textContent).toContain(
			'Receipts aren’t being sent'
		);
		expect(mail.textContent).toContain('For whoever runs the server');
		expect(mail.textContent).toContain('docker compose up -d --force-recreate app');
		expect(mail.querySelector('input[name="to"]')).toBeNull();
	});

	it('holds the steps for whoever runs the server inside the banner, under the staff sentence', () => {
		const mail = card(screen({ notificationEmail: null, mail: null }).root, 'Mail');
		const banner = mail.querySelector<HTMLElement>('.adm-banner');
		const body = banner?.querySelector<HTMLElement>('.adm-banner__body');

		expect(mail.querySelectorAll('.adm-banner')).toHaveLength(1);
		expect(body?.previousElementSibling?.textContent).toContain(
			'Ask whoever set up this site to add it.'
		);
		expect(body?.querySelector('h3')?.textContent).toBe('For whoever runs the server');
		expect(body?.textContent).toContain('Add the mail values to .env (DEPLOY.md, Mail)');
		expect(body?.querySelector('pre')?.textContent).toBe(
			'docker compose up -d --force-recreate app'
		);
		// nothing of the steps is left standing under the banner.
		expect(banner?.nextElementSibling).toBeNull();
	});

	it('states the sender and the host, and offers the test send, with mail set', () => {
		const mail = card(
			screen({ notificationEmail: 'ops@riverbanktrust.org', mail: SET }).root,
			'Mail'
		);

		expect(mail.textContent).toContain('giving@riverbanktrust.org');
		expect(mail.textContent).toContain('smtp.riverbanktrust.org');
		expect(mail.textContent).not.toContain('Receipts aren’t being sent');
		const to = mail.querySelector<HTMLInputElement>('input[name="to"]');
		expect(to?.defaultValue).toBe('ops@riverbanktrust.org');
		expect(mail.querySelector('button[type="submit"]')?.textContent).toBe('Send test email');
	});
});

describe('the notifications card', () => {
	it('says nothing reaches the organisation while no address is saved', () => {
		const notifications = card(
			screen({ notificationEmail: null, mail: SET }).root,
			'Notifications'
		);

		expect(notifications.querySelector('[role="status"]')?.textContent).toContain(
			'Nothing reaches you yet'
		);
		expect(notifications.textContent).toContain(
			'Where this site reaches you about the gifts it takes and anything that goes wrong.'
		);
	});

	it('says nothing of the kind once one is saved, and holds it in the box', () => {
		const notifications = card(
			screen({ notificationEmail: 'ops@riverbanktrust.org', mail: SET }).root,
			'Notifications'
		);

		expect(notifications.textContent).not.toContain('Nothing reaches you yet');
		expect(
			notifications.querySelector<HTMLInputElement>('input[name="notification_email"]')
				?.defaultValue
		).toBe('ops@riverbanktrust.org');
	});
});

/**
 * `input`, typed into as a reader would: the value, then the event the form listens for. the value
 * goes in through the prototype's setter, as the browser's own does, since react's tracker sits on
 * the element's and would take a write through it for no change.
 */
function type(input: HTMLInputElement, value: string) {
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

describe('the brand colour', () => {
	const details = (root: HTMLElement) => card(root, 'Organisation details');
	const box = (root: HTMLElement) =>
		details(root).querySelector<HTMLInputElement>('input[name="brand_colour"]');
	const well = (root: HTMLElement) =>
		details(root).querySelector<HTMLInputElement>('input[aria-label="Pick the brand colour"]');

	it('draws the stored colour in the well beside its box', () => {
		const { root } = screen({
			notificationEmail: null,
			mail: SET,
			details: { brand_colour: '#1F6FEB' }
		});

		expect(well(root)?.type).toBe('color');
		expect(well(root)?.value).toBe('#1f6feb');
		expect(well(root)?.hasAttribute('data-empty')).toBe(false);
	});

	it('says no colour is set while the box holds none', () => {
		const { root } = screen({ notificationEmail: null, mail: SET });
		const said = well(root)?.getAttribute('aria-describedby');

		expect(well(root)?.hasAttribute('data-empty')).toBe(true);
		expect(said).toBeTruthy();
		expect(root.ownerDocument.getElementById(said ?? '')?.textContent).toBe('No colour set');
	});

	it('shows a hex typed in the box in the well', () => {
		const { root } = screen({ notificationEmail: null, mail: SET });
		const typed = box(root);
		if (typed === null) throw new Error('no brand colour box');

		type(typed, '#2A9D8F');

		expect(well(root)?.value).toBe('#2a9d8f');
		expect(well(root)?.hasAttribute('data-empty')).toBe(false);
		type(typed, '#2A9');
		expect(well(root)?.hasAttribute('data-empty')).toBe(true);
	});

	it('writes a colour picked in the well into the box, as typing it would', () => {
		const { root } = screen({
			notificationEmail: null,
			mail: SET,
			details: { brand_colour: '#1f6feb' }
		});
		const picker = well(root);
		if (picker === null) throw new Error('no brand colour well');

		type(picker, '#e76f51');

		expect(box(root)?.value).toBe('#e76f51');
		expect(well(root)?.value).toBe('#e76f51');
	});
});

describe('the social link rows', () => {
	it('mark each row with the network its address is on, and follow what is typed', () => {
		const { root } = screen({
			notificationEmail: null,
			mail: SET,
			details: { social_links: ['https://www.instagram.com/riverbanktrust'] }
		});
		const row = card(root, 'Organisation details').querySelector<HTMLInputElement>(
			'input[name="social_links[0]"]'
		);
		if (row === null) throw new Error('no link row');
		const mark = () => row.closest('.adm-leadwrap')?.querySelector('.adm-leadwrap__lead');

		expect(mark()?.querySelector('img.adm-brand-mark')).not.toBeNull();
		expect(mark()?.textContent).toBe('Instagram');

		type(row, 'youtube.com/@riverbanktrust');
		expect(mark()?.textContent).toBe('YouTube');

		type(row, 'riverbanktrust.org');
		expect(mark()?.querySelector('img')).toBeNull();
		expect(mark()?.textContent).toBe('');
	});
});

describe('the logo', () => {
	const PICKED = new File(['png'], 'riverbank-logo.png', { type: 'image/png' });

	const logo = (root: HTMLElement) => {
		const found = [...card(root, 'Organisation details').querySelectorAll('fieldset')].find(
			(set) => set.querySelector('legend')?.textContent === 'Logo'
		);
		if (found === undefined) throw new Error('no logo fieldset');
		return found;
	};
	const buttonNamed = (within: ParentNode, words: string) =>
		[...within.querySelectorAll('button')].find((button) => button.textContent === words);
	const cropCard = () => document.querySelector('dialog');

	/** a file chosen at the logo's press, as the device's picker hands one back. */
	function pick(root: HTMLElement, file: File) {
		const input = logo(root).querySelector<HTMLInputElement>('input[type="file"]');
		if (input === null) throw new Error('no file input');
		Object.defineProperty(input, 'files', { value: [file], configurable: true });
		act(() => {
			input.dispatchEvent(new Event('change', { bubbles: true }));
		});
	}

	/**
	 * the image in the crop card laid out and decoded, as a browser would report it: drawn 600 × 400
	 * and 1200 × 800 of its own.
	 */
	async function measure() {
		const image = document.querySelector<HTMLImageElement>('.adm-cropper__image');
		const viewport = document.querySelector<HTMLElement>('.adm-cropper__viewport');
		if (image === null || viewport === null) throw new Error('the crop card drew no image');
		vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(
			DOMRect.fromRect({ x: 0, y: 0, width: 600, height: 400 })
		);
		Object.defineProperty(image, 'naturalWidth', { value: 1200 });
		Object.defineProperty(image, 'naturalHeight', { value: 800 });
		await act(async () => {
			image.dispatchEvent(new Event('load'));
		});
	}

	it('says Add logo with none stored, and Replace logo and Remove the logo with one', () => {
		const empty = screen({ notificationEmail: null, mail: SET }).root;
		expect(buttonNamed(logo(empty), 'Add logo')).toBeDefined();

		const stored = screen({
			notificationEmail: null,
			mail: SET,
			logo: { id: 'img_1', src: '/image/img_1' }
		}).root;
		expect(buttonNamed(logo(stored), 'Replace logo')).toBeDefined();
		expect(logo(stored).querySelector('button[aria-label="Remove the logo"]')).not.toBeNull();
		expect(logo(stored).textContent).not.toContain('photo');
	});

	it('opens the crop card on a picked file, and sends nothing yet', () => {
		const { root, sent } = screen({ notificationEmail: null, mail: SET });

		pick(root, PICKED);

		expect(cropCard()?.querySelector('h2')?.textContent).toBe('Crop the logo');
		expect(cropCard()?.querySelector('.adm-cropper__image')).not.toBeNull();
		expect(sent).toEqual([]);
	});

	it('posts the largest centred square, cropped, as the logo’s file at Save', async () => {
		const { root, sent } = screen({ notificationEmail: null, mail: SET });
		pick(root, PICKED);
		await measure();
		const save = cropCard() && buttonNamed(cropCard() as HTMLElement, 'Save logo');

		expect(save?.getAttribute('aria-disabled')).toBeNull();
		await act(async () => save?.click());

		expect(squareLogo).toHaveBeenCalledExactlyOnceWith(PICKED, { x: 200, y: 0, size: 800 });
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0]?.method).toBe('POST');
		const posted = sent[0]?.body?.get('file');
		expect(posted).toBeInstanceOf(Blob);
		expect(await (posted as Blob).text()).toBe('square');
		expect(cropCard()).toBeNull();
	});

	it('closes the crop card at Cancel, and posts nothing', async () => {
		const { root, sent } = screen({ notificationEmail: null, mail: SET });
		pick(root, PICKED);
		await measure();

		await act(async () => buttonNamed(cropCard() as HTMLElement, 'Cancel')?.click());

		expect(cropCard()).toBeNull();
		expect(squareLogo).not.toHaveBeenCalled();
		expect(sent).toEqual([]);
		expect(buttonNamed(logo(root), 'Add logo')).toBeDefined();
	});

	it('says the logo is being removed until the removal is answered', async () => {
		const { root, sent } = screen(
			{ notificationEmail: null, mail: SET, logo: { id: 'img_1', src: '/image/img_1' } },
			() => new Promise(() => {})
		);
		const remove = logo(root).querySelector<HTMLButtonElement>(
			'button[aria-label="Remove the logo"]'
		);

		await act(async () => remove?.click());

		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0]?.method).toBe('DELETE');
		expect(remove?.textContent).toBe('Removing');
		expect(remove?.getAttribute('aria-busy')).toBe('true');
		expect(buttonNamed(logo(root), 'Replace logo')?.getAttribute('aria-disabled')).toBe('true');
	});
});
