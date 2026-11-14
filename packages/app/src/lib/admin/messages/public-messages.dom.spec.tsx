import { CONFIRMATION_MS } from '@better-giving/operator/save-state';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { type ModeratedMessage, PublicMessages, type PublicMessagesProps } from './public-messages';

// Public messages, mounted over the route's read and its answers: the empty sentence, shown and
// hidden rows, Hide through its confirm, Show again straight off, the moment a landed press says
// what happened, and a refusal in the confirm and under a press.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MAYA: ModeratedMessage = {
	id: 'gift-maya',
	name: 'Maya R.',
	note: 'Paying it forward.',
	receivedAt: '2026-11-08T15:00:00.000Z',
	hidden: false
};
const DEV: ModeratedMessage = {
	id: 'gift-dev',
	name: 'Dev P.',
	note: 'Great work! Visit cheap-watches.example for deals.',
	receivedAt: '2026-10-29T15:00:00.000Z',
	hidden: true
};

function mount(over: Partial<PublicMessagesProps> = {}) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	const props: PublicMessagesProps = {
		messages: [MAYA, DEV],
		total: 2,
		pending: null,
		outcome: null,
		onHide: () => {},
		onShow: () => {},
		...over
	};
	act(() => root.render(<PublicMessages {...props} />));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return {
		host,
		rerender: (next: Partial<PublicMessagesProps>) => {
			Object.assign(props, next);
			act(() => root.render(<PublicMessages {...props} />));
		}
	};
}

const row = (host: HTMLElement, name: string) =>
	[...host.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(name)) ?? null;
const press = (host: HTMLElement, name: string) =>
	row(host, name)?.querySelector<HTMLButtonElement>('button') ?? null;
// the name a press is read by: its `aria-labelledby` nodes' text, the press's own included, as
// https://www.w3.org/TR/accname-1.2/#step2B joins them.
const nameOf = (button: HTMLElement | null) =>
	(button?.getAttribute('aria-labelledby') ?? '')
		.split(' ')
		.filter(Boolean)
		.map((id) => document.getElementById(id)?.textContent ?? '')
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
const dayOf = (host: HTMLElement, name: string) =>
	row(host, name)?.querySelector('time')?.textContent;
const dialog = () => document.querySelector('dialog');
const dialogButton = (label: string) =>
	[...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === label) ?? null;

afterEach(() => {
	vi.useRealTimers();
});

