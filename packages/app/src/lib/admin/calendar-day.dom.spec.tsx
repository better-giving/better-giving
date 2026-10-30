import { type ReactNode, act } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, it, onTestFinished, vi } from 'vitest';
import { CalendarDay } from './local-day';

// a day drawn the way the gifts list draws one: `YYYY-MM-DD` inside `<time>`, and nothing about
// layout. a named zone is the caller's. an omitted zone is empty in the markup that arrives, then
// the viewer's (`viewerZone` in ./local-day.tsx).

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

// a formatter built with no `timeZone` option reports `zone` from `resolvedOptions`. one built
// with a zone is the real formatter, so `calendarDay` in ./calendar-day.ts still formats there.
// the process `TZ` is not changed: ICU caches it.
function viewerZoneReports(zone: string): void {
	const native = Intl.DateTimeFormat;
	function finish(
		format: Intl.DateTimeFormat,
		options: Intl.DateTimeFormatOptions | undefined
	): Intl.DateTimeFormat {
		if (options?.timeZone !== undefined) return format;
		const resolved = format.resolvedOptions.bind(format);
		Object.defineProperty(format, 'resolvedOptions', {
			configurable: true,
			value: () => ({ ...resolved(), timeZone: zone })
		});
		return format;
	}
	Intl.DateTimeFormat = new Proxy(native, {
		apply(target, thisArg, args) {
			return finish(Reflect.apply(target, thisArg, args), args[1]);
		},
		construct(target, args, newTarget) {
			return finish(Reflect.construct(target, args, newTarget), args[1]);
		}
	});
	onTestFinished(() => {
		Intl.DateTimeFormat = native;
	});
}

// the zone is the caller's, so this case is the Manila day from ./calendar-day.spec.ts.
it('draws the Manila day of that instant on a time element', () => {
	const root = mount(<CalendarDay at="2026-10-21T16:23:00.000Z" timeZone="Asia/Manila" />);
	const time = root.querySelector('time');
	expect(root.firstElementChild).toBe(time);
	expect(time?.textContent).toBe('2026-10-22');
	expect(time?.dateTime).toBe('2026-10-22');
});

// a cash or cheque gift passes `UTC`: `readAccountingDate` in ../ledger/input-schema.ts stores the
// chosen day as UTC midnight, and that day is the one on the element.
it('draws a chosen day stored as UTC midnight on a time element', () => {
	const root = mount(<CalendarDay at="2026-10-22T00:00:00.000Z" timeZone="UTC" />);
	const time = root.querySelector('time');
	expect(root.firstElementChild).toBe(time);
	expect(time?.textContent).toBe('2026-10-22');
	expect(time?.dateTime).toBe('2026-10-22');
});

// an online gift omits `timeZone` (../../routes/_app.admin.donations._index.tsx). the day is the
// viewer's, which `viewerZone` in ./local-day.tsx reads off the no-argument formatter.
it('draws the Manila day of that instant when no zone is passed', () => {
	viewerZoneReports('Asia/Manila');
	const root = mount(<CalendarDay at="2026-10-21T16:23:00.000Z" />);
	const time = root.querySelector('time');
	expect(root.firstElementChild).toBe(time);
	expect(time?.textContent).toBe('2026-10-22');
	expect(time?.dateTime).toBe('2026-10-22');
});

// the same omission, served and then hydrated. the html that arrives has no day in it — Manila
// would already be the 22nd, UTC still the 21st — and the viewer day is what replaces that empty
// element. a mismatch warning here would be the two renders disagreeing about that emptiness.
it('hydrates an omitted zone without a mismatch, then draws the viewer day', async () => {
	viewerZoneReports('Asia/Manila');
	const element = <CalendarDay at="2026-10-21T16:23:00.000Z" />;
	const host = document.createElement('div');
	host.innerHTML = renderToString(element);
	document.body.appendChild(host);
	const served = host.querySelector('time');
	expect(served?.textContent).toBe('');
	expect(served?.hasAttribute('datetime')).toBe(false);
	const complained = vi.spyOn(console, 'error');
	const mounted = await act(async () => hydrateRoot(host, element));
	onTestFinished(() => {
		act(() => mounted.unmount());
		host.remove();
	});
	const time = host.querySelector('time');
	expect(time?.textContent).toBe('2026-10-22');
	expect(time?.dateTime).toBe('2026-10-22');
	expect(complained).not.toHaveBeenCalled();
});
