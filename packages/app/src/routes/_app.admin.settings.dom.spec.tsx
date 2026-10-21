import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { CropSquare } from '$lib/admin/settings/logo-crop';
import type { NonprofitLookupAnswer, NonprofitSearchAnswer } from '$lib/org/nonprofit-answers';
import Settings from './_app.admin.settings';
import { shouldRevalidate as searchShouldRevalidate } from './_app.admin.settings_.nonprofits';
import { shouldRevalidate as lookupShouldRevalidate } from './_app.admin.settings_.nonprofits_.$ein';

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

/** how the two organisation addresses answer: a name search by its query, a lookup by its EIN. */
type Nonprofits = {
	readonly search?: (q: string) => Promise<NonprofitSearchAnswer>;
	readonly lookup?: (ein: string) => Promise<NonprofitLookupAnswer>;
};

/** what reached the screen's other addresses: the organisation calls in order, and the saves. */
type Asked = { readonly calls: string[]; readonly saves: FormData[] };

const UNANSWERED = () => new Promise<never>(() => {});

/**
 * the screen, with the logo's address answering as `answer` says and the organisation addresses as
 * `nonprofits` does — each with its own module's `shouldRevalidate`, as the app routes it. every
 * request that reaches the logo's address is recorded in `sent`, every organisation call and every
 * save of the screen's own in `asked`.
 */