describe('public messages, listed', () => {
	it('says one sentence and draws no table with none', () => {
		const { host } = mount({ messages: [], total: 0 });
		expect(host.querySelector('h1')?.textContent).toBe('Public messages');
		expect(host.querySelector('table')).toBeNull();
		expect(host.querySelector('.adm-empty')?.textContent).toBe(
			'No donor has chosen to show a note yet. A note appears here when a donor ticks Show my note on the gift form.'
		);
	});

	it('counts the messages under the header and its standfirst', () => {
		const { host } = mount();
		expect(host.querySelector('.adm-standfirst')?.textContent).toContain(
			'Notes donors chose to show on your donation page.'
		);
		expect(host.querySelector('.adm-tablecaption')?.textContent).toBe('2 messages, newest first.');
		expect([...host.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
			'Date',
			'Shown as',
			'Message',
			'On the page',
			'Action'
		]);
	});

	it('says the list is capped where more are listed than it holds', () => {
		const { host } = mount({ total: 612 });
		expect(host.querySelector('.adm-tablecaption')?.textContent).toBe(
			'612 messages, newest first. Only the most recent 2 are shown.'
		);
	});

	it('draws a shown row with its word on a ground and a Hide press that names it', () => {
		const { host } = mount();
		const shown = row(host, 'Maya R.');
		expect(shown?.querySelector('.ds-badge')?.textContent).toBe('On the page');
		expect(shown?.querySelector('.adm-cell__quiet')).toBeNull();
		const hide = press(host, 'Maya R.');
		expect(hide?.textContent).toBe('Hide');
		expect(dayOf(host, 'Maya R.')).toBeTruthy();
		expect(nameOf(hide)).toBe(`Hide the message from Maya R. received ${dayOf(host, 'Maya R.')}`);
		expect(hide?.getAttribute('aria-haspopup')).toBe('dialog');
	});

	it('draws a hidden row in the quiet ink, its word without a ground, and a Show again press', () => {
		const { host } = mount();
		const hidden = row(host, 'Dev P.');
		expect(hidden?.querySelector('.ds-badge.ds-badge-outline')?.textContent).toBe('Hidden');
		expect(
			[...(hidden?.querySelectorAll('.adm-cell__quiet') ?? [])].map((q) => q.textContent)
		).toEqual(['Dev P.', DEV.note]);
		const show = press(host, 'Dev P.');
		expect(show?.textContent).toBe('Show again');
		expect(nameOf(show)).toBe(
			`Show again the message from Dev P. received ${dayOf(host, 'Dev P.')}`
		);
		expect(show?.hasAttribute('aria-haspopup')).toBe(false);
	});

	it('names apart the presses of two rows shown as the same name, by their day', () => {
		const first = { ...MAYA, id: 'gift-a', name: 'Anonymous' };
		const second = { ...DEV, id: 'gift-b', name: 'Anonymous', hidden: false };
		const { host } = mount({ messages: [first, second] });
		const names = [...host.querySelectorAll<HTMLButtonElement>('tbody button')].map(nameOf);
		expect(names).toHaveLength(2);
		expect(names[0]).toMatch(/^Hide the message from Anonymous received \S/);
		expect(names[0]).not.toBe(names[1]);
	});

	it('keeps the rows in the order they were read, hidden ones included', () => {
		const { host } = mount({ messages: [DEV, MAYA] });
		expect(
			[...host.querySelectorAll('tbody tr')].map((tr) => tr.querySelectorAll('td')[0]?.textContent)
		).toEqual(['Dev P.', 'Maya R.']);
	});
});

