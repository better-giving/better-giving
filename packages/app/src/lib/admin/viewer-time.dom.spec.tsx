import { act, type ReactElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { InstantStyle } from './viewer-time.ts';
import { LocalTime, ViewerZoneProvider } from './viewer-time.react.tsx';
import { browserIn } from './viewer-time.testing.ts';

// the server renders an instant in the zone the `admin_zone` cookie named, the browser hydrates
// that same text and only then moves to its own zone, so no first paint is a guessed day and
// react sees nothing to complain about.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LATE_NIGHT = '2026-10-21T16:23:00.000Z';

afterEach(() => {
	// biome-ignore lint/suspicious/noDocumentCookie: the provider writes the cookie the same way (./viewer-time.react.tsx).
	document.cookie = 'admin_zone=; Path=/; Max-Age=0';
});

function page(serverZone: string | null, style: InstantStyle = 'day'): ReactElement {
	return (
		<ViewerZoneProvider serverZone={serverZone}>
			<LocalTime at={LATE_NIGHT} style={style} />
		</ViewerZoneProvider>
	);
}

/** the server's markup, hydrated: what react first painted, what it ended on, what it said. */
async function serveThenHydrate(serverZone: string | null, style?: InstantStyle) {
	const host = document.createElement('div');
	host.innerHTML = renderToString(page(serverZone, style));
	document.body.appendChild(host);
	const served = host.querySelector('time');
	const servedText = served?.textContent;

	const painted: string[] = [];
	const watcher = new MutationObserver((records) => {
		for (const record of records) {
			if (record.type === 'characterData') painted.push(record.oldValue ?? '');
		}
	});
	watcher.observe(host, { subtree: true, characterData: true, characterDataOldValue: true });

	const recovered: unknown[] = [];
	const complained = vi.spyOn(console, 'error');
	const mounted = await act(async () =>
		hydrateRoot(host, page(serverZone, style), {
			onRecoverableError: (error) => recovered.push(error)
		})
	);
	watcher.disconnect();
	onTestFinished(() => {
		act(() => mounted.unmount());
		host.remove();
	});
	const time = host.querySelector('time');
	return { served, servedText, time, painted, recovered, complained };
}

it('hydrates the zone the server rendered, then moves to the browser zone', async () => {
	browserIn('Asia/Manila');
	const { served, servedText, time, painted, recovered, complained } =
		await serveThenHydrate('America/New_York');

	expect(servedText).toBe('21 Oct 2026');
	expect(recovered).toEqual([]);
	expect(complained).not.toHaveBeenCalled();
	// the same element the server sent, its text changed in place from the server's
	expect(time).toBe(served);
	expect(painted[0]).toBe('21 Oct 2026');
	expect(time?.textContent).toBe('22 Oct 2026');
	expect(time?.getAttribute('datetime')).toBe(LATE_NIGHT);
});

it('sends an empty time for a viewer with no zone yet, then fills it in the browser zone', async () => {
	browserIn('Asia/Manila');
	const { servedText, served, time, recovered, complained } = await serveThenHydrate(null);

	expect(servedText).toBe('');
	expect(served?.getAttribute('datetime')).toBe(LATE_NIGHT);
	expect(recovered).toEqual([]);
	expect(complained).not.toHaveBeenCalled();
	expect(time).toBe(served);
	expect(time?.textContent).toBe('22 Oct 2026');
});

it('hydrates a moment in the zone the server rendered without a word to correct', async () => {
	browserIn('Asia/Manila');
	const { servedText, time, recovered, complained } = await serveThenHydrate(
		'Asia/Manila',
		'moment'
	);

	expect(servedText).toBe('22 Oct 2026, 00:23 UTC+8');
	expect(recovered).toEqual([]);
	expect(complained).not.toHaveBeenCalled();
	expect(time?.textContent).toBe('22 Oct 2026, 00:23 UTC+8');
});

it('writes the browser zone to the cookie when the server read another', async () => {
	browserIn('Asia/Manila');
	await serveThenHydrate('America/New_York');

	expect(document.cookie).toContain('admin_zone=Asia/Manila');
});

it('writes the cookie on a first visit, when the server read none', async () => {
	browserIn('Asia/Manila');
	await serveThenHydrate(null);

	expect(document.cookie).toContain('admin_zone=Asia/Manila');
});

// happy-dom defines the `cookie` accessor on the document's prototype chain, not on the instance
// and not on the global `Document`, so the spy goes on whichever prototype owns it.
function cookieWrites() {
	let owner: object | null = document;
	while (owner && !Object.hasOwn(owner, 'cookie')) owner = Object.getPrototypeOf(owner);
	if (owner === null) throw new Error('no prototype of document owns a cookie accessor');
	return vi.spyOn(owner as Document, 'cookie', 'set');
}

it('leaves the cookie alone when it already names the browser zone', async () => {
	browserIn('Asia/Manila');
	const written = cookieWrites();
	const { time } = await serveThenHydrate('Asia/Manila');

	expect(time?.textContent).toBe('22 Oct 2026');
	expect(written).not.toHaveBeenCalled();
});

it('writes the cookie once when the server read another zone, which the same spy sees', async () => {
	browserIn('Asia/Manila');
	const written = cookieWrites();
	await serveThenHydrate('America/New_York');

	expect(written).toHaveBeenCalledOnce();
	expect(written.mock.calls[0]?.[0]).toContain('admin_zone=Asia/Manila');
});

describe('an instant that is not a date', () => {
	it('throws from the render rather than writing a blank', () => {
		expect(() =>
			renderToString(
				<ViewerZoneProvider serverZone="UTC">
					<LocalTime at="" style="iso-day" />
				</ViewerZoneProvider>
			)
		).toThrow(RangeError);
	});
});
