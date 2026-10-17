import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { DataRouter } from 'react-router';
import { createMemoryRouter, RouterProvider, UNSAFE_withComponentProps } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VarsWritten } from '../api/types';
import { orgBoxes } from '../lib/org-fields';
import { MAIL_GROUP, VALUE_FIELD, groupIntent, SECRET_GROUPS } from '../lib/secret-groups';
import { TEST_EMAIL_INTENT } from '../lib/smtp-fold';
import { TEST_TO_FIELD } from '../lib/smtp-fold-state';

// the mail page's credentials press, through a router: what the boxes are on the render the answer
// lands in. that render is the one the seam's focus move runs on (../lib/use-console-form.ts), so a
// box still closed there is a refusal the operator is left in front of with focus nowhere. the
// client is replaced so the answer is whichever one the case sets, and the layout's reading is a
// count.

const binary = vi.hoisted(() => ({
	shellReads: 0,
	written: { kind: 'set' } as VarsWritten
}));

vi.mock('../api/client', async (original) => ({
	...(await original<Record<string, unknown>>()),
	homeReading: async () => ({
		values: {
			vars: {
				kind: 'read' as const,
				vars: [
					{ name: 'SMTP_HOST', kind: 'value', value: 'smtp.example.org' },
					{ name: 'SMTP_PORT', kind: 'value', value: '465' },
					{ name: 'SMTP_USERNAME', kind: 'value', value: 'receipts' },
					{ name: 'SMTP_PASSWORD', kind: 'value', value: 'secret' },
					{ name: 'MAIL_FROM', kind: 'value', value: 'receipts@example.org' }
				]
			}
		}
	}),
	setVars: async () => binary.written,
	sendTestEmail: async () => ({
		kind: 'reported' as const,
		report: { outcome: 'sent' as const, detail: null, to: 'alerts@example.org' }
	})
}));

const sections = await import('./_sections');
const smtp = await import('./_sections.smtp');

const PAGE = '/smtp';
const PAGE_ID = 'smtp';

const mailGroup = SECRET_GROUPS.find((group) => group.id === MAIL_GROUP);
if (mailGroup === undefined) throw new Error(`no ${MAIL_GROUP} group`);
const STORE = groupIntent(mailGroup);
const HOST = `${MAIL_GROUP}-${VALUE_FIELD('SMTP_HOST')}`;

const SHELL = {
	workerName: 'better-giving',
	account: 'Riverbank Trust',
	reading: {
		values: {
			vars: {
				kind: 'read' as const,
				vars: [
					{ name: 'SMTP_HOST', kind: 'value', value: 'smtp.example.org' },
					{ name: 'SMTP_PORT', kind: 'value', value: '465' },
					{ name: 'SMTP_USERNAME', kind: 'value', value: 'receipts' },
					{ name: 'SMTP_PASSWORD', kind: 'value', value: 'secret' },
					{ name: 'MAIL_FROM', kind: 'value', value: 'receipts@example.org' }
				]
			}
		},
		stored: orgBoxes({ notification_email: 'alerts@example.org' })
	}
};

beforeEach(() => {
	binary.shellReads = 0;
	binary.written = { kind: 'set' };
});

async function open() {
	const router = createMemoryRouter(
		[
			{
				children: [
					{
						loader: () => {
							binary.shellReads += 1;
							return SHELL;
						},
						shouldRevalidate: sections.shouldRevalidate,
						children: [
							{
								id: PAGE_ID,
								path: PAGE,
								action: smtp.clientAction as never,
								shouldRevalidate: smtp.shouldRevalidate,
								Component: UNSAFE_withComponentProps(smtp.default as never)
							}
						]
					}
				]
			}
		],
		{ initialEntries: [PAGE] }
	);
	await vi.waitFor(() => expect(router.state.initialized).toBe(true));
	return router;
}

type Landed = { readonly navigation: string; readonly page: string };

function pressing(host: string): FormData {
	const posted = new FormData();
	posted.set('intent', STORE);
	posted.set(VALUE_FIELD('SMTP_HOST'), host);
	posted.set(VALUE_FIELD('SMTP_USERNAME'), 'receipts');
	posted.set(VALUE_FIELD('SMTP_PASSWORD'), 'secret');
	posted.set(VALUE_FIELD('MAIL_FROM'), 'receipts@example.org');
	return posted;
}

async function saved(router: DataRouter, posted: FormData): Promise<Landed> {
	let landed: Landed | null = null;
	const off = router.subscribe((state) => {
		if (landed !== null || state.actionData?.[PAGE_ID] === undefined) return;
		landed = {
			navigation: state.navigation.state,
			page: renderToString(createElement(RouterProvider, { router }))
		};
	});
	try {
		await router.navigate(PAGE, { formMethod: 'post', formData: posted, preventScrollReset: true });
		await vi.waitFor(() => expect(router.state.navigation.state).toBe('idle'));
	} finally {
		off();
	}
	if (landed === null) throw new Error('the answer never landed');
	return landed;
}

function input(page: string, id: string): string {
	const found = page.match(new RegExp(`<input\\b[^>]*id="${id}"[^>]*>`));
	if (found === null) throw new Error(`no input ${id}`);
	return found[0];
}

describe('the mail page, on the render a credentials answer lands in', () => {
	it('leaves the refused box open when the reading turned the value down before anything was sent', async () => {
		const router = await open();
		try {
			const before = binary.shellReads;
			const { navigation, page } = await saved(router, pressing('   '));

			expect(navigation).toBe('idle');
			expect(binary.shellReads).toBe(before);
			expect(input(page, HOST)).not.toMatch(/\sdisabled=/);
			expect(page).toContain('only spaces');
		} finally {
			router.dispose();
		}
	});

	it('leaves the boxes open while a write the deployment refused is re-read', async () => {
		binary.written = { kind: 'refused', detail: 'no' };
		const router = await open();
		try {
			const before = binary.shellReads;
			const { navigation, page } = await saved(router, pressing('smtp.other.example'));

			expect(navigation).toBe('loading');
			expect(binary.shellReads).toBe(before + 1);
			expect(input(page, HOST)).not.toMatch(/\sdisabled=/);
		} finally {
			router.dispose();
		}
	});

	it('holds the boxes closed while another press on the page is re-read', async () => {
		const router = await open();
		try {
			const posted = new FormData();
			posted.set('intent', TEST_EMAIL_INTENT);
			posted.set(TEST_TO_FIELD, 'alerts@example.org');
			const { navigation, page } = await saved(router, posted);

			expect(navigation).toBe('loading');
			expect(input(page, HOST)).toMatch(/\sdisabled=/);
		} finally {
			router.dispose();
		}
	});

	it('holds the boxes closed while a write that landed is re-read', async () => {
		binary.written = { kind: 'set' };
		const router = await open();
		try {
			const { navigation, page } = await saved(router, pressing('smtp.other.example'));

			expect(navigation).toBe('loading');
			expect(input(page, HOST)).toMatch(/\sdisabled=/);
		} finally {
			router.dispose();
		}
	});
});
