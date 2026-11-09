import { act, type ReactElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { InstantStyle } from './viewer-time.ts';
import { LocalTime, useViewerZone, ViewerZoneProvider } from './viewer-time.react.tsx';
import { browserIn } from './viewer-time.testing.ts';

// the server renders an instant in the zone the `admin_zone` cookie named, the browser hydrates
// that same text and only then moves to its own zone, so no first paint is a guessed day and
// react sees nothing to complain about.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LATE_NIGHT = '2026-10-21T16:23:00.000Z';

afterEach(() => {
	// biome-ignore lint/suspicious/noDocumentCookie: the provider writes the cookie the same way (./viewer-time.react.tsx).
	document.cookie = 'admin_zone=; Path=/admin; Max-Age=0';
});

function page(serverZone: string | null, style: InstantStyle = 'day'): ReactElement {
	return (
		<ViewerZoneProvider serverZone={serverZone}>
			<LocalTime at={LATE_NIGHT} style={style} />
		</ViewerZoneProvider>
	);
}

/** the server's markup, hydrated: what react first painted, what it ended on, what it said. */
function serveThenHydrate(serverZone: string | null, style?: InstantStyle) {
	return serveThenHydrateTree(page(serverZone, style));
}

async function serveThenHydrateTree(tree: ReactElement, selector = 'time') {
	const host = document.createElement('div');
	host.innerHTML = renderToString(tree);
	document.body.appendChild(host);
	const served = host.querySelector(selector);
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
		hydrateRoot(host, tree, {
			onRecoverableError: (error) => recovered.push(error)
		})
	);
	watcher.disconnect();
	onTestFinished(() => {
		act(() => mounted.unmount());
		host.remove();
	});
	const time = host.querySelector(selector);
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

// happy-dom defines the `cookie` accessor on the document's prototype chain, not on the instance
// and not on the global `Document`, so the spy goes on whichever prototype owns it.
function cookieWrites() {
	let owner: object | null = document;
	while (owner && !Object.hasOwn(owner, 'cookie')) owner = Object.getPrototypeOf(owner);
	if (owner === null) throw new Error('no prototype of document owns a cookie accessor');
	return vi.spyOn(owner as Document, 'cookie', 'set');
}

it('writes the cookie on a first visit, when the server read none', async () => {
	browserIn('Asia/Manila');
	const written = cookieWrites();
	await serveThenHydrate(null);

	expect(written).toHaveBeenCalledOnce();
	expect(written.mock.calls[0]?.[0]).toContain('admin_zone=Asia/Manila');
});

it('leaves the cookie alone when it already names the browser zone', async () => {
	browserIn('Asia/Manila');
	const written = cookieWrites();
	const { time } = await serveThenHydrate('Asia/Manila');

	expect(time?.textContent).toBe('22 Oct 2026');
	expect(written).not.toHaveBeenCalled();
});

it('writes the browser zone to the cookie once when the server read another', async () => {
	browserIn('Asia/Manila');
	const written = cookieWrites();
	await serveThenHydrate('America/New_York');

	expect(written).toHaveBeenCalledOnce();
	expect(written.mock.calls[0]?.[0]).toContain('admin_zone=Asia/Manila');
});

it.each([
	['http:', 'admin_zone=Asia/Manila; Path=/admin; Max-Age=31536000; SameSite=Lax'],
	['https:', 'admin_zone=Asia/Manila; Path=/admin; Max-Age=31536000; SameSite=Lax; Secure']
])('writes the cookie for /admin alone, for a year, on %s', async (protocol, cookie) => {
	browserIn('Asia/Manila');
	pageProtocol(protocol);
	const written = cookieWrites();
	await serveThenHydrate(null);

	expect(written.mock.calls).toEqual([[cookie]]);
});

// happy-dom's `location` keeps `protocol` on its prototype, as `document` keeps `cookie`.
function pageProtocol(protocol: string) {
	let owner: object | null = location;
	while (owner && !Object.hasOwn(owner, 'protocol')) owner = Object.getPrototypeOf(owner);
	if (owner === null) throw new Error('no prototype of location owns a protocol accessor');
	vi.spyOn(owner as Location, 'protocol', 'get').mockReturnValue(protocol);
}

// a server and a browser can format the same zone name with different tz data (a zone whose rules
// changed recently), so a time's text is let differ at hydration: react keeps the server's text,
// says nothing, and the browser's zone takes over on the next render.
it('hydrates a time whose text the browser formats differently without a mismatch', async () => {
	browserIn('Asia/Manila');
	const host = document.createElement('div');
	host.innerHTML = renderToString(page('Asia/Manila', 'moment')).replace(
		'00:23 UTC+8',
		'01:23 UTC+9'
	);
	document.body.appendChild(host);
	const served = host.querySelector('time');

	const recovered: unknown[] = [];
	const complained = vi.spyOn(console, 'error');
	const mounted = await act(async () =>
		hydrateRoot(host, page('Asia/Manila', 'moment'), {
			onRecoverableError: (error) => recovered.push(error)
		})
	);
	onTestFinished(() => {
		act(() => mounted.unmount());
		host.remove();
	});

	expect(served?.textContent).toBe('22 Oct 2026, 01:23 UTC+9');
	expect(recovered).toEqual([]);
	expect(complained).not.toHaveBeenCalled();
	expect(host.querySelector('time')).toBe(served);
});

describe('an instant that is not a date', () => {
	it.each([
		['a missing', undefined],
		['a null', null],
		['an empty', ''],
		['an unparseable', 'not a date']
	])('writes a dash for %s instant, on the server and once hydrated', async (_what, at) => {
		browserIn('Asia/Manila');
		const { served, servedText, time, recovered, complained } = await serveThenHydrateTree(
			<ViewerZoneProvider serverZone="America/New_York">
				<LocalTime at={at} style="moment" />
			</ViewerZoneProvider>
		);

		expect(servedText).toBe('—');
		expect(served?.hasAttribute('datetime')).toBe(false);
		expect(recovered).toEqual([]);
		expect(complained).not.toHaveBeenCalled();
		expect(time).toBe(served);
		expect(time?.textContent).toBe('—');
		expect(time?.hasAttribute('datetime')).toBe(false);
	});
});

describe('a zone this runtime cannot write in', () => {
	it('leaves the time empty when the browser resolves a zone the runtime does not know', async () => {
		browserIn('Mars/Olympus');
		const { servedText, time, recovered, complained } = await serveThenHydrate(null, 'moment');

		expect(servedText).toBe('');
		expect(recovered).toEqual([]);
		expect(complained).not.toHaveBeenCalled();
		expect(time?.textContent).toBe('');
		expect(time?.getAttribute('datetime')).toBe(LATE_NIGHT);
	});

	it('writes no cookie when the browser resolves a zone the runtime does not know', async () => {
		browserIn('Etc/Unknown');
		const written = cookieWrites();
		await serveThenHydrate(null);

		expect(written).not.toHaveBeenCalled();
	});

	it('writes no cookie and leaves the time empty when the browser resolves no zone at all', async () => {
		const real = Intl.DateTimeFormat.prototype.resolvedOptions;
		vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
			this: Intl.DateTimeFormat
		) {
			return { ...real.call(this), timeZone: undefined as unknown as string };
		});
		const written = cookieWrites();
		const { time, complained } = await serveThenHydrate(null, 'moment');

		expect(written).not.toHaveBeenCalled();
		expect(complained).not.toHaveBeenCalled();
		expect(time?.textContent).toBe('');
	});

	it('serves an empty time for a zone the server was handed but cannot write in', () => {
		const complained = vi.spyOn(console, 'error');
		const host = document.createElement('div');
		host.innerHTML = renderToString(page('Mars/Olympus', 'iso-day'));

		expect(host.querySelector('time')?.textContent).toBe('');
		expect(complained).not.toHaveBeenCalled();
	});
});

describe('useViewerZone', () => {
	function Zone() {
		return <output>{useViewerZone() ?? 'none'}</output>;
	}
	const zonePage = (serverZone: string | null) => (
		<ViewerZoneProvider serverZone={serverZone}>
			<Zone />
		</ViewerZoneProvider>
	);

	it('is the server zone on the server, and the browser zone once hydrated', async () => {
		browserIn('Asia/Manila');
		const { servedText, painted, time, recovered, complained } = await serveThenHydrateTree(
			zonePage('America/New_York'),
			'output'
		);

		expect(servedText).toBe('America/New_York');
		expect(recovered).toEqual([]);
		expect(complained).not.toHaveBeenCalled();
		expect(painted[0]).toBe('America/New_York');
		expect(time?.textContent).toBe('Asia/Manila');
	});

	it('is null in the browser when the runtime cannot write in the browser zone', async () => {
		browserIn('Mars/Olympus');
		const { servedText, time, complained } = await serveThenHydrateTree(zonePage(null), 'output');

		expect(servedText).toBe('none');
		expect(complained).not.toHaveBeenCalled();
		expect(time?.textContent).toBe('none');
	});
});
