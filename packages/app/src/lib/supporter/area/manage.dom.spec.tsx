import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ACCOUNT, button, mountScreen, ORG, one } from './area.testing';
import type { OwnGift } from './gifts';
import { type ManagedPage, ManageFundraiser, type ManageFundraiserProps } from './manage';

// /fundraise/pages/:id: just published, live with gifts, nothing raised, hidden by staff, ended,
// the gifts a supporter may see, and the end confirmation.

const gift = (day: number, amountMinor: number, shown: OwnGift['shown']): OwnGift => ({
	amountMinor,
	receivedAt: `2026-11-${String(day).padStart(2, '0')}T12:00:00.000Z`,
	shown
});

const GIFTS: OwnGift[] = [
	gift(11, 10_000, { name: 'Priya S.', note: 'Matching my coworkers’ gifts this month.' }),
	gift(10, 2_500, null),
	gift(10, 5_000, { name: 'The Okafor family', note: 'From our table to yours.' }),
	gift(9, 2_000, null),
	gift(8, 7_500, { name: 'Tom and Linda H.', note: 'Thank you for what you do.' }),
	gift(7, 3_000, { name: 'Alex M.', note: '' }),
	gift(6, 4_000, null),
	gift(5, 1_000, null)
];

const PAGE: ManagedPage = {
	id: 'p1',
	title: 'Keep the pantry trucks running this winter',
	status: 'live',
	hidden: false,
	hiddenNote: null,
	goalMinor: 500_000,
	raisedMinor: 324_000,
	gifts: 41,
	currency: 'USD',
	endedAt: null,
	address: '/f/keep-the-pantry-trucks-7k2p',
	url: 'https://give.example.org/f/keep-the-pantry-trucks-7k2p',
	giftList: GIFTS
};

const BASE: ManageFundraiserProps = {
	org: ORG,
	account: ACCOUNT,
	page: PAGE,
	orgContactEmail: 'hello@harborlight.example',
	justPublished: false,
	backHref: '/fundraise/pages',
	editHref: '/fundraise/pages/p1/edit',
	endRefused: false,
	ending: false
};

const manage = (props: Partial<ManageFundraiserProps> = {}, page: Partial<ManagedPage> = {}) =>
	mountScreen(() => <ManageFundraiser {...BASE} {...props} page={{ ...PAGE, ...page }} />);

const headings = (root: HTMLElement) =>
	[...root.querySelectorAll('main h2')].map((heading) => heading.textContent);

describe('a live page', () => {
	it('heads with its title, state, address, View page and Edit page', () => {
		const { root } = manage();
		expect(one(root, 'h1').textContent).toBe(PAGE.title);
		expect(one(root, 'main > .sa-head .ds-badge').textContent).toBe('Live');
		expect(one(root, 'main > .sa-head .sa-address').textContent).toBe(PAGE.address);
		const presses = [...root.querySelectorAll('main > .sa-head a')].map((a) => a.textContent);
		expect(presses).toEqual(['View page', 'Edit page']);
		expect(one(root, 'a.sa-back').getAttribute('href')).toBe('/fundraise/pages');
	});

	it('stands its sections in the order a phone reads them: total, share, gifts, end', () => {
		expect(headings(manage().root)).toEqual([
			'Raised so far',
			'Share your page',
			'Gifts',
			'End this fundraiser'
		]);
	});

	it('says the total against the goal', () => {
		const { root } = manage();
		const total = one(root, '.sa-raised');
		expect(total.textContent).toContain('$3,240');
		expect(total.textContent).toContain('of $5,000 goal · 41 gifts');
		expect(one(total, '.ds-progress-track').dataset.state).toBeUndefined();
	});

	it('offers the link to copy and the three channels', () => {
		const { root } = manage();
		const share = one(root, '.sa-share');
		expect(one<HTMLInputElement>(share, 'input').readOnly).toBe(true);
		expect(one<HTMLInputElement>(share, 'input').value).toBe(PAGE.url);
		expect([...share.querySelectorAll('a')].map((a) => a.textContent)).toEqual([
			'Email',
			'Facebook',
			'WhatsApp'
		]);
	});

	it('copies the link and says so where it can be seen and heard', async () => {
		const writeText = vi.fn(async () => {});
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
		const { root } = manage();
		const press = button(one(root, '.sa-share'), 'Copy link');
		await act(async () => press.click());
		expect(writeText).toHaveBeenCalledWith(PAGE.url);
		expect(press.textContent).toBe('Copied');
		expect(one(one(root, '.sa-share'), '[role="status"]').textContent).toBe('Copied');
	});

	it('leads with no notice', () => {
		expect(manage().root.querySelector('.ds-notice-card')).toBeNull();
	});
});