describe('hiding a message', () => {
	it('asks first, in an alert dialog quoting the message, with focus on Cancel', () => {
		const onHide = vi.fn();
		const { host } = mount({ onHide });
		const hide = press(host, 'Maya R.');
		hide?.focus();
		act(() => hide?.click());
		expect(onHide).not.toHaveBeenCalled();
		expect(dialog()?.getAttribute('role')).toBe('alertdialog');
		expect(dialog()?.querySelector('h2')?.textContent).toBe('Hide this message?');
		expect(dialog()?.querySelector('.adm-quote')?.textContent).toContain('Paying it forward.');
		expect(dialog()?.querySelector('.adm-quote__by')?.textContent).toContain('Shown as Maya R. ·');
		expect(dialog()?.textContent).toContain('It stops showing on your donation page right away.');
		expect(document.activeElement).toBe(dialogButton('Cancel'));
	});

	it('hides on Hide message', () => {
		const onHide = vi.fn();
		const { host } = mount({ onHide });
		act(() => press(host, 'Maya R.')?.click());
		act(() => dialogButton('Hide message')?.click());
		expect(onHide).toHaveBeenCalledExactlyOnceWith('gift-maya');
	});

	it('cancels on Escape, and focus goes back to the row’s press', () => {
		const onHide = vi.fn();
		const { host } = mount({ onHide });
		const hide = press(host, 'Maya R.');
		hide?.focus();
		act(() => hide?.click());
		act(() => {
			dialog()?.dispatchEvent(new Event('cancel', { cancelable: true }));
		});
		expect(dialog()).toBeNull();
		expect(onHide).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(hide);
	});

	it('holds Hide message busy while the press is out', () => {
		const onHide = vi.fn();
		const { host, rerender } = mount({ onHide });
		act(() => press(host, 'Maya R.')?.click());
		act(() => dialogButton('Hide message')?.click());
		rerender({ pending: { donationId: MAYA.id } });
		const commit = dialogButton('Hide message');
		expect(commit?.getAttribute('aria-busy')).toBe('true');
		act(() => commit?.click());
		expect(onHide).toHaveBeenCalledOnce();
	});

	it('says a refusal inside the dialog, which stays open', () => {
		const { host, rerender } = mount();
		act(() => press(host, 'Maya R.')?.click());
		act(() => dialogButton('Hide message')?.click());
		rerender({ pending: { donationId: MAYA.id } });
		rerender({
			pending: null,
			outcome: { donationId: MAYA.id, refused: 'Couldn’t hide this message. Try again.' }
		});
		const refusal = dialog()?.querySelector('[role="alert"]');
		expect(refusal?.textContent).toBe('Couldn’t hide this message. Try again.');
		expect(dialogButton('Hide message')?.getAttribute('aria-describedby')).toBe(refusal?.id);
		expect(row(host, 'Maya R.')?.querySelector('[role="alert"]')?.textContent).toBe('');
		// in the confirm's own ink rather than the attention hue: the circle-alert mark says it.
		expect(refusal?.classList.contains('adm-dialog__refusal--ink')).toBe(true);
	});

	it('says no refusal from an earlier press in a confirm opened after it', () => {
		const { host, rerender } = mount();
		rerender({
			outcome: { donationId: MAYA.id, refused: 'Couldn’t hide this message. Try again.' }
		});
		act(() => press(host, 'Maya R.')?.click());
		expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe('');
	});

	it('closes on landing, says so at the press for a moment, then turns it into Show again', () => {
		vi.useFakeTimers();
		const { host, rerender } = mount();
		const hide = press(host, 'Maya R.');
		hide?.focus();
		act(() => hide?.click());
		act(() => dialogButton('Hide message')?.click());
		rerender({ pending: { donationId: MAYA.id } });
		rerender({
			pending: null,
			messages: [{ ...MAYA, hidden: true }, DEV],
			outcome: { donationId: MAYA.id, landed: 'hidden' }
		});
		expect(dialog()).toBeNull();
		expect(press(host, 'Maya R.')).toBe(hide);
		expect(document.activeElement).toBe(hide);
		expect(hide?.textContent).toBe('Hidden from your page');
		expect(nameOf(hide)).toBe(
			`Hidden from your page the message from Maya R. received ${dayOf(host, 'Maya R.')}`
		);
		expect(hide?.getAttribute('aria-disabled')).toBe('true');
		expect(host.querySelector('p[role="status"]')?.textContent).toBe('Hidden from your page');
		act(() => vi.advanceTimersByTime(CONFIRMATION_MS));
		expect(hide?.textContent).toBe('Show again');
		expect(nameOf(hide)).toBe(
			`Show again the message from Maya R. received ${dayOf(host, 'Maya R.')}`
		);
		expect(document.activeElement).toBe(hide);
		expect(host.querySelector('p[role="status"]')?.textContent).toBe('');
	});
});

describe('showing a message again', () => {
	it('asks nothing and shows it straight off', () => {
		const onShow = vi.fn();
		const { host } = mount({ onShow });
		act(() => press(host, 'Dev P.')?.click());
		expect(dialog()).toBeNull();
		expect(onShow).toHaveBeenCalledExactlyOnceWith('gift-dev');
	});

	it('holds the press busy while it is out, and says the landing there', () => {
		const onShow = vi.fn();
		const { host, rerender } = mount({ onShow });
		const show = press(host, 'Dev P.');
		show?.focus();
		act(() => show?.click());
		rerender({ pending: { donationId: DEV.id } });
		expect(show?.getAttribute('aria-busy')).toBe('true');
		act(() => show?.click());
		expect(onShow).toHaveBeenCalledOnce();
		rerender({
			pending: null,
			messages: [MAYA, { ...DEV, hidden: false }],
			outcome: { donationId: DEV.id, landed: 'shown' }
		});
		expect(show?.textContent).toBe('Showing again');
		expect(document.activeElement).toBe(show);
		expect(row(host, 'Dev P.')?.querySelector('.ds-badge')?.textContent).toBe('On the page');
	});

	it('says a refusal under the press, which stays to try again', () => {
		const { host, rerender } = mount();
		// there before it speaks, so the refusal is announced as it arrives.
		const region = row(host, 'Dev P.')?.querySelector('[role="alert"]');
		expect(region?.textContent).toBe('');
		act(() => press(host, 'Dev P.')?.click());
		rerender({ pending: { donationId: DEV.id } });
		rerender({
			pending: null,
			outcome: { donationId: DEV.id, refused: 'Couldn’t show this message again. Try again.' }
		});
		const refusal = row(host, 'Dev P.')?.querySelector('[role="alert"]');
		expect(refusal).toBe(region);
		expect(refusal?.textContent).toBe('Couldn’t show this message again. Try again.');
		expect(press(host, 'Dev P.')?.getAttribute('aria-describedby')).toBe(refusal?.id);
		expect(press(host, 'Dev P.')?.hasAttribute('aria-disabled')).toBe(false);
	});
});

