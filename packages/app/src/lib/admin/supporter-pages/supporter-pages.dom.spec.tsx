import { CONFIRMATION_MS } from '@better-giving/operator/save-state';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { WHICH_FORM } from '$lib/forms/definition';
import {
	type SupporterPageBatch,
	type SupporterPageRow,
	SupporterPages,
	type SupporterPagesProps
} from './supporter-pages';

// Supporter pages, mounted over the route's read and its answers: the setting for the deployer and
// for a member, a row per status, Hide through its confirm and its note's limit, Show again straight
// off, the moment a landed press says what happened, the empty card by what the setting is, and
// Show more pages, a batch at a time, across the re-read a press brings.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const page = (
	over: Partial<SupporterPageRow> & Pick<SupporterPageRow, 'id'>
): SupporterPageRow => ({
	supporterName: 'Maya Reyes',
	supporterEmail: 'maya@example.org',
	title: 'Keep the pantry trucks running this winter',
	address: '/f/keep-the-pantry-trucks-7k2p',
	openHref: '/f/keep-the-pantry-trucks-7k2p',
	goalMinor: 500_000,
	raisedMinor: 324_000,
	currency: 'USD',
	status: 'live',
	hidden: false,
	...over
});

const MAYA = page({ id: 'page-maya' });
const JO = page({
	id: 'page-jo',
	supporterName: 'Jo Okafor',
	supporterEmail: 'jo@example.org',
	title: 'Birthday pantry drive',
	address: '/f/birthday-pantry-drive-3m9c',
	openHref: '/admin/supporter-pages/page-jo/preview',
	goalMinor: 100_000,
	raisedMinor: 31_000,
	hidden: true
});
const DANA = page({
	id: 'page-dana',
	supporterName: 'Dana Whitfield',
	title: 'Holiday meals for 40 families',
	status: 'ended'
});
const SAM = page({
	id: 'page-sam',
	supporterName: 'Sam Lee',
	title: 'Coat drive',
	status: 'pending'
});

function mount(over: Partial<SupporterPagesProps> = {}) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	const props: SupporterPagesProps = {
		orgName: 'Harbor Light',
		setting: { enabled: true, mayChange: true, pending: false, saved: false, refused: null },
		pages: [MAYA, JO, DANA, SAM],
		total: 4,
		next: null,
		onSaveSetting: () => {},
		onHide: () => {},
		onShow: () => {},
		onShowMore: async () => null,
		...over
	};
	act(() => root.render(<SupporterPages {...props} />));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return {
		host,
		rerender: (next: Partial<SupporterPagesProps>) => {
			Object.assign(props, next);
			act(() => root.render(<SupporterPages {...props} />));
		}
	};
}

const row = (host: HTMLElement, name: string) =>
	[...host.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(name)) ?? null;
const press = (host: HTMLElement, name: string) =>
	row(host, name)?.querySelector<HTMLButtonElement>('button') ?? null;
const nameOf = (el: Element | null) =>
	(el?.getAttribute('aria-labelledby') ?? '')
		.split(' ')
		.filter(Boolean)
		.map((id) => document.getElementById(id)?.textContent ?? '')
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
const toggle = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input[role="switch"]');
const saveButton = (host: HTMLElement) =>
	[...host.querySelectorAll('button')].find((b) => b.textContent === 'Save') ?? null;
const dialog = () => document.querySelector('dialog');
const dialogButton = (label: string) =>
	[...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === label) ?? null;
const statusLine = (host: HTMLElement) =>
	host.querySelector('p.adm-vh[role="status"]')?.textContent;
const bodyOf = (body: FormData | undefined) => Object.fromEntries(body?.entries() ?? []);

