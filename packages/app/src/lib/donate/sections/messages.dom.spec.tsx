import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { DonorMessage, DonorMessages as DonorMessagesPage } from '../messages';
import { DonorMessages, type DonorMessagesProps } from './messages';

// Messages from donors, mounted over the pages the route hands it: nothing with none, a list with
// no band when all are shown, the band and Show more while more remain, and a press through
// loading, a failed press and the answer that ends the list.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = '2026-11-09T12:00:00.000Z';

const message = (at: number): DonorMessage => ({
	name: `Donor ${at}.`,
	note: `Note number ${at}.`,
	receivedAt: new Date(Date.parse(NOW) - at * 86_400_000 - 3_600_000).toISOString()
});

const page = (from: number, count: number, total: number, next: string | null) =>
	({
		messages: Array.from({ length: count }, (_, i) => message(from + i)),
		total,
		next
	}) satisfies DonorMessagesPage;

function mount(props: Partial<DonorMessagesProps> & Pick<DonorMessagesProps, 'initial'>) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	const base: DonorMessagesProps = {
		locale: 'en-US',
		shape: 'list',
		now: NOW,
		status: 'idle',
		arrived: null,
		onShowMore: () => {},
		...props
	};
	act(() => root.render(<DonorMessages {...base} />));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return {
		host,
		rerender: (next: Partial<DonorMessagesProps>) => {
			Object.assign(base, next);
			act(() => root.render(<DonorMessages {...base} />));
		}
	};
}

const rows = (host: HTMLElement) => [...host.querySelectorAll('li')];
const more = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('.page-messages-more');