describe('just published', () => {
	it('leads with the success notice and its one primary, Copy link', () => {
		const { root } = manage({ justPublished: true });
		const notice = one(root, '.ds-notice-card');
		expect(notice.className).toContain('ds-notice-card-success');
		expect(one(notice, 'h2').textContent).toBe('Your page is live');
		expect(one(notice, '.ds-notice-card-actions button').className).toBe('ds-btn ds-btn-primary');
		expect(one(notice, '.ds-notice-card-actions button').textContent).toBe('Copy link');
	});
});

describe('the gifts', () => {
	it('lists them in the registry’s table, the donor pinned as the row header', () => {
		const { root } = manage();
		const frame = one(root, '.ds-table-scroll');
		expect(frame.tagName).toBe('SECTION');
		expect(frame.getAttribute('aria-label')).toBe('Gifts to your fundraiser');
		expect(frame.tabIndex).toBe(0);
		expect([...frame.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
			'From',
			'Date',
			'Amount',
			'Note'
		]);
		const first = one(frame, 'tbody tr');
		expect(one(first, 'th').getAttribute('scope')).toBe('row');
		expect([...first.children].map((cell) => cell.textContent)).toEqual([
			'Priya S.',
			'Nov 11',
			'$100.00',
			'Matching my coworkers’ gifts this month.'
		]);
	});

	it('reads a gift whose donor showed nothing as A donor, with no note', () => {
		const row = manage().root.querySelectorAll('tbody tr')[1] as HTMLElement;
		expect([...row.children].map((cell) => cell.textContent)).toEqual([
			'A donor',
			'Nov 10',
			'$25.00',
			'—'
		]);
	});

	it('draws nothing of a gift beyond its amount, its day and what was shown', () => {
		const leaky = {
			...gift(4, 1_500, null),
			email: 'donor@example.com',
			address: '12 Harbour Road',
			paymentMethod: 'Visa ending 4242',
			name: 'Jordan Private',
			note: 'a private note'
		} as OwnGift;
		const { root } = manage({}, { giftList: [leaky], gifts: 1 });
		const text = one(root, '.sa-gifts').textContent ?? '';
		for (const secret of [
			'donor@example.com',
			'12 Harbour Road',
			'Visa',
			'4242',
			'Jordan Private',
			'a private note'
		]) {
			expect(text).not.toContain(secret);
		}
		expect(one(root, 'tbody th').textContent).toBe('A donor');
	});

	it('opens on six, and Show more gifts shows the rest of what was read', () => {
		const { root } = manage();
		expect(root.querySelectorAll('tbody tr')).toHaveLength(6);
		expect(one(root, '.sa-gifts [role="status"]').textContent).toBe('Showing 6 of 41 gifts');
		const more = button(root, 'Show more gifts');
		expect(more.closest('tfoot')).not.toBeNull();
		act(() => more.click());
		expect(root.querySelectorAll('tbody tr')).toHaveLength(8);
		expect(one(root, '.sa-gifts [role="status"]').textContent).toBe('Showing 8 of 41 gifts');
		expect(root.querySelector('tfoot')).toBeNull();
		expect(document.activeElement).toBe(root.querySelectorAll('tbody th')[6]);
	});
});

describe('nothing raised yet', () => {
	it('empties the bar and stands the state card where the table would be', () => {
		const { root } = manage({}, { raisedMinor: 0, gifts: 0, giftList: [] });
		expect(one(root, '.ds-progress-track').dataset.state).toBe('empty');
		expect(one(root, '.sa-raised').textContent).toContain('of $5,000 goal · no gifts yet');
		expect(root.querySelector('table')).toBeNull();
		expect(one(root, '.sa-gifts .ds-state-card-title').textContent).toBe('No gifts yet');
	});
});

