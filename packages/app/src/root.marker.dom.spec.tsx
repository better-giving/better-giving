import { act, createElement, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { describe, expect, it, onTestFinished } from 'vitest';
import { StaffMarkerContext } from '$lib/donate/staff-marker-context';
import App from './root';

// the root hands the loader's reading of the returning-staff marker to every screen below it
// ($lib/donate/staff-marker-context.tsx), which is what the site footer draws its Console link on.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
	return createElement('p', { id: 'probe' }, String(useContext(StaffMarkerContext)));
}

async function probed(staffMarker: boolean): Promise<string | null | undefined> {
	const Stub = createRoutesStub([
		{
			id: 'root',
			Component: () => createElement(App as never, { loaderData: { staffMarker } }),
			children: [{ path: '/', Component: Probe }]
		}
	]);
	const host = document.createElement('div');
	document.body.appendChild(host);
	const mounted = createRoot(host);
	await act(async () => mounted.render(createElement(Stub, { initialEntries: ['/'] })));
	onTestFinished(() => {
		act(() => mounted.unmount());
		host.remove();
	});
	return host.querySelector('#probe')?.textContent;
}

describe('the root route', () => {
	it('tells every screen below it that the browser carries the marker', async () => {
		expect(await probed(true)).toBe('true');
	});

	it('tells them it does not for a donor', async () => {
		expect(await probed(false)).toBe('false');
	});
});