describe('messages from donors', () => {
	it('draws nothing at all with no message', () => {
		const { host } = mount({ initial: page(1, 0, 0, null) });
		expect(host.childNodes).toHaveLength(0);
	});

	it('draws one message under the heading, with no band', () => {
		const { host } = mount({ initial: page(1, 1, 1, null) });
		const section = host.querySelector('section');
		const heading = host.querySelector('h2');
		expect(heading?.textContent).toBe('Messages from donors');
		expect(section?.getAttribute('aria-labelledby')).toBe(heading?.id);
		expect(rows(host)).toHaveLength(1);
		expect(rows(host)[0]?.textContent).toContain('Donor 1.');
		expect(rows(host)[0]?.textContent).toContain('Note number 1.');
		expect(host.querySelector('.page-messages-foot')).toBeNull();
		expect(more(host)).toBeNull();
	});

	it('dates each message by when it arrived, worded from the page’s `now`', () => {
		const { host } = mount({ initial: page(1, 3, 3, null) });
		const times = [...host.querySelectorAll('time')];
		expect(times.map((t) => t.textContent)).toEqual(['yesterday', '2 days ago', '3 days ago']);
		expect(times[0]?.dateTime).toBe(message(1).receivedAt);
	});

	it('counts six of many in the band and offers six more', () => {
		const { host } = mount({ initial: page(1, 6, 48, 'c6') });
		expect(rows(host)).toHaveLength(6);
		const foot = host.querySelector('.page-messages-foot');
		expect(foot?.textContent).toContain('Showing 6 of 48 messages');
		// the band's status line is the one live region speaking, the press outside it: its words
		// change on every press. the end-of-list line stands empty beside it until the last page.
		const live = [...host.querySelectorAll('[role="status"], [role="alert"], [aria-live]')].filter(
			(region) => region.textContent !== ''
		);
		expect(live).toHaveLength(1);
		expect(live[0]?.getAttribute('role')).toBe('status');
		expect(live[0]?.textContent).toBe('Showing 6 of 48 messages');
		expect(more(host)?.closest('[role="status"]')).toBeNull();
		expect(more(host)?.textContent).toBe('Show more messages');
		expect(more(host)?.getAttribute('aria-busy')).toBeNull();
	});

	it('asks for the six after the cursor the list ends on', () => {
		const onShowMore = vi.fn();
		const { host } = mount({ initial: page(1, 6, 48, 'c6'), onShowMore });
		act(() => more(host)?.click());
		expect(onShowMore).toHaveBeenCalledExactlyOnceWith('c6');
	});

	it('holds the press busy and focused while it loads, and takes no second press', () => {
		const onShowMore = vi.fn();
		const { host, rerender } = mount({ initial: page(1, 6, 48, 'c6'), onShowMore });
		const button = more(host);
		button?.focus();
		act(() => button?.click());
		rerender({ status: 'loading' });
		expect(more(host)).toBe(button);
		expect(button?.getAttribute('aria-busy')).toBe('true');
		expect(button?.textContent).toBe('Loading');
		expect(button?.querySelector('.ds-spinner')?.getAttribute('aria-hidden')).toBe('true');
		expect(document.activeElement).toBe(button);
		act(() => button?.click());
		expect(onShowMore).toHaveBeenCalledOnce();
	});

	it('adds the answer under the list and counts it, focus staying on the press', () => {
		const { host, rerender } = mount({ initial: page(1, 6, 48, 'c6') });
		const button = more(host);
		button?.focus();
		act(() => button?.click());
		rerender({ status: 'loading' });
		rerender({ status: 'idle', arrived: page(7, 6, 48, 'c12') });
		expect(rows(host)).toHaveLength(12);
		expect(rows(host)[6]?.textContent).toContain('Donor 7.');
		expect(host.querySelector('.page-messages-foot')?.textContent).toContain(
			'Showing 12 of 48 messages'
		);
		expect(document.activeElement).toBe(button);
		expect(rows(host).some((row) => row.hasAttribute('tabindex'))).toBe(false);
	});

	it('adds an answer handed back again only once', () => {
		const arrived = page(7, 6, 48, 'c12');
		const { host, rerender } = mount({ initial: page(1, 6, 48, 'c6') });
		act(() => more(host)?.click());
		rerender({ arrived });
		rerender({ arrived: { ...arrived } });
		expect(rows(host)).toHaveLength(12);
	});

	it('drops the band and the press once all are shown, and focuses the first message added', () => {
		const { host, rerender } = mount({ initial: page(1, 6, 8, 'c6') });
		more(host)?.focus();
		act(() => more(host)?.click());
		rerender({ status: 'loading' });
		rerender({ status: 'idle', arrived: page(7, 2, 8, null) });
		expect(rows(host)).toHaveLength(8);
		expect(host.querySelector('.page-messages-foot')).toBeNull();
		expect(more(host)).toBeNull();
		const first = rows(host)[6];
		expect(first?.getAttribute('tabindex')).toBe('-1');
		expect(document.activeElement).toBe(first);
	});

	it('says the final count once all are shown, in a line there before the last page arrived', () => {
		const { host, rerender } = mount({ initial: page(1, 6, 8, 'c6') });
		const end = host.querySelector('section > [role="status"]');
		expect(end?.textContent).toBe('');
		act(() => more(host)?.click());
		rerender({ status: 'loading' });
		rerender({ status: 'idle', arrived: page(7, 2, 8, null) });
		expect(host.querySelector('section > [role="status"]')).toBe(end);
		expect(end?.textContent).toBe('Showing 8 of 8 messages');
		expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
	});

	it('leaves focus where a reader moved it while the last page loaded', () => {
		const elsewhere = document.createElement('button');
		document.body.appendChild(elsewhere);
		onTestFinished(() => elsewhere.remove());
		const { host, rerender } = mount({ initial: page(1, 6, 8, 'c6') });
		act(() => more(host)?.click());
		elsewhere.focus();
		rerender({ arrived: page(7, 2, 8, null) });
		expect(document.activeElement).toBe(elsewhere);
	});

	it('says a refused press in the band’s status line and keeps the press ready to try again', () => {
		const onShowMore = vi.fn();
		const { host, rerender } = mount({ initial: page(1, 6, 48, 'c6'), onShowMore });
		const button = more(host);
		button?.focus();
		act(() => button?.click());
		rerender({ status: 'loading' });
		rerender({ status: 'error' });
		const status = host.querySelector('.page-messages-foot [role="status"]');
		expect(status?.querySelector('.page-messages-refused')?.textContent).toBe(
			'Couldn’t load more messages. Try again.'
		);
		expect(status?.textContent).toContain('Showing 6 of 48 messages');
		// one live region says it: no alert beside or around the status line.
		expect(host.querySelectorAll('[role="alert"], [aria-live]')).toHaveLength(0);
		expect(status?.contains(button ?? null)).toBe(false);
		expect(host.querySelector('section')).not.toBeNull();
		expect(rows(host)).toHaveLength(6);
		expect(more(host)).toBe(button);
		expect(button?.disabled).toBe(false);
		expect(button?.getAttribute('aria-busy')).toBeNull();
		expect(button?.textContent).toBe('Show more messages');
		expect(document.activeElement).toBe(button);
		act(() => button?.click());
		expect(onShowMore).toHaveBeenCalledTimes(2);
		expect(onShowMore).toHaveBeenLastCalledWith('c6');
		rerender({ status: 'loading' });
		expect(host.querySelector('.page-messages-refused')).toBeNull();
		rerender({ status: 'idle', arrived: page(7, 6, 48, 'c12') });
		expect(rows(host)).toHaveLength(12);
	});
});