describe('the words a landed press says, through the per-row presses the route hands down', () => {
	const statusLine = (host: HTMLElement) => host.querySelector('p[role="status"]')?.textContent;

	it('says “Hidden from your page” after Hide, in the status line and on the press, for the confirmation time', () => {
		vi.useFakeTimers();
		const { host, rerender } = mount({ presses: {} });
		const hide = press(host, 'Maya R.');
		act(() => hide?.click());
		act(() => dialogButton('Hide message')?.click());
		rerender({ presses: { [MAYA.id]: { pending: true, outcome: null } } });
		rerender({
			messages: [{ ...MAYA, hidden: true }, DEV],
			presses: {
				[MAYA.id]: { pending: false, outcome: { donationId: MAYA.id, landed: 'hidden' } }
			}
		});
		expect(hide?.textContent).toBe('Hidden from your page');
		expect(statusLine(host)).toBe('Hidden from your page');
		// the words drawn as words on one line, not as a closed press's fill, and focus kept on it.
		expect(hide?.classList.contains('adm-saidpress')).toBe(true);
		act(() => vi.advanceTimersByTime(CONFIRMATION_MS - 1));
		expect(hide?.textContent).toBe('Hidden from your page');
		expect(statusLine(host)).toBe('Hidden from your page');
		act(() => vi.advanceTimersByTime(1));
		expect(hide?.textContent).toBe('Show again');
		expect(statusLine(host)).toBe('');
		expect(hide?.classList.contains('adm-saidpress')).toBe(false);
	});

	it('says “Showing again” after Show again, in the status line and on the press, for the confirmation time', () => {
		vi.useFakeTimers();
		const { host, rerender } = mount({ presses: {} });
		const show = press(host, 'Dev P.');
		act(() => show?.click());
		rerender({ presses: { [DEV.id]: { pending: true, outcome: null } } });
		rerender({
			messages: [MAYA, { ...DEV, hidden: false }],
			presses: { [DEV.id]: { pending: false, outcome: { donationId: DEV.id, landed: 'shown' } } }
		});
		expect(show?.textContent).toBe('Showing again');
		expect(statusLine(host)).toBe('Showing again');
		act(() => vi.advanceTimersByTime(CONFIRMATION_MS - 1));
		expect(show?.textContent).toBe('Showing again');
		expect(statusLine(host)).toBe('Showing again');
		act(() => vi.advanceTimersByTime(1));
		expect(show?.textContent).toBe('Hide');
		expect(statusLine(host)).toBe('');
	});
});

