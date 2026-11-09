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
		limit: 500,
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
		const { host } = mount({ total: 612, limit: 2 });
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
		expect(hide?.getAttribute('aria-label')).toBe('Hide the message from Maya R.');
		expect(hide?.getAttribute('aria-haspopup')).toBe('dialog');
	});

	it('draws a hidden row in the quiet ink, its word without a ground, and a Show again press', () => {
		const { host } = mount();
		const hidden = row(host, 'Dev P.');
		expect(hidden?.querySelector('.ds-badge.adm-state--note')?.textContent).toBe('Hidden');
		expect(
			[...(hidden?.querySelectorAll('.adm-cell__quiet') ?? [])].map((q) => q.textContent)
		).toEqual(['Dev P.', DEV.note]);
		const show = press(host, 'Dev P.');
		expect(show?.textContent).toBe('Show again');
		expect(show?.getAttribute('aria-label')).toBe('Show the message from Dev P. again');
		expect(show?.hasAttribute('aria-haspopup')).toBe(false);
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
		expect(row(host, 'Maya R.')?.querySelector('[role="alert"]')).toBeNull();
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
		expect(hide?.getAttribute('aria-disabled')).toBe('true');
		expect(host.querySelector('p[role="status"]')?.textContent).toBe('Hidden from your page');
		act(() => vi.advanceTimersByTime(CONFIRMATION_MS));
		expect(hide?.textContent).toBe('Show again');
		expect(hide?.getAttribute('aria-label')).toBe('Show the message from Maya R. again');
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
		act(() => press(host, 'Dev P.')?.click());
		rerender({ pending: { donationId: DEV.id } });
		rerender({
			pending: null,
			outcome: { donationId: DEV.id, refused: 'Couldn’t show this message again. Try again.' }
		});
		const refusal = row(host, 'Dev P.')?.querySelector('[role="alert"]');
		expect(refusal?.textContent).toBe('Couldn’t show this message again. Try again.');
		expect(press(host, 'Dev P.')?.getAttribute('aria-describedby')).toBe(refusal?.id);
		expect(press(host, 'Dev P.')?.hasAttribute('aria-disabled')).toBe(false);
	});
});
