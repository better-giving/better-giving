import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLocation } from 'react-router';
import { describe, expect, it, onTestFinished } from 'vitest';
import { formatInstant } from '$lib/admin/viewer-time';
import { browserIn } from '$lib/admin/viewer-time.testing';
import type { MatchStatus } from '$lib/matching/status';
import { GiftDetail, type GiftDetailProps } from './gift-detail';

// the gift detail at /admin/donations/{id}, mounted over the route's read: the presses only while
// the claim is live, the void's confirm opening on its reason and refusing a blank one, Escape and
// Cancel taking it down, the gift card's amount and receipt rows, the history's rows, and the
// missing-address notice for staff and members.
//
// not the browser spec AGENTS.md bans over a dashboard screen: nothing here reads a computed style.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GIFT = '019fb300-0000-7000-8000-000000000001';
const HERE = `/admin/donations/${GIFT}`;

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

function props(over: Partial<GiftDetailProps> = {}): GiftDetailProps {
	return {
		gift: {
			donorName: 'Maya Reyes',
			donorEmail: 'maya.reyes@example.com',
			amountMinor: 15_000,
			currency: 'USD',
			receivedAt: '2026-11-12T16:12:00.000Z',
			paidWith: 'Card',
			status: 'completed',
			receiptSentAt: '2026-11-12T16:12:30.000Z'
		},
		match: {
			status: 'reminded',
			employer: 'Northwind Logistics',
			history: [
				{ event: 'pack_sent', who: 'Better Giving', at: '2026-11-12T16:12:40.000Z' },
				{ event: 'reminded', who: 'Better Giving', at: '2026-11-15T16:00:00.000Z' }
			]
		},
		mailingAddressMissing: false,
		canOpenSettings: true,
		...over
	};
}

/** where the router stands, so a case can read where a press went. */
function Address() {
	const { search } = useLocation();
	return createElement('output', { 'data-address': '' }, search);
}

/** the screen under a router whose action records every body posted to it. */
function screen(
	over: Partial<GiftDetailProps> = {},
	at = HERE
): { root: HTMLElement; posted: Record<string, FormDataEntryValue>[] } {
	const posted: Record<string, FormDataEntryValue>[] = [];
	const Stub = createRoutesStub([
		{
			path: '/admin/donations/:id',
			Component: () =>
				createElement('div', null, createElement(GiftDetail, props(over)), createElement(Address)),
			action: async ({ request }) => {
				posted.push(Object.fromEntries(await request.formData()));
				return null;
			}
		}
	]);
	return { root: mount(createElement(Stub, { initialEntries: [at] })), posted };
}