/** types into a controlled textarea the way a browser does, so react's change handler sees it. */
function type(box: HTMLTextAreaElement, value: string) {
	const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
	act(() => {
		set?.call(box, value);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

afterEach(() => {
	vi.useRealTimers();
});

describe('the setting', () => {
	it('draws the switch on, read on Save rather than on the flip', () => {
		const onSaveSetting = vi.fn();
		const { host } = mount({ onSaveSetting });
		const sw = toggle(host);

		expect(host.querySelector('h1')?.textContent).toBe('Supporter pages');
		expect(sw?.checked).toBe(true);
		expect(sw?.disabled).toBe(false);
		expect(nameOf(sw)).toBe('Let supporters start fundraisers');
		expect(saveButton(host)?.getAttribute('aria-disabled')).toBe('true');

		act(() => sw?.click());
		expect(onSaveSetting).not.toHaveBeenCalled();
		expect(sw?.checked).toBe(false);
		expect(saveButton(host)?.hasAttribute('aria-disabled')).toBe(false);

		act(() => saveButton(host)?.click());
		expect(onSaveSetting).toHaveBeenCalledTimes(1);
		expect(bodyOf(onSaveSetting.mock.calls[0]?.[0])).toEqual({ [WHICH_FORM]: 'supporter-setting' });
	});

	it('posts enabled=on when turned back on from off', () => {
		const onSaveSetting = vi.fn();
		const { host } = mount({
			onSaveSetting,
			setting: { enabled: false, mayChange: true, pending: false, saved: false, refused: null }
		});
		expect(toggle(host)?.checked).toBe(false);

		act(() => toggle(host)?.click());
		act(() => saveButton(host)?.click());
		expect(bodyOf(onSaveSetting.mock.calls[0]?.[0])).toEqual({
			[WHICH_FORM]: 'supporter-setting',
			enabled: 'on'
		});
	});

	it('takes the flip back to the stored value once a save lands', () => {
		const { host, rerender } = mount();
		act(() => toggle(host)?.click());
		rerender({
			setting: { enabled: false, mayChange: true, pending: false, saved: true, refused: null }
		});
		expect(toggle(host)?.checked).toBe(false);
		expect(saveButton(host)).toBeNull();
		expect(host.textContent).toContain('Saved');
	});

	it('says a refused save beside the press', () => {
		const { host } = mount({
			setting: {
				enabled: true,
				mayChange: true,
				pending: false,
				saved: false,
				refused: 'Couldn’t save this setting. Try again.'
			}
		});
		expect(host.querySelector('form [role="alert"]')?.textContent).toBe(
			'Couldn’t save this setting. Try again.'
		);
	});

	it('shows a member the switch disabled, with why, and no Save', () => {
		const { host } = mount({
			setting: { enabled: true, mayChange: false, pending: false, saved: false, refused: null }
		});
		const sw = toggle(host);

		expect(sw?.checked).toBe(true);
		expect(sw?.disabled).toBe(true);
		expect(document.getElementById(sw?.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
			'On. Only whoever runs this server can change this.'
		);
		expect(saveButton(host)).toBeNull();
		expect(host.querySelector(`input[name="${WHICH_FORM}"][value="supporter-setting"]`)).toBeNull();
	});

	it('says Off to a member while it is off', () => {
		const { host } = mount({
			setting: { enabled: false, mayChange: false, pending: false, saved: false, refused: null }
		});
		expect(host.textContent).toContain('Off. Only whoever runs this server can change this.');
	});
});

describe('the list', () => {
	it('counts the pages and heads the columns', () => {
		const { host } = mount();
		expect(host.querySelector('.adm-hint')?.textContent).toContain(
			'Fundraisers your supporters started for Harbor Light.'
		);
		expect(host.querySelector('.adm-tablecaption')?.textContent).toBe(
			'4 supporter pages, newest first.'
		);
		expect([...host.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
			'Supporter',
			'Page',
			'Goal',
			'Raised',
			'Status',
			'Actions'
		]);
	});

	it('draws a live row: the supporter over their email, the page over its address, the money, Open and Hide', () => {
		const { host } = mount();
		const live = row(host, 'Maya Reyes');
		const cells = [...(live?.children ?? [])].map((c) => c.textContent);

		expect(cells.slice(0, 4)).toEqual([
			'Maya Reyesmaya@example.org',
			'Keep the pantry trucks running this winter/f/keep-the-pantry-trucks-7k2p',
			'$5,000.00',
			'$3,240.00'
		]);
		expect(live?.querySelector('.ds-badge')?.textContent).toBe('Live');
		expect(live?.querySelector('.ds-badge')?.className).toBe('ds-badge ds-badge-primary');

		const open = live?.querySelector('a');
		expect(open?.getAttribute('href')).toBe('/f/keep-the-pantry-trucks-7k2p');
		expect(open?.getAttribute('target')).toBe('_blank');
		expect(nameOf(open ?? null)).toBe(
			'Open Keep the pantry trucks running this winter in a new tab'
		);

		const hide = press(host, 'Maya Reyes');
		expect(hide?.textContent).toBe('Hide');
		expect(nameOf(hide)).toBe('Hide Keep the pantry trucks running this winter');
		expect(hide?.getAttribute('aria-haspopup')).toBe('dialog');
	});

	it('draws a hidden row as Hidden on the warning chip, Open to the preview, and Show again', () => {
		const { host } = mount();
		const hidden = row(host, 'Jo Okafor');

		expect(hidden?.querySelector('.ds-badge')?.textContent).toBe('Hidden');
		expect(hidden?.querySelector('.ds-badge-warning')).not.toBeNull();
		expect(hidden?.querySelector('a')?.getAttribute('href')).toBe(
			'/admin/supporter-pages/page-jo/preview'
		);
		const show = press(host, 'Jo Okafor');
		expect(show?.textContent).toBe('Show again');
		expect(nameOf(show)).toBe('Show again Birthday pantry drive');
		expect(show?.hasAttribute('aria-haspopup')).toBe(false);
	});

	it('draws an ended row as Ended and a pending one as Pending, each on a hueless chip', () => {
		const { host } = mount();
		expect(row(host, 'Dana Whitfield')?.querySelector('.ds-badge')?.className).toBe(
			'ds-badge ds-badge-outline'
		);
		expect(row(host, 'Dana Whitfield')?.querySelector('.ds-badge')?.textContent).toBe('Ended');
		expect(row(host, 'Sam Lee')?.querySelector('.ds-badge')?.className).toBe(
			'ds-badge ds-badge-neutral'
		);
		expect(row(host, 'Sam Lee')?.querySelector('.ds-badge')?.textContent).toBe('Pending');
	});

	// at a phone's width the plane scrolls sideways in its own box with the supporter pinned, as the
	// gifts list's does (`.adm-plane` in packages/operator/src/styles/adm.css): it stands in the column
	// with nothing between them, and the head named only for a reader stays inside the plane that
	// contains it rather than widening the page.
	it('stands the plane in the column directly, the supporter pinned and every head inside it', () => {
		const { host } = mount();
		const plane = host.querySelector('.adm-plane');
		expect(plane?.parentElement?.classList.contains('adm-column')).toBe(true);
		expect(plane?.getAttribute('tabindex')).toBe('0');
		expect(plane?.querySelector('thead th[data-pin]')?.textContent).toBe('Supporter');
		expect(row(host, 'Maya Reyes')?.firstElementChild?.hasAttribute('data-pin')).toBe(true);
		expect(host.querySelector('thead .adm-vh')?.closest('.adm-plane')).toBe(plane);
	});

	it('says one page in the singular', () => {
		const { host } = mount({ pages: [MAYA], total: 1 });
		expect(host.querySelector('.adm-tablecaption')?.textContent).toBe(
			'1 supporter page, newest first.'
		);
	});
});

describe('Hide', () => {
	it('opens a confirm on Cancel, quoting the page, and Cancel takes it down unsent', () => {
		const onHide = vi.fn();
		const { host } = mount({ onHide });
		act(() => press(host, 'Maya Reyes')?.click());

		expect(dialog()?.getAttribute('role')).toBe('alertdialog');
		expect(dialog()?.querySelector('h2')?.textContent).toBe('Hide this page?');
		expect(dialog()?.querySelector('.adm-quote')?.textContent).toBe(
			'Keep the pantry trucks running this winterMaya Reyes · $3,240.00 raised'
		);
		expect(document.activeElement).toBe(dialogButton('Cancel'));
		expect(dialog()?.querySelector('label')?.textContent).toContain('Note for the supporter');

		act(() => dialogButton('Cancel')?.click());
		expect(dialog()).toBeNull();
		expect(onHide).not.toHaveBeenCalled();
	});

	it('posts the page and its note on Hide page', () => {
		const onHide = vi.fn();
		const { host } = mount({ onHide });
		act(() => press(host, 'Maya Reyes')?.click());
		const note = dialog()?.querySelector('textarea');
		if (!note) throw new Error('the confirm drew no note box');
		type(note, 'Please replace the photo.');
		act(() => dialogButton('Hide page')?.click());

		expect(onHide).toHaveBeenCalledTimes(1);
		expect(onHide.mock.calls[0]?.[0]).toBe('page-maya');
		expect(bodyOf(onHide.mock.calls[0]?.[1])).toEqual({
			[WHICH_FORM]: 'supporter-page-hide',
			page_id: 'page-maya',
			note: 'Please replace the photo.'
		});
	});

	it('refuses a note over 300 characters at the box, sends nothing, and clears once it fits', () => {
		const onHide = vi.fn();
		const { host } = mount({ onHide });
		act(() => press(host, 'Maya Reyes')?.click());
		const note = dialog()?.querySelector('textarea');
		if (!note) throw new Error('the confirm drew no note box');
		type(note, 'x'.repeat(301));
		expect(note.getAttribute('aria-invalid')).toBeNull();

		act(() => dialogButton('Hide page')?.click());
		expect(onHide).not.toHaveBeenCalled();
		expect(note.getAttribute('aria-invalid')).toBe('true');
		expect(dialog()?.textContent).toContain('must be at most 300 characters');
		expect(document.activeElement).toBe(note);

		type(note, 'x'.repeat(300));
		expect(note.getAttribute('aria-invalid')).toBeNull();
		act(() => dialogButton('Hide page')?.click());
		expect(onHide).toHaveBeenCalledTimes(1);
	});

	it('holds the confirm open with the refusal in it', () => {
		const { host, rerender } = mount();
		act(() => press(host, 'Maya Reyes')?.click());
		act(() => dialogButton('Hide page')?.click());
		rerender({ presses: { 'page-maya': { pending: true, outcome: null } } });
		expect(dialogButton('Hide page')?.getAttribute('aria-busy')).toBe('true');

		rerender({
			presses: {
				'page-maya': { pending: false, outcome: { refused: 'Couldn’t hide this page. Try again.' } }
			}
		});
		expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe(
			'Couldn’t hide this page. Try again.'
		);
	});

	it('takes the confirm down once the row reads hidden, and says “Hidden from visitors” at the press for a moment', () => {
		vi.useFakeTimers();
		const { host, rerender } = mount();
		act(() => press(host, 'Maya Reyes')?.click());
		act(() => dialogButton('Hide page')?.click());
		rerender({ presses: { 'page-maya': { pending: true, outcome: null } } });
		rerender({
			pages: [{ ...MAYA, hidden: true }, JO, DANA, SAM],
			presses: { 'page-maya': { pending: false, outcome: { landed: 'hidden' } } }
		});

		expect(dialog()).toBeNull();
		expect(press(host, 'Maya Reyes')?.textContent).toBe('Hidden from visitors');
		expect(press(host, 'Maya Reyes')?.getAttribute('aria-disabled')).toBe('true');
		expect(statusLine(host)).toBe('Hidden from visitors');

		act(() => vi.advanceTimersByTime(CONFIRMATION_MS));
		expect(press(host, 'Maya Reyes')?.textContent).toBe('Show again');
		expect(statusLine(host)).toBe('');
	});

	it('leaves focus on the row’s press once a landed Hide takes the confirm down', () => {
		const { host, rerender } = mount();
		act(() => press(host, 'Maya Reyes')?.click());
		act(() => dialogButton('Hide page')?.click());
		rerender({ presses: { 'page-maya': { pending: true, outcome: null } } });
		rerender({
			pages: [{ ...MAYA, hidden: true }, JO, DANA, SAM],
			presses: { 'page-maya': { pending: false, outcome: { landed: 'hidden' } } }
		});

		expect(dialog()).toBeNull();
		expect(document.activeElement).toBe(press(host, 'Maya Reyes'));
	});
});

describe('Show again', () => {
	it('posts at once, with no confirm', () => {
		const onShow = vi.fn();
		const { host } = mount({ onShow });
		act(() => press(host, 'Jo Okafor')?.click());

		expect(dialog()).toBeNull();
		expect(onShow).toHaveBeenCalledTimes(1);
		expect(onShow.mock.calls[0]?.[0]).toBe('page-jo');
		expect(bodyOf(onShow.mock.calls[0]?.[1])).toEqual({
			[WHICH_FORM]: 'supporter-page-show',
			page_id: 'page-jo'
		});
	});

	it('sends no second press while the first is out', () => {
		const onShow = vi.fn();
		const { host } = mount({ onShow, presses: { 'page-jo': { pending: true, outcome: null } } });
		act(() => press(host, 'Jo Okafor')?.click());
		expect(onShow).not.toHaveBeenCalled();
	});

	it('says a refusal under its press', () => {
		const { host } = mount({
			presses: {
				'page-jo': {
					pending: false,
					outcome: { refused: 'Couldn’t show this page again. Try again.' }
				}
			}
		});
		expect(row(host, 'Jo Okafor')?.querySelector('[role="alert"]')?.textContent).toBe(
			'Couldn’t show this page again. Try again.'
		);
	});

	it('says “Showing again” at the press once it lands', () => {
		const { host, rerender } = mount();
		rerender({
			pages: [MAYA, { ...JO, hidden: false }, DANA, SAM],
			presses: { 'page-jo': { pending: false, outcome: { landed: 'shown' } } }
		});
		expect(press(host, 'Jo Okafor')?.textContent).toBe('Showing again');
		expect(statusLine(host)).toBe('Showing again');
	});
});

describe('nothing listed', () => {
	it('says no pages yet while the setting is on, and draws no table', () => {
		const { host } = mount({ pages: [] });
		const card = host.querySelector('.ds-state-card');

		expect(host.querySelector('table')).toBeNull();
		expect(card?.querySelector('.ds-state-card-title')?.textContent).toBe('No supporter pages yet');
		expect(card?.querySelector('.ds-state-card-body')?.textContent).toBe(
			'Pages show here as soon as a supporter confirms their email.'
		);
	});

	it('says fundraisers are off, and how to turn them on, while the setting is off', () => {
		const { host } = mount({
			pages: [],
			setting: { enabled: false, mayChange: true, pending: false, saved: false, refused: null }
		});
		const card = host.querySelector('.ds-state-card');

		expect(card?.querySelector('.ds-state-card-title')?.textContent).toBe(
			'Supporter fundraisers are off'
		);
		expect(card?.querySelector('.ds-state-card-body')?.textContent).toBe(
			'Turn them on above to add a Start a fundraiser card to your Donation page.'
		);
	});

	it('tells a member it is off without asking them to turn it on', () => {
		const { host } = mount({
			pages: [],
			setting: { enabled: false, mayChange: false, pending: false, saved: false, refused: null }
		});
		const card = host.querySelector('.ds-state-card');

		expect(card?.querySelector('.ds-state-card-title')?.textContent).toBe(
			'Supporter fundraisers are off'
		);
		expect(card?.querySelector('.ds-state-card-body')).toBeNull();
	});
});

describe('show more pages', () => {
	const PRIYA = page({
		id: 'page-priya',
		supporterName: 'Priya Shah',
		title: 'Run for rent relief'
	});
	const NEW = page({ id: 'page-new', supporterName: 'Lee Park', title: 'Fresh start' });
	const count = (host: HTMLElement) =>
		host.querySelector('.adm-caption[role="status"]')?.textContent ?? null;
	const more = (host: HTMLElement) =>
		[...host.querySelectorAll<HTMLButtonElement>('button')].find(
			(b) => b.textContent === 'Show more pages'
		) ?? null;
	const names = (host: HTMLElement) =>
		[...host.querySelectorAll('tbody tr')].map(
			(tr) => tr.firstElementChild?.firstChild?.textContent
		);
	const showMore = async (host: HTMLElement) => {
		const found = more(host);
		if (found === null) throw new Error('no Show more pages');
		await act(async () => found.click());
	};
	const paged = (over: Partial<SupporterPagesProps> = {}) =>
		mount({ pages: [MAYA, JO], total: 5, next: 'after-jo', ...over });

	it('draws neither the press nor the count where one batch is every page', () => {
		const { host } = mount();
		expect(more(host)).toBeNull();
		expect(count(host)).toBeNull();
	});

	it('stands Show more pages under the table beside how many are shown, the caption counting all', () => {
		const { host } = paged();
		const press = more(host);
		expect(press?.closest('table')).toBeNull();
		expect(press?.className).toContain('ds-btn-sm');
		expect(
			host.querySelector('table')?.compareDocumentPosition(press as Node) ?? 0
		).toBeGreaterThan(0);
		expect(count(host)).toBe('Showing 2 of 5 pages');
		expect(host.querySelector('.adm-tablecaption')?.textContent).toBe(
			'5 supporter pages, newest first.'
		);
	});

	it('loads the next batch after the cursor and appends it, counting against the total it answered', async () => {
		const onShowMore = vi.fn(async () => ({ pages: [DANA, SAM], total: 6, next: 'after-sam' }));
		const { host } = paged({ onShowMore });
		await showMore(host);
		expect(onShowMore).toHaveBeenCalledExactlyOnceWith('after-jo');
		expect(names(host)).toEqual(['Maya Reyes', 'Jo Okafor', 'Dana Whitfield', 'Sam Lee']);
		expect(count(host)).toBe('Showing 4 of 6 pages');
		expect(host.querySelector('.adm-tablecaption')?.textContent).toBe(
			'6 supporter pages, newest first.'
		);
		await showMore(host);
		expect(onShowMore).toHaveBeenLastCalledWith('after-sam');
	});

	it('takes the press away at the last batch and puts focus on the press of the first row it brought', async () => {
		const onShowMore = vi.fn(async () => ({ pages: [DANA, SAM, PRIYA], total: 5, next: null }));
		const { host } = paged({ onShowMore });
		await showMore(host);
		expect(more(host)).toBeNull();
		expect(count(host)).toBe('Showing 5 of 5 pages');
		expect(document.activeElement).toBe(press(host, 'Dana Whitfield'));
	});

	it('keeps the press and the rows when a load fails, says so beside it, and tries again', async () => {
		const onShowMore = vi
			.fn<(after: string) => Promise<SupporterPageBatch | null>>()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ pages: [DANA, SAM, PRIYA], total: 5, next: null });
		const { host } = paged({ onShowMore });
		await showMore(host);
		expect(names(host)).toEqual(['Maya Reyes', 'Jo Okafor']);
		const alert = more(host)?.parentElement?.querySelector('[role="alert"]');
		expect(alert?.textContent).toBe('Couldn’t load more pages. Try again.');
		expect(more(host)?.getAttribute('aria-describedby')).toBe(alert?.id);
		await showMore(host);
		expect(onShowMore).toHaveBeenLastCalledWith('after-jo');
		expect(names(host)).toHaveLength(5);
		expect(host.querySelector('.adm-actions [role="alert"]:empty')).not.toBeNull();
	});

	it('closes the press while a load is out, so a second press asks nothing', async () => {
		let answer: (batch: SupporterPageBatch) => void = () => {};
		const onShowMore = vi.fn(
			() =>
				new Promise<SupporterPageBatch | null>((resolve) => {
					answer = resolve;
				})
		);
		const { host } = paged({ onShowMore });
		await showMore(host);
		expect(more(host)?.getAttribute('aria-disabled')).toBe('true');
		expect(more(host)?.getAttribute('aria-busy')).toBe('true');
		await showMore(host);
		expect(onShowMore).toHaveBeenCalledOnce();
		await act(async () => answer({ pages: [DANA], total: 5, next: 'after-dana' }));
		expect(more(host)?.hasAttribute('aria-disabled')).toBe(false);
	});

	it('keeps the rows and the cursor it brought across the re-read a press brings, each page once', async () => {
		const onShowMore = vi.fn(async () => ({ pages: [DANA, SAM], total: 5, next: 'after-sam' }));
		const { host, rerender } = paged({ onShowMore });
		await showMore(host);
		// the re-read after a press: Maya hidden, and a page started since pushing Jo past the first batch.
		rerender({ pages: [NEW, { ...MAYA, hidden: true }], total: 6, next: 'after-maya' });
		expect(names(host)).toEqual([
			'Lee Park',
			'Maya Reyes',
			'Jo Okafor',
			'Dana Whitfield',
			'Sam Lee'
		]);
		expect(press(host, 'Maya Reyes')?.textContent).toBe('Show again');
		expect(count(host)).toBe('Showing 5 of 6 pages');
		await showMore(host);
		expect(onShowMore).toHaveBeenLastCalledWith('after-sam');
	});

	it('keeps a first-batch row hidden once a later re-read pushes it past the first batch', async () => {
		const shownJo = { ...JO, hidden: false, openHref: JO.address };
		const { host, rerender } = paged({
			pages: [MAYA, shownJo],
			onShowMore: async () => ({ pages: [DANA, SAM], total: 5, next: 'after-sam' })
		});
		await showMore(host);
		act(() => press(host, 'Jo Okafor')?.click());
		act(() => dialogButton('Hide page')?.click());
		rerender({ presses: { 'page-jo': { pending: true, outcome: null } } });
		vi.useFakeTimers();
		rerender({
			pages: [MAYA, JO],
			presses: { 'page-jo': { pending: false, outcome: { landed: 'hidden' } } }
		});
		act(() => vi.advanceTimersByTime(CONFIRMATION_MS));
		// saving the setting re-reads the list, and a page started since pushes Jo out.
		rerender({ pages: [NEW, MAYA], total: 6, next: 'after-maya', presses: {} });
		expect(names(host)).toEqual([
			'Lee Park',
			'Maya Reyes',
			'Jo Okafor',
			'Dana Whitfield',
			'Sam Lee'
		]);
		expect(row(host, 'Jo Okafor')?.textContent).toContain('Hidden');
		expect(press(host, 'Jo Okafor')?.textContent).toBe('Show again');
		expect(row(host, 'Jo Okafor')?.querySelector('a')?.getAttribute('href')).toBe(
			'/admin/supporter-pages/page-jo/preview'
		);
	});

	it('never counts fewer pages than it shows once a re-read answers a higher total', async () => {
		const { host, rerender } = paged({
			total: 4,
			onShowMore: async () => ({ pages: [DANA, SAM], total: 4, next: null })
		});
		await showMore(host);
		expect(count(host)).toBe('Showing 4 of 4 pages');
		rerender({ pages: [NEW, MAYA], total: 5, next: 'after-maya' });
		expect(names(host)).toHaveLength(5);
		expect(count(host)).toBe('Showing 5 of 5 pages');
		expect(host.querySelector('.adm-tablecaption')?.textContent).toBe(
			'5 supporter pages, newest first.'
		);
	});

	it('takes Show again on a row it brought, and draws the row shown once that lands', async () => {
		const onShow = vi.fn();
		const hiddenDana = {
			...DANA,
			hidden: true,
			openHref: '/admin/supporter-pages/page-dana/preview'
		};
		const { host, rerender } = paged({
			onShow,
			onShowMore: async () => ({ pages: [hiddenDana], total: 3, next: null })
		});
		await showMore(host);
		act(() => press(host, 'Dana Whitfield')?.click());
		expect(onShow.mock.calls[0]?.[0]).toBe('page-dana');
		expect(bodyOf(onShow.mock.calls[0]?.[1])).toMatchObject({ page_id: 'page-dana' });
		rerender({ presses: { 'page-dana': { pending: true, outcome: null } } });
		// the re-read reaches only the first batch, so Dana's row is redrawn by the landing.
		rerender({
			pages: [MAYA, JO],
			presses: { 'page-dana': { pending: false, outcome: { landed: 'shown' } } }
		});
		expect(press(host, 'Dana Whitfield')?.textContent).toBe('Showing again');
		expect(statusLine(host)).toBe('Showing again');
		expect(row(host, 'Dana Whitfield')?.textContent).not.toContain('Hidden');
	});

	it('takes Hide on a row it brought through its confirm, which comes down once that lands', async () => {
		const onHide = vi.fn();
		const { host, rerender } = paged({
			onHide,
			onShowMore: async () => ({ pages: [DANA], total: 3, next: null })
		});
		await showMore(host);
		act(() => press(host, 'Dana Whitfield')?.click());
		act(() => dialogButton('Hide page')?.click());
		expect(onHide.mock.calls[0]?.[0]).toBe('page-dana');
		rerender({ presses: { 'page-dana': { pending: true, outcome: null } } });
		rerender({
			pages: [MAYA, JO],
			presses: { 'page-dana': { pending: false, outcome: { landed: 'hidden' } } }
		});
		expect(dialog()).toBeNull();
		expect(press(host, 'Dana Whitfield')?.textContent).toBe('Hidden from visitors');
		expect(row(host, 'Dana Whitfield')?.textContent).toContain('Hidden');
		expect(row(host, 'Dana Whitfield')?.querySelector('a')?.getAttribute('href')).toBe(
			'/admin/supporter-pages/page-dana/preview'
		);
		expect(document.activeElement).toBe(press(host, 'Dana Whitfield'));
	});
});