describe('presses on two rows at once', () => {
	const ANA: ModeratedMessage = {
		id: 'gift-ana',
		name: 'Ana K.',
		note: 'For the library fund.',
		receivedAt: '2026-11-01T15:00:00.000Z',
		hidden: true
	};
	const idle = { pending: false, outcome: null };

	it('keeps a first row’s refusal while a second row’s press is out', () => {
		const { host, rerender } = mount({ messages: [MAYA, DEV, ANA], presses: {} });
		act(() => press(host, 'Dev P.')?.click());
		rerender({ presses: { [DEV.id]: { pending: true, outcome: null } } });
		act(() => press(host, 'Ana K.')?.click());
		const refused = 'Couldn’t show this message again. Try again.';
		rerender({
			presses: {
				[DEV.id]: { pending: false, outcome: { donationId: DEV.id, refused } },
				[ANA.id]: { pending: true, outcome: null }
			}
		});
		expect(row(host, 'Dev P.')?.querySelector('[role="alert"]')?.textContent).toBe(refused);
		expect(press(host, 'Dev P.')?.hasAttribute('aria-busy')).toBe(false);
		expect(press(host, 'Ana K.')?.getAttribute('aria-busy')).toBe('true');
		expect(row(host, 'Ana K.')?.querySelector('[role="alert"]')?.textContent).toBe('');
	});

	it('says each row’s landing at its own press, a second landing not cutting the first short', () => {
		vi.useFakeTimers();
		const { host, rerender } = mount({ messages: [MAYA, DEV, ANA], presses: {} });
		rerender({
			messages: [MAYA, { ...DEV, hidden: false }, ANA],
			presses: { [DEV.id]: { pending: false, outcome: { donationId: DEV.id, landed: 'shown' } } }
		});
		act(() => vi.advanceTimersByTime(CONFIRMATION_MS / 2));
		rerender({
			messages: [MAYA, { ...DEV, hidden: false }, { ...ANA, hidden: false }],
			presses: {
				[DEV.id]: { pending: false, outcome: { donationId: DEV.id, landed: 'shown' } },
				[ANA.id]: { pending: false, outcome: { donationId: ANA.id, landed: 'shown' } }
			}
		});
		expect(press(host, 'Dev P.')?.textContent).toBe('Showing again');
		expect(press(host, 'Ana K.')?.textContent).toBe('Showing again');
		act(() => vi.advanceTimersByTime(CONFIRMATION_MS / 2));
		expect(press(host, 'Dev P.')?.textContent).toBe('Hide');
		expect(press(host, 'Ana K.')?.textContent).toBe('Showing again');
		act(() => vi.advanceTimersByTime(CONFIRMATION_MS / 2));
		expect(press(host, 'Ana K.')?.textContent).toBe('Hide');
	});

	it('says a refusal in the confirm while another row’s press is out', () => {
		const { host, rerender } = mount({ messages: [MAYA, DEV], presses: {} });
		act(() => press(host, 'Maya R.')?.click());
		act(() => dialogButton('Hide message')?.click());
		rerender({ presses: { [MAYA.id]: { pending: true, outcome: null } } });
		const refused = 'Couldn’t hide this message. Try again.';
		rerender({
			presses: {
				[MAYA.id]: { pending: false, outcome: { donationId: MAYA.id, refused } },
				[DEV.id]: { pending: true, outcome: null }
			}
		});
		expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe(refused);
		expect(dialogButton('Hide message')?.hasAttribute('aria-busy')).toBe(false);
	});

	it('reads a row the record leaves out as at rest', () => {
		const { host } = mount({ presses: { [DEV.id]: idle } });
		expect(press(host, 'Maya R.')?.hasAttribute('aria-busy')).toBe(false);
		expect(press(host, 'Dev P.')?.hasAttribute('aria-busy')).toBe(false);
	});
});

