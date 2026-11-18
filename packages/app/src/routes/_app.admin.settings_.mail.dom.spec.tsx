import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { describe, expect, it, onTestFinished } from 'vitest';
import Mail from './_app.admin.settings_.mail';

// what the Mail section says about the one thing a deployment can be missing without any box on it
// being wrong — the mail values, which are set in `.env` — mounted inside a stub because its test
// send is a fetcher, which does not render without a router.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Drawn = {
	readonly notificationEmail: string | null;
	readonly mail: {
		readonly from: string;
		readonly host: string;
		readonly delivers: boolean;
	} | null;
};

/** the screen drawn from `drawn`, and its card headed Mail. */
function mailCard(drawn: Drawn): HTMLElement {
	const Stub = createRoutesStub([
		{
			id: 'mail',
			path: '/admin/settings/mail',
			loader: () => drawn,
			action: () => null,
			Component: () =>
				createElement(Mail as never, {
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
				initialEntries: ['/admin/settings/mail'],
				hydrationData: { loaderData: { mail: drawn } }
			})
		)
	);
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	const card = [...root.querySelectorAll('section')].find(
		(section) => section.querySelector('h2')?.textContent === 'Mail'
	);
	if (card === undefined) throw new Error('the screen drew no card headed Mail');
	return card;
}

const SET = {
	from: 'giving@riverbanktrust.org',
	host: 'smtp.riverbanktrust.org',
	delivers: true
};

describe('the mail card', () => {
	it('says receipts are not going out, and what the server runner does about it, with no mail set', () => {
		const mail = mailCard({ notificationEmail: 'ops@riverbanktrust.org', mail: null });

		expect(mail.querySelector('[role="status"]')?.textContent).toContain(
			'Receipts aren’t being sent'
		);
		expect(mail.textContent).toContain('For whoever runs the server');
		expect(mail.textContent).toContain('docker compose up -d --force-recreate app');
		expect(mail.querySelector('input[name="to"]')).toBeNull();
	});

	it('says receipts are not going out when the mail values are still the placeholders from .env.example', () => {
		const mail = mailCard({
			notificationEmail: 'ops@riverbanktrust.org',
			mail: { from: 'donations@example.org', host: 'smtp.example.org', delivers: false }
		});
		const banner = mail.querySelector<HTMLElement>('.adm-banner');

		expect(banner?.querySelector('.adm-banner__word')?.textContent).toBe(
			'Receipts aren’t being sent'
		);
		expect(banner?.textContent).toContain('placeholders from .env.example');
		expect(banner?.textContent).toContain(
			'Nothing is delivered until they are replaced and the app is recreated.'
		);
		expect(banner?.querySelector('.adm-banner__text')?.textContent).toContain(
			'Ask whoever set up this site to replace them. The steps below are for them.'
		);
		expect(banner?.querySelector('pre')?.textContent).toBe(
			'docker compose up -d --force-recreate app'
		);
		expect(banner?.nextElementSibling?.textContent).toContain('donations@example.org');
		expect(banner?.nextElementSibling?.textContent).toContain('smtp.example.org');
		expect(mail.textContent).not.toContain('go out from this address');
	});

	it('holds the steps for whoever runs the server inside the banner, under the staff sentence', () => {
		const mail = mailCard({ notificationEmail: null, mail: null });
		const banner = mail.querySelector<HTMLElement>('.adm-banner');
		const body = banner?.querySelector<HTMLElement>('.adm-banner__body');

		expect(mail.querySelectorAll('.adm-banner')).toHaveLength(1);
		expect(body?.previousElementSibling?.textContent).toContain(
			'Ask whoever set up this site to add it.'
		);
		expect(body?.querySelector('h3')?.textContent).toBe('For whoever runs the server');
		expect(body?.textContent).toContain('Add the mail values to .env (DEPLOY.md, Mail)');
		expect(body?.querySelector('pre')?.textContent).toBe(
			'docker compose up -d --force-recreate app'
		);
		// nothing of the steps is left standing under the banner.
		expect(banner?.nextElementSibling).toBeNull();
	});

	it.each([
		['with no mail set', null],
		['with mail set', SET]
	])('stands the card’s rows one step apart, its body being a stack, %s', (_, mail) => {
		const body = mailCard({ notificationEmail: null, mail }).querySelector('.ds-card-body');

		expect(body?.classList.contains('adm-stack')).toBe(true);
	});

	it('states the sender and the host, and offers the test send, with mail set', () => {
		const mail = mailCard({ notificationEmail: 'ops@riverbanktrust.org', mail: SET });

		expect(mail.textContent).toContain('giving@riverbanktrust.org');
		expect(mail.textContent).toContain('smtp.riverbanktrust.org');
		expect(mail.textContent).not.toContain('Receipts aren’t being sent');
		const to = mail.querySelector<HTMLInputElement>('input[name="to"]');
		expect(to?.defaultValue).toBe('ops@riverbanktrust.org');
		expect(mail.querySelector('button[type="submit"]')?.textContent).toBe('Send test email');
	});
});
