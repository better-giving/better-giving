import { act, useState } from 'react';
import { useActionData } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ACCOUNT, button, mountScreen, ORG, one, submitTwice } from './area.testing';
import type { GiftBatch, OwnGift } from './gifts';
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
	publishedAt: '2026-11-01T18:00:00.000Z',
	address: '/f/keep-the-pantry-trucks-7k2p',
	url: 'https://give.example.org/f/keep-the-pantry-trucks-7k2p',
	giftList: GIFTS,
	giftTotal: 41,
	giftNext: 'after-gift-8'
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
	ending: false,
	onShowMoreGifts: async () => null
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

	it('shows the address as text beside Copy link, for copying by hand', () => {
		const { root } = manage({ justPublished: true });
		expect(one(one(root, '.ds-notice-card'), '.sa-address').textContent).toBe(PAGE.url);
	});

	it('says on Copy link itself when the copy fails', async () => {
		vi.stubGlobal('navigator', {
			clipboard: { writeText: () => Promise.reject(new Error('denied')) }
		});
		const { root } = manage({ justPublished: true });
		const press = one<HTMLButtonElement>(root, '.ds-notice-card-actions button');
		await act(async () => press.click());
		expect(press.textContent).toBe('Couldn’t copy');
		expect(one(one(root, '.ds-notice-card'), '[role="status"]').textContent).toBe(
			'Couldn’t copy the link. Select the address and copy it.'
		);
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

	it('reads a gift whose donor showed nothing as A donor, with a dash for the note', () => {
		const row = manage().root.querySelectorAll('tbody tr')[1] as HTMLElement;
		expect([...row.children].map((cell) => cell.textContent)).toEqual([
			'A donor',
			'Nov 10',
			'$25.00',
			'—'
		]);
	});

	it('gives each day its year where the gifts run across two', () => {
		const { root } = manage(
			{},
			{
				giftList: [
					{ ...gift(1, 2_000, null), receivedAt: '2027-01-02T12:00:00.000Z' },
					{ ...gift(1, 2_000, null), receivedAt: '2026-12-30T12:00:00.000Z' }
				],
				gifts: 2
			}
		);
		expect(
			[...root.querySelectorAll('tbody tr')].map((row) => row.children[1]?.textContent)
		).toEqual(['Jan 2, 2027', 'Dec 30, 2026']);
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

	it('stands Show more gifts under the table, out of its pinned column, beside the count', () => {
		const { root } = manage();
		const more = button(root, 'Show more gifts');
		expect(more.closest('table')).toBeNull();
		expect(more.className).toBe('ds-btn ds-btn-secondary ds-btn-sm');
		const frame = one(root, '.ds-table-scroll');
		expect(frame.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(more.parentElement).toBe(one(root, '.sa-gifts [role="status"]').parentElement);
	});
});

describe('show more gifts', () => {
	const count = (root: HTMLElement) => one(root, '.sa-gifts [role="status"]').textContent;
	const failure = (root: HTMLElement) => one(root, '.sa-gifts [role="alert"]').textContent;
	const more = (root: HTMLElement) =>
		[...root.querySelectorAll<HTMLButtonElement>('.sa-gifts button')].find(
			(b) => b.textContent === 'Show more gifts'
		) ?? null;
	const press = async (root: HTMLElement) => {
		const found = more(root);
		if (found === null) throw new Error('no Show more gifts');
		await act(async () => found.click());
	};
	const older = (n: number, from = 1): OwnGift[] =>
		Array.from({ length: n }, (_, i) =>
			gift(4, 1_000 + i, { name: `Older donor ${from + i}`, note: '' })
		);

	it('opens on six, then shows the rest of the first batch before asking for another', async () => {
		const onShowMoreGifts = vi.fn(async () => null);
		const { root } = manage({ onShowMoreGifts });
		expect(root.querySelectorAll('tbody tr')).toHaveLength(6);
		expect(count(root)).toBe('Showing 6 of 41 gifts');
		await press(root);
		expect(root.querySelectorAll('tbody tr')).toHaveLength(8);
		expect(count(root)).toBe('Showing 8 of 41 gifts');
		expect(more(root)).not.toBeNull();
		expect(onShowMoreGifts).not.toHaveBeenCalled();
	});

	it('loads the next batch once the first runs out, appends it and shows six more of it', async () => {
		const onShowMoreGifts = vi.fn(async () => ({
			gifts: older(10),
			total: 41,
			next: 'after-gift-18'
		}));
		const { root } = manage({ onShowMoreGifts });
		await press(root);
		await press(root);
		expect(onShowMoreGifts).toHaveBeenCalledExactlyOnceWith('after-gift-8');
		const names = [...root.querySelectorAll('tbody th')].map((th) => th.textContent);
		expect(names).toHaveLength(14);
		expect(names.slice(0, 8)).toEqual(GIFTS.map((g) => g.shown?.name ?? 'A donor'));
		expect(names.slice(8)).toEqual(older(6).map((g) => g.shown?.name));
		expect(count(root)).toBe('Showing 14 of 41 gifts');
		// the batch still holds four, so the next press shows them without asking.
		await press(root);
		expect(root.querySelectorAll('tbody tr')).toHaveLength(18);
		expect(onShowMoreGifts).toHaveBeenCalledOnce();
		await press(root);
		expect(onShowMoreGifts).toHaveBeenLastCalledWith('after-gift-18');
	});

	it('counts against the total the latest batch answered, a gift landing between loads with it', async () => {
		const onShowMoreGifts = vi.fn(async () => ({ gifts: older(10), total: 42, next: 'next' }));
		const { root } = manage({ onShowMoreGifts });
		await press(root);
		await press(root);
		expect(count(root)).toBe('Showing 14 of 42 gifts');
	});

	it('takes the press away once every gift is shown, and puts focus on the first gift the last press added', async () => {
		const onShowMoreGifts = vi.fn(async () => ({ gifts: older(3), total: 11, next: null }));
		const { root } = manage({ onShowMoreGifts });
		await press(root);
		expect(document.activeElement).not.toBe(root.querySelectorAll('tbody th')[8]);
		await press(root);
		expect(root.querySelectorAll('tbody tr')).toHaveLength(11);
		expect(count(root)).toBe('Showing 11 of 11 gifts');
		expect(more(root)).toBeNull();
		expect(document.activeElement).toBe(root.querySelectorAll('tbody th')[8]);
	});

	it('takes the press away within the first batch where it is every gift', async () => {
		const onShowMoreGifts = vi.fn(async () => null);
		const { root } = manage({ onShowMoreGifts }, { giftTotal: 8, giftNext: null });
		await press(root);
		expect(count(root)).toBe('Showing 8 of 8 gifts');
		expect(more(root)).toBeNull();
		expect(document.activeElement).toBe(root.querySelectorAll('tbody th')[6]);
		expect(onShowMoreGifts).not.toHaveBeenCalled();
	});

	it('draws no press at all for six gifts or fewer in one batch', () => {
		const { root } = manage({}, { giftList: GIFTS.slice(0, 5), giftTotal: 5, giftNext: null });
		expect(count(root)).toBe('Showing 5 of 5 gifts');
		expect(more(root)).toBeNull();
	});

	it('starts a second page of the same supporter over, not on the first page’s loaded gifts', async () => {
		const other: ManagedPage = {
			...PAGE,
			id: 'p2',
			title: 'The second run',
			giftList: [gift(3, 9_900, { name: 'Second page donor', note: '' })],
			giftTotal: 12,
			giftNext: 'after-p2'
		};
		const onShowMoreGifts = vi.fn(async () => ({ gifts: older(10), total: 41, next: 'more' }));
		function Screens() {
			const [current, setCurrent] = useState(PAGE);
			return (
				<>
					<button type="button" onClick={() => setCurrent(other)}>
						Go to the second page
					</button>
					<ManageFundraiser {...BASE} onShowMoreGifts={onShowMoreGifts} page={current} />
				</>
			);
		}
		const { root } = mountScreen(() => <Screens />);
		await press(root);
		await press(root);
		expect(root.querySelectorAll('tbody tr')).toHaveLength(14);

		await act(async () => button(root, 'Go to the second page').click());

		expect([...root.querySelectorAll('tbody th')].map((th) => th.textContent)).toEqual([
			'Second page donor'
		]);
		expect(count(root)).toBe('Showing 1 of 12 gifts');
		await press(root);
		expect(onShowMoreGifts).toHaveBeenLastCalledWith('after-p2');
	});

	it('keeps the press and the rows when a load fails, says so beside the press, and tries again', async () => {
		const onShowMoreGifts = vi
			.fn<(after: string) => Promise<GiftBatch | null>>()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ gifts: older(2), total: 10, next: null });
		const { root } = manage({ onShowMoreGifts });
		await press(root);
		expect(failure(root)).toBe('');
		await press(root);
		expect(root.querySelectorAll('tbody tr')).toHaveLength(8);
		expect(count(root)).toBe('Showing 8 of 41 gifts');
		expect(failure(root)).toBe('Couldn’t load more gifts. Try again.');
		const again = more(root);
		expect(again?.getAttribute('aria-describedby')).toBe(one(root, '.sa-gifts [role="alert"]').id);
		expect(again?.parentElement).toBe(one(root, '.sa-gifts [role="alert"]').parentElement);
		await press(root);
		expect(onShowMoreGifts).toHaveBeenLastCalledWith('after-gift-8');
		expect(failure(root)).toBe('');
		expect(root.querySelectorAll('tbody tr')).toHaveLength(10);
	});

	it('closes the press while a load is out, so a second press asks nothing', async () => {
		let answer: (batch: GiftBatch) => void = () => {};
		const onShowMoreGifts = vi.fn(
			() =>
				new Promise<GiftBatch | null>((resolve) => {
					answer = resolve;
				})
		);
		const { root } = manage({ onShowMoreGifts });
		await press(root);
		await press(root);
		const out = more(root);
		expect(out?.getAttribute('aria-disabled')).toBe('true');
		expect(out?.getAttribute('aria-busy')).toBe('true');
		expect(out?.disabled).toBe(false);
		await press(root);
		expect(onShowMoreGifts).toHaveBeenCalledOnce();
		await act(async () => answer({ gifts: older(2), total: 41, next: 'more' }));
		expect(more(root)?.hasAttribute('aria-disabled')).toBe(false);
		expect(root.querySelectorAll('tbody tr')).toHaveLength(10);
	});
});

describe('nothing raised yet', () => {
	it('empties the bar and stands the state card where the table would be', () => {
		const { root } = manage(
			{},
			{ raisedMinor: 0, gifts: 0, giftList: [], giftTotal: 0, giftNext: null }
		);
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
		expect(
			[...one(root, '.sa-share').querySelectorAll('a.ds-btn-sm')].map((a) => a.textContent)
		).toEqual(['Email', 'Facebook', 'WhatsApp']);
		expect(root.querySelector('.sa-end')).toBeNull();
		expect(one(root, '.sa-raised h2').textContent).toBe('Final total');
	});

	it('drops Share and View page for a page ended before it was ever published', () => {
		const { root } = manage(
			{},
			{ status: 'ended', endedAt: '2026-11-20T18:00:00.000Z', publishedAt: null }
		);
		expect(root.querySelector('.sa-share')).toBeNull();
		expect([...root.querySelectorAll('main > .sa-head a')].map((a) => a.textContent)).toEqual([]);
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

	it('hands focus back to End fundraiser where the press that opened the card took none', () => {
		// safari, and firefox on macos, leave a pressed button unfocused.
		const { root } = manage();
		const opener = button(one(root, '.sa-end'), 'End fundraiser');
		(document.activeElement as HTMLElement | null)?.blur();
		act(() => opener.click());
		act(() => button(one(root, 'dialog'), 'Cancel').click());
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

	it('posts once on a double press of End fundraiser', async () => {
		const { posted, dialog } = open();
		await submitTwice(one<HTMLFormElement>(dialog, 'form'));
		expect(posted).toHaveLength(1);
	});

	it('moves focus to the ended notice once the end lands', async () => {
		const { root } = mountScreen(
			function Answered() {
				const ended = useActionData<boolean>() === true;
				const page: ManagedPage = ended
					? { ...PAGE, status: 'ended', endedAt: '2026-11-20T18:00:00.000Z' }
					: PAGE;
				return <ManageFundraiser {...BASE} page={page} />;
			},
			() => true
		);
		const opener = button(one(root, '.sa-end'), 'End fundraiser');
		act(() => {
			opener.focus();
			opener.click();
		});
		const dialog = one<HTMLDialogElement>(root, 'dialog');
		await act(async () => {
			one<HTMLFormElement>(dialog, 'form').requestSubmit(button(dialog, 'End fundraiser'));
		});
		expect(root.querySelector('dialog')).toBeNull();
		const notice = one(root, '.ds-notice-card');
		expect(one(notice, 'h2').textContent).toBe('This fundraiser has ended');
		expect(document.activeElement).toBe(notice);
	});

	it('marks the press busy while the end is in flight', () => {
		const { dialog } = open({ ending: true });
		expect(button(dialog, 'End fundraiser').getAttribute('aria-busy')).toBe('true');
	});
});