describe('older messages', () => {
	const olderButton = (host: HTMLElement) =>
		[...host.querySelectorAll<HTMLButtonElement>('button')].find(
			(b) => b.textContent === 'Show older messages' || b.textContent === 'Loading'
		) ?? null;
	const wiring = (over: Partial<NonNullable<PublicMessagesProps['older']>> = {}) => ({
		next: 'cursor-1',
		status: 'idle' as const,
		onShowOlder: () => {},
		...over
	});

	it('says what is withheld and asks for it where the read has more', () => {
		const onShowOlder = vi.fn();
		const { host } = mount({ total: 612, older: wiring({ onShowOlder }) });
		expect(host.querySelector('.adm-tablecaption')?.textContent).toBe(
			'612 messages, newest first. Only the most recent 2 are shown.'
		);
		act(() => olderButton(host)?.click());
		expect(onShowOlder).toHaveBeenCalledExactlyOnceWith('cursor-1');
	});

	it('says nothing is withheld and draws no press where the read has no more', () => {
		const { host } = mount({ total: 612, older: wiring({ next: null }) });
		expect(host.querySelector('.adm-tablecaption')?.textContent).toBe(
			'612 messages, newest first.'
		);
		expect(olderButton(host)).toBeNull();
	});

	it('holds the press busy while the older ones load', () => {
		const onShowOlder = vi.fn();
		const { host } = mount({ total: 612, older: wiring({ status: 'loading', onShowOlder }) });
		const more = olderButton(host);
		expect(more?.textContent).toBe('Loading');
		expect(more?.getAttribute('aria-busy')).toBe('true');
		act(() => more?.click());
		expect(onShowOlder).not.toHaveBeenCalled();
	});

	it('says a failed load beside the press, which stays to try again', () => {
		const { host } = mount({ total: 612, older: wiring({ status: 'error' }) });
		const more = olderButton(host);
		const alert = host.querySelector(
			`#${CSS.escape(more?.getAttribute('aria-describedby') ?? '')}`
		);
		expect(alert?.getAttribute('role')).toBe('alert');
		expect(alert?.textContent).toBe('Couldn’t load older messages. Try again.');
		expect(more?.textContent).toBe('Show older messages');
	});

	it('keeps the failure line rendered and empty while nothing failed', () => {
		const { host } = mount({ total: 612, older: wiring() });
		expect(olderButton(host)?.hasAttribute('aria-describedby')).toBe(false);
		const alert = host.querySelector('.adm-actions [role="alert"]');
		expect(alert?.textContent).toBe('');
	});

	it('moves focus to the first older message when the last of them arrives', () => {
		const { host, rerender } = mount({ total: 3, older: wiring() });
		const more = olderButton(host);
		more?.focus();
		act(() => more?.click());
		rerender({ older: wiring({ status: 'loading' }) });
		const ANA = { ...MAYA, id: 'gift-ana', name: 'Ana K.', receivedAt: '2026-10-01T15:00:00.000Z' };
		rerender({ messages: [MAYA, DEV, ANA], older: wiring({ next: null }) });
		expect(olderButton(host)).toBeNull();
		expect(document.activeElement).toBe(press(host, 'Ana K.'));
	});

	it('waits for the older page through a re-read that brings a newer message', () => {
		const { host, rerender } = mount({ total: 3, older: wiring() });
		const more = olderButton(host);
		more?.focus();
		act(() => more?.click());
		rerender({ older: wiring({ status: 'loading' }) });
		// a press on another row re-reads the list, and a note has arrived since it was read.
		const NEW = { ...MAYA, id: 'gift-new', name: 'Lee T.', receivedAt: '2026-11-09T09:00:00.000Z' };
		rerender({ messages: [NEW, MAYA, DEV], total: 4 });
		expect(olderButton(host)?.textContent).toBe('Loading');
		const ANA = { ...MAYA, id: 'gift-ana', name: 'Ana K.', receivedAt: '2026-10-01T15:00:00.000Z' };
		rerender({ messages: [NEW, MAYA, DEV, ANA], older: wiring({ next: null }) });
		expect(olderButton(host)).toBeNull();
		expect(document.activeElement).toBe(press(host, 'Ana K.'));
	});

	it('leaves focus on the press when more older ones remain', () => {
		const { host, rerender } = mount({ total: 9, older: wiring() });
		const more = olderButton(host);
		more?.focus();
		act(() => more?.click());
		rerender({ older: wiring({ status: 'loading' }) });
		const ANA = { ...MAYA, id: 'gift-ana', name: 'Ana K.', receivedAt: '2026-10-01T15:00:00.000Z' };
		rerender({ messages: [MAYA, DEV, ANA], older: wiring({ next: 'cursor-2' }) });
		expect(document.activeElement).toBe(olderButton(host));
	});
});