describe('hidden by staff', () => {
	const hidden = () =>
		manage({}, { hidden: true, hiddenNote: 'Please replace the photo. It shows a child.' });

	it('names who hid it and passes the note on word for word', () => {
		const notice = one(hidden().root, '.ds-notice-card');
		expect(notice.className).toContain('ds-notice-card-warning');
		expect(one(notice, 'h2').textContent).toBe('Harbor Light has hidden this page');
		expect(notice.textContent).toContain(
			'Harbor Light’s note: “Please replace the photo. It shows a child.”'
		);
		expect(one(notice, 'a').getAttribute('href')).toBe('mailto:hello@harborlight.example');
	});

	it('drops Share and View page and keeps Edit and End', () => {
		const { root } = hidden();
		expect(root.querySelector('.sa-share')).toBeNull();
		expect([...root.querySelectorAll('main > .sa-head a')].map((a) => a.textContent)).toEqual([
			'Edit page'
		]);
		expect(root.querySelector('.sa-end')).not.toBeNull();
		expect(one(root, 'main > .sa-head .ds-badge').textContent).toBe('Hidden by Harbor Light');
	});

	it('says nothing of a note staff did not write', () => {
		const notice = one(manage({}, { hidden: true }).root, '.ds-notice-card');
		expect(notice.textContent).not.toContain('note');
	});
});

describe('ended', () => {
	const ended = () =>
		manage(
			{},
			{
				status: 'ended',
				endedAt: '2026-11-20T18:00:00.000Z',
				raisedMinor: 115_000,
				goalMinor: 100_000,
				gifts: 23
			}
		);

	it('says it has ended with the final figure', () => {
		const notice = one(ended().root, '.ds-notice-card');
		expect(notice.className).toContain('ds-notice-card-info');
		expect(one(notice, 'h2').textContent).toBe('This fundraiser has ended');
		expect(notice.textContent).toContain(
			'You ended it on Nov 20, 2026. Your page still shows the final total, $1,150 from 23 gifts.'
		);
	});

	it('keeps Share and View page and drops Edit and End', () => {
		const { root } = ended();
		expect([...root.querySelectorAll('main > .sa-head a')].map((a) => a.textContent)).toEqual([
			'View page'
		]);
		expect(root.querySelector('.sa-share')).not.toBeNull();
		expect(root.querySelector('.sa-end')).toBeNull();
		expect(one(root, '.sa-raised h2').textContent).toBe('Final total');
	});
});

describe('ending a page', () => {
	const open = (props: Partial<ManageFundraiserProps> = {}) => {
		const mounted = manage(props);
		const opener = button(one(mounted.root, '.sa-end'), 'End fundraiser');
		expect(opener.className).toBe('ds-btn ds-btn-destructive-outline');
		act(() => {
			opener.focus();
			opener.click();
		});
		return { ...mounted, opener, dialog: one<HTMLDialogElement>(mounted.root, 'dialog') };
	};

	it('asks first, in an alertdialog with Cancel under the keyboard', () => {
		const { dialog } = open();
		expect(dialog.open).toBe(true);
		expect(dialog.getAttribute('role')).toBe('alertdialog');
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
			'End this fundraiser?'
		);
		expect(one(dialog, '.sa-quote').textContent).toBe(`${PAGE.title}$3,240 from 41 gifts`);
		expect(document.activeElement).toBe(button(dialog, 'Cancel'));
		expect(button(dialog, 'End fundraiser').className).toBe('ds-btn ds-btn-destructive');
	});

	it('closes on Escape and hands focus back to the press that opened it', () => {
		const { root, opener, dialog } = open();
		act(() => {
			dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
		});
		expect(root.querySelector('dialog')).toBeNull();
		expect(document.activeElement).toBe(opener);
	});

	it('closes on Cancel with nothing sent', () => {
		const { root, posted, dialog } = open();
		act(() => button(dialog, 'Cancel').click());
		expect(root.querySelector('dialog')).toBeNull();
		expect(posted).toHaveLength(0);
	});

	it('posts the end', async () => {
		const { posted, dialog } = open();
		await act(async () => {
			one<HTMLFormElement>(dialog, 'form').requestSubmit(button(dialog, 'End fundraiser'));
		});
		expect(posted[0]?.get('intent')).toBe('end');
	});

	it('keeps a refusal inside the card, which stays up', () => {
		const { dialog } = open({ endRefused: true });
		const said = one(dialog, '[role="alert"]');
		expect(said.textContent).toBe('Couldn’t end it. Try again.');
		expect(dialog.open).toBe(true);
	});

	it('marks the press busy while the end is in flight', () => {
		const { dialog } = open({ ending: true });
		expect(button(dialog, 'End fundraiser').getAttribute('aria-busy')).toBe('true');
	});
});
