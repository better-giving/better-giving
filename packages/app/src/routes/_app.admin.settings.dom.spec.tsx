import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { describe, expect, it, onTestFinished } from 'vitest';
import Settings from './_app.admin.settings';

// what the Settings screen says about the two things a deployment can be missing without any box
// on it being wrong: the mail values, which are set in `.env`, and the notification address.
//
// mounted rather than rendered to a string, inside a stub because the screen's forms and its
// fetchers do not render without a router. what is asserted is the words a reader meets, scoped to
// the card each belongs to.

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

const DETAILS = {
	legal_name: 'Riverbank Trust',
	tax_id: '12-3456789',
	address_line1: '1 Main St',
	address_line2: '',
	city: 'Springfield',
	region: '',
	postal_code: '',
	country: 'US',
	mission: '',
	vision: '',
	brand_colour: '',
	social_links: []
};

type Drawn = {
	readonly notificationEmail: string | null;
	readonly mail: { readonly from: string; readonly host: string } | null;
};

function screen(over: Drawn): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/settings',
			Component: () =>
				createElement(Settings as never, {
					loaderData: {
						details: DETAILS,
						logo: null,
						saved: null,
						version: 0,
						...over
					},
					actionData: undefined,
					params: {},
					matches: []
				})
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin/settings'] }));
}

/** the card a heading names, which is what each assertion below is scoped to. */
function card(root: HTMLElement, heading: string): HTMLElement {
	const found = [...root.querySelectorAll('section')].find(
		(section) => section.querySelector('h2')?.textContent === heading
	);
	if (found === undefined) throw new Error(`the screen drew no card headed ${heading}`);
	return found;
}

const SET = { from: 'giving@riverbanktrust.org', host: 'smtp.riverbanktrust.org' };

describe('the mail card', () => {
	it('says receipts are not going out, and what the server runner does about it, with no mail set', () => {
		const mail = card(screen({ notificationEmail: 'ops@riverbanktrust.org', mail: null }), 'Mail');

		expect(mail.querySelector('[role="status"]')?.textContent).toContain(
			'Receipts aren’t being sent'
		);
		expect(mail.textContent).toContain('For whoever runs the server');
		expect(mail.textContent).toContain('docker compose up -d --force-recreate app');
		expect(mail.querySelector('input[name="to"]')).toBeNull();
	});

	it('states the sender and the host, and offers the test send, with mail set', () => {
		const mail = card(screen({ notificationEmail: 'ops@riverbanktrust.org', mail: SET }), 'Mail');

		expect(mail.textContent).toContain('giving@riverbanktrust.org');
		expect(mail.textContent).toContain('smtp.riverbanktrust.org');
		expect(mail.textContent).not.toContain('Receipts aren’t being sent');
		const to = mail.querySelector<HTMLInputElement>('input[name="to"]');
		expect(to?.defaultValue).toBe('ops@riverbanktrust.org');
		expect(mail.querySelector('button[type="submit"]')?.textContent).toBe('Send test email');
	});
});

describe('the notifications card', () => {
	it('says nothing reaches the organisation while no address is saved', () => {
		const notifications = card(screen({ notificationEmail: null, mail: SET }), 'Notifications');

		expect(notifications.querySelector('[role="status"]')?.textContent).toContain(
			'Nothing reaches you yet'
		);
		expect(notifications.textContent).toContain(
			'Where this site reaches you about the gifts it takes and anything that goes wrong.'
		);
	});

	it('says nothing of the kind once one is saved, and holds it in the box', () => {
		const notifications = card(
			screen({ notificationEmail: 'ops@riverbanktrust.org', mail: SET }),
			'Notifications'
		);

		expect(notifications.textContent).not.toContain('Nothing reaches you yet');
		expect(
			notifications.querySelector<HTMLInputElement>('input[name="notification_email"]')
				?.defaultValue
		).toBe('ops@riverbanktrust.org');
	});
});