function screen(
	{ details, logo, ...over }: Drawn,
	answer: (request: Request) => Promise<unknown> = async () => ({ logo: null }),
	{ search = UNANSWERED, lookup = UNANSWERED }: Nonprofits = {}
): { readonly root: HTMLElement; readonly sent: Sent[]; readonly asked: Asked } {
	const sent: Sent[] = [];
	const asked: Asked = { calls: [], saves: [] };
	const Stub = createRoutesStub([
		{
			path: '/admin/settings',
			action: async ({ request }) => {
				asked.saves.push(await request.formData());
				return null;
			},
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
		},
		{
			path: '/admin/settings/nonprofits',
			shouldRevalidate: searchShouldRevalidate,
			loader: ({ request }) => {
				const q = new URL(request.url).searchParams.get('q') ?? '';
				asked.calls.push(`search ${q}`);
				return search(q);
			}
		},
		{
			path: '/admin/settings/nonprofits/:ein',
			shouldRevalidate: lookupShouldRevalidate,
			loader: ({ params }) => {
				asked.calls.push(`lookup ${params.ein}`);
				return lookup(params.ein ?? '');
			}
		}
	]);
	return {
		root: mount(createElement(Stub, { initialEntries: ['/admin/settings'] })),
		sent,
		asked
	};
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

describe('find your charity', () => {
	/** a profile with no details saved yet: every box empty. */
	const EMPTY = Object.fromEntries(
		Object.entries(DETAILS).map(([box, value]) => [box, Array.isArray(value) ? [] : ''])
	) as Partial<typeof DETAILS>;

	const LISTED = { deductible: true, revoked: false, revocationDate: null } as const;

	const FOUND: NonprofitLookupAnswer = {
		kind: 'lookup',
		outcome: 'found',
		fields: {
			legal_name: 'Riverside Community Food Bank',
			tax_id: '95-1234567',
			address_line1: '2950 Jefferson St',
			city: 'Riverside',
			region: 'CA',
			postal_code: '92504',
			country: 'United States'
		},
		...LISTED
	};

	const MATCHES: NonprofitSearchAnswer = {
		kind: 'search',
		outcome: 'found',
		matches: [
			{
				ein: '95-1234567',
				name: 'Riverside Community Food Bank',
				city: 'Riverside',
				state: 'CA',
				...LISTED
			},
			{
				ein: '31-7654321',
				name: 'Riverside Food Network',
				city: 'Dayton',
				state: 'OH',
				deductible: false,
				revoked: false,
				revocationDate: null
			},
			{
				ein: '52-1111111',
				name: 'Riverside Food Pantry',
				city: 'Riverside',
				state: 'CA',
				deductible: false,
				revoked: true,
				revocationDate: '2023-05-15'
			},
			{
				ein: '77-2222222',
				name: 'Riverside Gleaners',
				city: '',
				state: 'IL',
				deductible: null,
				revoked: null,
				revocationDate: null
			}
		]
	};

	const details = (root: HTMLElement) => card(root, 'Organisation details');
	const finderBox = (root: HTMLElement) =>
		details(root).querySelector<HTMLInputElement>('search input[role="combobox"]');
	const buttonNamed = (within: ParentNode, words: string) =>
		[...within.querySelectorAll('button')].find((button) => button.textContent === words);
	const said = (root: HTMLElement) =>
		details(root).querySelector('.adm-findorg__said')?.textContent ?? '<no finder>';
	const note = (root: HTMLElement) => details(root).querySelector('.adm-findnote')?.textContent;
	const boxValue = (root: HTMLElement, name: string) =>
		details(root).querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;

	/** `text` typed into the finder's box with the focus in it, then Search pressed. */
	async function press(root: HTMLElement, text: string) {
		const box = finderBox(root);
		if (box === null) throw new Error('the finder is not drawn');
		act(() => box.focus());
		type(box, text);
		// the machine hands the typed value on a microtask after the input event.
		await act(async () => {});
		await act(async () => buttonNamed(details(root), 'Search')?.click());
	}

	/** the option naming `name`, clicked as a pointer would. */
	async function pick(root: HTMLElement, name: string) {
		const option = [...details(root).querySelectorAll<HTMLElement>('[role="option"]')].find((row) =>
			row.textContent?.includes(name)
		);
		if (option === undefined) throw new Error(`no match named ${name}`);
		await act(async () => option.click());
	}

	it('is open on a profile with no details, above the boxes', () => {
		const { root } = screen({ notificationEmail: null, mail: SET, details: EMPTY });

		const search = details(root).querySelector('search');
		expect(search?.querySelector('label')?.textContent).toBe('Find your charity');
		expect(buttonNamed(details(root), 'Search')).toBeDefined();
		expect(
			search?.compareDocumentPosition(details(root).querySelector('input[name="tax_id"]') as Node)
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		expect(buttonNamed(details(root), 'Pick a different organisation')).toBeUndefined();
	});

	it('hides once details are saved, and opens at Pick a different organisation', async () => {
		const { root } = screen({ notificationEmail: null, mail: SET });

		expect(details(root).querySelector('search')).toBeNull();
		const reopen = buttonNamed(details(root), 'Pick a different organisation');
		expect(reopen?.getAttribute('type')).toBe('button');

		await act(async () => reopen?.click());

		expect(finderBox(root)).not.toBeNull();
		expect(document.activeElement).toBe(finderBox(root));
		expect(buttonNamed(details(root), 'Pick a different organisation')).toBeUndefined();
	});

	it('makes one lookup for an EIN press, and nothing else', async () => {
		const { root, asked } = screen(
			{ notificationEmail: null, mail: SET, details: EMPTY },
			undefined,
			{
				lookup: async () => FOUND
			}
		);

		await press(root, '951234567');

		await vi.waitFor(() =>
			expect(boxValue(root, 'legal_name')).toBe('Riverside Community Food Bank')
		);
		expect(asked.calls).toEqual(['lookup 95-1234567']);
	});

	it('makes one search for a name press, and lists what it found', async () => {
		const { root, asked } = screen(
			{ notificationEmail: null, mail: SET, details: EMPTY },
			undefined,
			{
				search: async () => MATCHES
			}
		);

		await press(root, 'riverside food');

		await vi.waitFor(() => expect(said(root)).toBe('4 matches.'));
		expect(asked.calls).toEqual(['search riverside food']);
		const rows = [...details(root).querySelectorAll('[role="option"]')].map(
			(row) => row.textContent
		);
		expect(rows[0]).toContain('Riverside Community Food Bank');
		expect(rows[0]).toContain('Riverside, CA');
		expect(rows[3]).toContain('IL');
	});

	it('asks nothing while typing, and holds a second press while the first is out', async () => {
		const { root, asked } = screen({ notificationEmail: null, mail: SET, details: EMPTY });
		const box = finderBox(root) as HTMLInputElement;

		act(() => box.focus());
		type(box, 'riv');
		type(box, 'river');
		await act(async () => {});
		expect(asked.calls).toEqual([]);

		await press(root, 'riverside');
		await vi.waitFor(() => expect(said(root)).toBe('Searching…'));
		const search = buttonNamed(details(root), 'Search');
		expect(search?.getAttribute('aria-busy')).toBe('true');
		expect(search?.getAttribute('aria-disabled')).toBe('true');
		await act(async () => search?.click());
		expect(asked.calls).toEqual(['search riverside']);
	});

	it('looks a picked match up once and fills the boxes, saving nothing', async () => {
		const lookedUp: NonprofitLookupAnswer = { ...FOUND, deductible: false };
		const { root, asked } = screen(
			{ notificationEmail: null, mail: SET, details: { ...EMPTY, address_line2: 'Suite 4' } },
			undefined,
			{ search: async () => MATCHES, lookup: async () => lookedUp }
		);
		await press(root, 'riverside food');
		await vi.waitFor(() => expect(said(root)).toBe('4 matches.'));

		await pick(root, 'Riverside Community Food Bank');

		await vi.waitFor(() => expect(boxValue(root, 'tax_id')).toBe('95-1234567'));
		expect(asked.calls).toEqual(['search riverside food', 'lookup 95-1234567']);
		expect({
			legal_name: boxValue(root, 'legal_name'),
			address_line1: boxValue(root, 'address_line1'),
			address_line2: boxValue(root, 'address_line2'),
			city: boxValue(root, 'city'),
			region: boxValue(root, 'region'),
			postal_code: boxValue(root, 'postal_code'),
			country: boxValue(root, 'country')
		}).toEqual({
			legal_name: 'Riverside Community Food Bank',
			address_line1: '2950 Jefferson St',
			address_line2: 'Suite 4',
			city: 'Riverside',
			region: 'CA',
			postal_code: '92504',
			country: 'United States'
		});
		expect(note(root)).toBe('Filled from the IRS list. Not listed as tax-deductible');
		expect(asked.saves).toEqual([]);
		expect(buttonNamed(details(root), 'Save details')?.hasAttribute('disabled')).toBe(false);
		// the list it was picked from stays drawn.
		expect(details(root).querySelectorAll('[role="option"]')).toHaveLength(4);
	});

	it('fills the boxes a picked match carries at once, while its address is still being looked up', async () => {
		const { root, asked } = screen(
			{ notificationEmail: null, mail: SET, details: EMPTY },
			undefined,
			{ search: async () => MATCHES }
		);
		await press(root, 'riverside food');
		await vi.waitFor(() => expect(said(root)).toBe('4 matches.'));

		await pick(root, 'Riverside Food Network');

		expect({
			tax_id: boxValue(root, 'tax_id'),
			legal_name: boxValue(root, 'legal_name'),
			city: boxValue(root, 'city'),
			region: boxValue(root, 'region'),
			address_line1: boxValue(root, 'address_line1'),
			postal_code: boxValue(root, 'postal_code')
		}).toEqual({
			tax_id: '31-7654321',
			legal_name: 'Riverside Food Network',
			city: 'Dayton',
			region: 'OH',
			address_line1: '',
			postal_code: ''
		});
		expect(note(root)).toBe('Filled from the IRS list. Not listed as tax-deductible');
		expect(said(root)).toBe('Looking up…');
		expect(asked.calls).toEqual(['search riverside food', 'lookup 31-7654321']);
	});

	it('keeps what a pick filled when its address lookup is turned away, and fetches it once the wait is over', async () => {
		let lookups = 0;
		const { root, asked } = screen(
			{ notificationEmail: null, mail: SET, details: EMPTY },
			undefined,
			{
				search: async () => MATCHES,
				lookup: async () =>
					lookups++ === 0 ? { kind: 'lookup', outcome: 'rate_limited', retryAfter: 1 } : FOUND
			}
		);
		await press(root, 'riverside food');
		await vi.waitFor(() => expect(said(root)).toBe('4 matches.'));

		await pick(root, 'Riverside Community Food Bank');

		await vi.waitFor(() =>
			expect(said(root)).toBe(
				'Too many lookups for now. The street address and postal code can be fetched in 1 second.'
			)
		);
		expect(boxValue(root, 'legal_name')).toBe('Riverside Community Food Bank');
		expect(boxValue(root, 'tax_id')).toBe('95-1234567');
		const fetch = buttonNamed(details(root), 'Fetch the address');
		expect(fetch?.getAttribute('type')).toBe('button');
		expect(fetch?.getAttribute('aria-disabled')).toBe('true');
		await act(async () => fetch?.click());
		expect(asked.calls).toEqual(['search riverside food', 'lookup 95-1234567']);

		// an edit made during the wait is the deployer's, and the address alone is fetched over it.
		type(
			details(root).querySelector<HTMLInputElement>('input[name="legal_name"]') as HTMLInputElement,
			'Riverside Food Bank'
		);
		await vi.waitFor(
			() => expect(said(root)).toBe('The street address and postal code can be fetched now.'),
			{ timeout: 3000 }
		);
		expect(buttonNamed(details(root), 'Fetch the address')?.hasAttribute('aria-disabled')).toBe(
			false
		);

		const ready = buttonNamed(details(root), 'Fetch the address');
		act(() => ready?.focus());
		await act(async () => ready?.click());

		await vi.waitFor(() => expect(boxValue(root, 'address_line1')).toBe('2950 Jefferson St'));
		expect(asked.calls).toEqual([
			'search riverside food',
			'lookup 95-1234567',
			'lookup 95-1234567'
		]);
		expect(boxValue(root, 'postal_code')).toBe('92504');
		expect(boxValue(root, 'country')).toBe('United States');
		expect(boxValue(root, 'legal_name')).toBe('Riverside Food Bank');
		expect(said(root)).toBe('');
		// the press goes with the refusal, and the focus it held goes back to the finder's box.
		expect(buttonNamed(details(root), 'Fetch the address')).toBeUndefined();
		expect(document.activeElement).toBe(finderBox(root));
	});

	it('asks the service nothing more when the filled details are saved', async () => {
		const { root, asked } = screen(
			{ notificationEmail: null, mail: SET, details: EMPTY },
			undefined,
			{
				lookup: async () => FOUND
			}
		);
		await press(root, '95-1234567');
		await vi.waitFor(() =>
			expect(boxValue(root, 'legal_name')).toBe('Riverside Community Food Bank')
		);

		await act(async () => buttonNamed(details(root), 'Save details')?.click());

		await vi.waitFor(() => expect(asked.saves).toHaveLength(1));
		expect(asked.saves[0]?.get('legal_name')).toBe('Riverside Community Food Bank');
		await act(async () => {});
		expect(asked.calls).toEqual(['lookup 95-1234567']);
	});

	it('says each match’s standing, a revocation over its deductibility', async () => {
		const { root } = screen({ notificationEmail: null, mail: SET, details: EMPTY }, undefined, {
			search: async () => MATCHES
		});

		await press(root, 'riverside');
		await vi.waitFor(() => expect(said(root)).toBe('4 matches.'));

		const words = [...details(root).querySelectorAll('[role="option"]')].map(
			(row) =>
				row.querySelector('.adm-findrow__who > :last-child:not(.adm-findrow__place)')
					?.textContent ?? null
		);
		expect(words).toEqual([
			null,
			'Not listed as tax-deductible',
			'Tax-exempt status revoked May 15, 2023.',
			'Tax-deductible status not known'
		]);
	});

	it('says the standing of the organisation the boxes were filled from', async () => {
		const { root } = screen({ notificationEmail: null, mail: SET, details: EMPTY }, undefined, {
			lookup: async () => ({ ...FOUND, revoked: true, revocationDate: '2023-05-15' })
		});

		await press(root, '95-1234567');

		await vi.waitFor(() =>
			expect(note(root)).toBe('Filled from the IRS list. Tax-exempt status revoked May 15, 2023.')
		);
		expect(said(root)).toBe('');
	});

	it('refuses a query under two characters on screen, and sends nothing', async () => {
		const { root, asked } = screen({ notificationEmail: null, mail: SET, details: EMPTY });

		await press(root, ' r ');

		expect(said(root)).toBe('Type at least 2 characters.');
		await act(async () => {});
		expect(asked.calls).toEqual([]);
	});

	it.each([
		[
			'a lookup not on the list',
			'95-1234567',
			{ kind: 'lookup', outcome: 'not_found' },
			'Not on the IRS list.'
		],
		[
			'a lookup the service could not answer',
			'95-1234567',
			{ kind: 'lookup', outcome: 'unavailable' },
			"Couldn't look this up. Fill in the details yourself."
		],
		[
			'a search the service could not answer',
			'riverside',
			{ kind: 'search', outcome: 'unavailable' },
			"Couldn't search the IRS list. Search by EIN instead."
		],
		[
			'a search with no matches',
			'riverside',
			{ kind: 'search', outcome: 'found', matches: [] },
			'No matches.'
		],
		[
			'a lookup turned away for the rate limit',
			'95-1234567',
			{ kind: 'lookup', outcome: 'rate_limited', retryAfter: 42 },
			'Too many lookups for now. Try again in 42 seconds.'
		],
		[
			'a search turned away for the day',
			'riverside',
			{ kind: 'search', outcome: 'rate_limited', retryAfter: 3600 },
			'Too many lookups for now. Try again in 60 minutes.'
		]
	] as const)('says what %s comes to, and fills nothing', async (_, typed, answer, words) => {
		const { root } = screen({ notificationEmail: null, mail: SET, details: EMPTY }, undefined, {
			search: async () => answer as NonprofitSearchAnswer,
			lookup: async () => answer as NonprofitLookupAnswer
		});

		await press(root, typed);

		await vi.waitFor(() => expect(said(root)).toBe(words));
		expect(boxValue(root, 'legal_name')).toBe('');
		expect(note(root)).toBe('');
		expect(buttonNamed(details(root), 'Save details')).toBeDefined();
	});

	it('says it is looking up while a lookup is out', async () => {
		const { root } = screen({ notificationEmail: null, mail: SET, details: EMPTY });

		await press(root, '95-1234567');

		await vi.waitFor(() => expect(said(root)).toBe('Looking up…'));
	});
});
