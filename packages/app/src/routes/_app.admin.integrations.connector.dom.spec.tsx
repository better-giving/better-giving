import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import { browserIn } from '$lib/admin/viewer-time.testing';
import Connections from './_app.admin.integrations.connector';

// the line each connection is stated on: when it was made and last used, in the viewer's own day
// ($lib/admin/viewer-time.react.tsx), and the key it holds.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Connection = { createdAt: string; lastUsedAt: string | null };

function screen(connection: Connection) {
	const Stub = createRoutesStub([
		{
			path: '/admin/integrations/connector',
			Component: () =>
				createElement(Connections as never, {
					loaderData: { connections: [{ id: 'c1', key: 'bgc_…a1b2', ...connection }] },
					actionData: undefined,
					params: {},
					matches: []
				})
		}
	]);
	return createElement(Stub, { initialEntries: ['/admin/integrations/connector'] });
}

function line(connection: Connection): string {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(screen(connection)));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root.querySelector('.adm-actions span')?.textContent ?? '';
}

it('states the days a connection was made and last used in the viewer’s zone', () => {
	// late on 21 Oct UTC, which is already 22 Oct in Manila.
	browserIn('Asia/Manila');

	expect(
		line({ createdAt: '2026-10-21T16:23:00.000Z', lastUsedAt: '2026-10-25T16:00:00.000Z' })
	).toBe('Connected 22 Oct 2026 · key bgc_…a1b2 · last used 26 Oct 2026');
});

it('says a connection nothing has used yet is not used yet', () => {
	browserIn('America/New_York');

	expect(line({ createdAt: '2026-10-21T16:23:00.000Z', lastUsedAt: null })).toBe(
		'Connected 21 Oct 2026 · key bgc_…a1b2 · not used yet'
	);
});

it('leaves the days out of the server’s markup until the viewer’s zone is known', () => {
	// no `admin_zone` cookie, so no ViewerZoneProvider names a zone above the screen.
	const held = document.createElement('div');
	held.innerHTML = renderToString(
		screen({ createdAt: '2026-10-21T16:23:00.000Z', lastUsedAt: '2026-10-25T16:00:00.000Z' })
	);

	expect(held.querySelector('.adm-actions span')?.textContent).toBe(
		'Connected  · key bgc_…a1b2 · last used '
	);
});
