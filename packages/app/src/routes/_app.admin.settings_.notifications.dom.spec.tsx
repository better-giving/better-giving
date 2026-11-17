import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { describe, expect, it, onTestFinished } from 'vitest';
import Notifications from './_app.admin.settings_.notifications';

// what the Notifications section says while no address is saved, and the save row its card draws,
// mounted inside a stub because its form does not render without a router.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** the screen drawn with `address` stored, and its card headed Notifications. */
function notificationsCard(address: string | null): HTMLElement {
	const drawn = { notificationEmail: address, saved: null, version: 0 };
	const Stub = createRoutesStub([
		{
			id: 'notifications',
			path: '/admin/settings/notifications',
			loader: () => drawn,
			action: () => null,
			Component: () =>
				createElement(Notifications as never, {
					loaderData: useLoaderData(),
					actionData: undefined,
					params: {},
					matches: []
				})
		}
	]);
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() =>
		mounted.render(
			createElement(Stub, {
				initialEntries: ['/admin/settings/notifications'],
				hydrationData: { loaderData: { notifications: drawn } }
			})
		)
	);
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	const card = [...root.querySelectorAll('section')].find(
		(section) => section.querySelector('h2')?.textContent === 'Notifications'
	);
	if (card === undefined) throw new Error('the screen drew no card headed Notifications');
	return card;
}

describe('the notifications card', () => {
	it('says nothing reaches the organisation while no address is saved', () => {
		const notifications = notificationsCard(null);

		expect(notifications.querySelector('.adm-banner')?.textContent).toContain(
			'Nothing reaches you yet'
		);
		expect(notifications.textContent).toContain(
			'Where this site reaches you about the gifts it takes and anything that goes wrong.'
		);
	});

	it('says nothing of the kind once one is saved, and holds it in the box', () => {
		const notifications = notificationsCard('ops@riverbanktrust.org');

		expect(notifications.textContent).not.toContain('Nothing reaches you yet');
		expect(
			notifications.querySelector<HTMLInputElement>('input[name="notification_email"]')
				?.defaultValue
		).toBe('ops@riverbanktrust.org');
	});

	it('saves from the card’s foot, through the form it names, with nothing to save at first', () => {
		const notifications = notificationsCard('ops@riverbanktrust.org');
		const form = notifications.querySelector('form');
		const save = notifications.querySelector<HTMLButtonElement>(
			'.ds-card-footer button[type="submit"]'
		);

		expect(save?.textContent).toBe('Save address');
		expect(save?.getAttribute('form')).toBe(form?.id);
		expect(save?.getAttribute('aria-disabled')).toBe('true');
	});
});