async function settle(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

const buttons = (within: ParentNode) =>
	[...within.querySelectorAll('button, a')].map((b) => b.textContent);
const footer = (root: HTMLElement) => root.querySelector('.ds-card-footer');
const dialog = () => document.querySelector('dialog');
const address = (root: HTMLElement) => root.querySelector('[data-address]')?.textContent;

describe('the presses', () => {
	it.each([
		'pack_sent',
		'reminded',
		'send_failed',
		null
	] as const satisfies readonly (MatchStatus | null)[])('stand while the claim is %s', (status) => {
		const { root } = screen({
			match: { status, employer: 'Northwind Logistics', history: [] }
		});

		expect(buttons(footer(root) ?? document.createElement('div'))).toEqual([
			'Mark filed',
			'Mark matched',
			'Void…'
		]);
	});

	it('drop Mark filed once the gift is filed, and keep the rest', () => {
		const { root } = screen({ match: { status: 'filed', employer: null, history: [] } });

		expect(buttons(footer(root) ?? document.createElement('div'))).toEqual([
			'Mark matched',
			'Void…'
		]);
	});

	it.each(['matched', 'voided'] as const)('are gone once the claim is %s', (status) => {
		const { root } = screen({ match: { status, employer: 'Northwind Logistics', history: [] } });

		expect(root.querySelector('#match-card-title')?.textContent).toBe('Employer match');
		expect(footer(root)).toBeNull();
	});

	it('draw no match card on a gift recorded before matching', () => {
		const { root } = screen({ match: null });

		expect(root.querySelector('#match-card-title')).toBeNull();
		expect(root.querySelector('#gift-card-title')?.textContent).toBe('Gift');
	});

	it('post the act they name', async () => {
		const { root, posted } = screen();
		const filed = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Mark filed');

		await act(async () => filed?.click());
		await settle();

		expect(posted).toEqual([{ __form_id__: 'match-filed', intent: 'filed' }]);
	});
});

/**
 * the screen with a loader that answers its first read at once and holds every later one until
 * `reload` lets it go, so a case can press while the post's answer is still landing.
 */
function reloading(): {
	root: HTMLElement;
	posted: Record<string, FormDataEntryValue>[];
	reload: () => void;
} {
	const posted: Record<string, FormDataEntryValue>[] = [];
	let reads = 0;
	let reload = () => {};
	const Stub = createRoutesStub([
		{
			path: '/admin/donations/:id',
			Component: () => createElement(GiftDetail, props()),
			loader: async () => {
				reads += 1;
				if (reads > 1) {
					await new Promise<void>((resolve) => {
						reload = resolve;
					});
				}
				return null;
			},
			action: async ({ request }) => {
				posted.push(Object.fromEntries(await request.formData()));
				return null;
			}
		}
	]);
	return {
		root: mount(createElement(Stub, { initialEntries: [HERE] })),
		posted,
		reload: () => reload()
	};
}

describe('a press in flight', () => {
	const press = (root: HTMLElement, words: string) =>
		[...root.querySelectorAll('button')].find((b) => b.textContent === words);

	it('stays held while its answer is still landing', async () => {
		const { root, posted, reload } = reloading();
		await settle();

		await act(async () => press(root, 'Mark filed')?.click());
		await settle();
		expect(press(root, 'Mark filed')?.getAttribute('aria-busy')).toBe('true');
		await act(async () => press(root, 'Mark filed')?.click());
		await settle();

		expect(posted).toHaveLength(1);
		await act(async () => reload());
		await settle();
		expect(press(root, 'Mark filed')?.hasAttribute('aria-busy')).toBe(false);
	});

	it('posts once for two presses in one tick', async () => {
		const { root, posted } = reloading();
		await settle();

		const matched = press(root, 'Mark matched');
		await act(async () => {
			matched?.form?.requestSubmit(matched);
			matched?.form?.requestSubmit(matched);
		});
		await settle();

		expect(posted).toHaveLength(1);
	});
});

describe('the void', () => {
	const voidLink = (root: HTMLElement) =>
		[...root.querySelectorAll('a')].find((a) => a.textContent === 'Void…');
	const reason = () => dialog()?.querySelector('textarea');
	const confirm = () =>
		[...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Void match');

	it('asks on the address, and opens on the reason', async () => {
		const { root } = screen();
		expect(dialog()).toBeNull();

		await act(async () => voidLink(root)?.click());
		await settle();

		expect(address(root)).toBe('?confirm=void');
		expect(dialog()?.getAttribute('aria-labelledby')).toBeTruthy();
		expect(document.activeElement).toBe(reason());
		expect(reason()?.labels?.[0]?.textContent).toBe('Reason');
	});

	it('refuses a blank reason without posting, and says so under the box', async () => {
		const { posted } = screen({}, `${HERE}?confirm=void`);
		const box = reason();
		if (box === undefined || box === null) throw new Error('no reason box');

		await act(async () => {
			box.value = '   ';
			box.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await act(async () => confirm()?.click());
		await settle();

		expect(posted).toEqual([]);
		expect(box.getAttribute('aria-invalid')).toBe('true');
		expect(dialog()?.textContent).toContain('required');
	});

	it('posts the reason it was given', async () => {
		const { posted } = screen({}, `${HERE}?confirm=void`);
		const box = reason();
		if (box === undefined || box === null) throw new Error('no reason box');

		await act(async () => {
			box.value = 'Northwind does not match gifts to this nonprofit';
			box.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await act(async () => confirm()?.click());
		await settle();

		expect(posted).toEqual([
			{
				__form_id__: 'match-void',
				intent: 'void',
				reason: 'Northwind does not match gifts to this nonprofit'
			}
		]);
	});

	it('closes on Escape', async () => {
		const { root } = screen({}, `${HERE}?confirm=void`);

		await act(async () => {
			dialog()?.dispatchEvent(new Event('cancel', { cancelable: true }));
		});
		await settle();

		expect(address(root)).toBe('');
		expect(dialog()).toBeNull();
	});

	it('closes on Cancel', async () => {
		const { root } = screen({}, `${HERE}?confirm=void`);
		const cancel = [...(dialog()?.querySelectorAll('a') ?? [])].find(
			(a) => a.textContent === 'Cancel'
		);

		await act(async () => cancel?.click());
		await settle();

		expect(address(root)).toBe('');
		expect(dialog()).toBeNull();
	});

	it('is not asked on a match already closed, whatever the address says', () => {
		screen({ match: { status: 'voided', employer: null, history: [] } }, `${HERE}?confirm=void`);

		expect(dialog()).toBeNull();
	});
});

describe('an answered press', () => {
	it('lands on the match card, which says what is now true', () => {
		const { root } = screen({
			match: { status: 'filed', employer: 'Northwind Logistics', history: [] },
			result: { done: 'filed' }
		});

		expect(document.activeElement).toBe(root.querySelector('#match-card-title'));
		expect(root.querySelector('.adm-banner__word')?.textContent).toBe('Marked filed');
	});

	it('reads a write that failed in the dialog while it is up, and on the page otherwise', () => {
		const failed = { error: 'This gift has no match to void.' };

		screen({ result: failed }, `${HERE}?confirm=void`);
		expect(dialog()?.querySelector('.adm-banner--blocker')?.textContent).toContain(
			'This gift has no match to void.'
		);
	});
});

describe('the gift card', () => {
	const value = (root: HTMLElement, label: string) => {
		const row = [...root.querySelectorAll('dt')].find((dt) => dt.textContent === label);
		const dd = row?.nextElementSibling;
		if (!(dd instanceof HTMLElement)) throw new Error(`no ${label} row`);
		return dd;
	};

	it('sets the amount in the text face with tabular figures, never the code face', () => {
		const { root } = screen();
		const amount = value(root, 'Amount');

		expect(amount.textContent).toBe('$150.00');
		expect(amount.firstElementChild?.className).toBe('adm-num');
		expect(amount.querySelector('code, .adm-code, .adm-chip, .adm-url')).toBeNull();
	});

	it('states the receipt as one run with one space between the word and the day', () => {
		browserIn('Asia/Manila');
		const { root } = screen({
			gift: { ...props().gift, receiptSentAt: '2026-11-15T12:00:00.000Z' }
		});
		const receipt = value(root, 'Receipt');

		// the value cell is a flex row with a gap, so the word and the day are one item in it.
		expect(receipt.childNodes).toHaveLength(1);
		expect(receipt.textContent).toBe('Sent 15 Nov 2026');
	});

	it('states a receipt not sent in words', () => {
		const { root } = screen({ gift: { ...props().gift, receiptSentAt: null } });

		expect(value(root, 'Receipt').textContent).toBe('Not sent');
	});
});

describe('the history', () => {
	it('names who set each stamp, and the void’s reason on its own line', () => {
		const { root } = screen({
			match: {
				status: 'voided',
				employer: 'Northwind Logistics',
				history: [
					{ event: 'pack_sent', who: 'Better Giving', at: '2026-11-12T16:12:40.000Z' },
					{
						event: 'voided',
						who: 'Amara Lindqvist',
						at: '2026-11-18T14:30:00.000Z',
						reason: 'Northwind does not match gifts to this nonprofit'
					}
				]
			}
		});
		const rows = [...root.querySelectorAll('ol > li')].map((li) =>
			[...li.querySelectorAll('p')].map((p) => p.textContent)
		);

		expect(rows).toEqual([
			['Details emailed to the donor', 'By Better Giving'],
			['Voided', 'By Amara Lindqvist', 'Reason: Northwind does not match gifts to this nonprofit']
		]);
	});

	it.each([
		['Asia/Manila', '15 Nov 2026, 00:30'],
		['UTC', '14 Nov 2026, 16:30']
	])('writes each stamp’s time in a browser in %s, with no offset', (zone, text) => {
		browserIn(zone);
		const { root } = screen({
			match: {
				status: 'reminded',
				employer: 'Northwind Logistics',
				history: [{ event: 'reminded', who: 'Better Giving', at: '2026-11-14T16:30:00.000Z' }]
			}
		});
		const time = root.querySelector('ol > li time');

		expect(time?.textContent).toBe(text);
		expect(time?.textContent).not.toContain('UTC');
		expect(time?.getAttribute('datetime')).toBe('2026-11-14T16:30:00.000Z');
	});
});

describe('the missing mailing address', () => {
	const notice = (root: HTMLElement) => root.querySelector('.adm-banner--attention');

	it('takes staff to Settings', () => {
		const { root } = screen({ mailingAddressMissing: true, canOpenSettings: true });
		const shown = notice(root);
		const open = shown?.querySelector('a');

		expect(shown?.textContent).toContain('Matching details are missing a mailing address');
		expect(open?.textContent).toBe('Open Settings');
		expect(open?.getAttribute('href')).toBe('/admin/settings');
		expect(shown?.textContent).not.toContain('Ask whoever runs this server');
	});

	it('tells a member who can save it, and offers no press', () => {
		const { root } = screen({ mailingAddressMissing: true, canOpenSettings: false });
		const shown = notice(root);

		expect(shown?.textContent).toContain(
			"Donors' gift pages and emails leave the address line out until it's saved."
		);
		expect(shown?.textContent).toContain(
			'Ask whoever runs this server to save the mailing address in Settings.'
		);
		expect(shown?.querySelector('a, button')).toBeNull();
	});

	it('is not drawn while the profile holds an address', () => {
		expect(notice(screen().root)).toBeNull();
	});

	it.each([
		['the gift predates matching', null],
		['the donor named no employer', { status: 'filed', employer: null, history: [] }]
	] as const)('is not drawn where %s, since the donor is handed nothing to file', (_, match) => {
		expect(notice(screen({ mailingAddressMissing: true, match }).root)).toBeNull();
	});
});
