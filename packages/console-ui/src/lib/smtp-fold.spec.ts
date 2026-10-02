import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { DeployedVar } from '../api/types';
import { orgBoxes } from './org-fields';
import { groupIntent, MAIL_GROUP, SECRET_GROUPS } from './secret-groups';
import { SmtpFold, TEST_EMAIL_INTENT } from './smtp-fold';
import { FREE_INTENT } from './withheld-values';

// the mail screen's press that frees a withheld value, as markup. ../../vite.config.ts pins `node`
// and there is no dom, so the press is read by the attribute it is drawn holding, which is
// ./withheld-values.spec.ts's arrangement; the press its click handler turns away is read by
// ../closed-while-writing.spec.ts.

const MAIL = SECRET_GROUPS.find((group) => group.id === MAIL_GROUP);
if (MAIL === undefined) throw new Error('no mail group in ./secret-groups.ts');

/** every mail value stored, and the password held in a form nothing can read back. */
const VARS: DeployedVar[] = [
	{ name: 'SMTP_HOST', kind: 'value', value: 'smtp.example.org' },
	{ name: 'SMTP_PORT', kind: 'value', value: '587' },
	{ name: 'SMTP_USERNAME', kind: 'value', value: 'receipts' },
	{ name: 'SMTP_PASSWORD', kind: 'withheld' },
	{ name: 'MAIL_FROM', kind: 'value', value: 'Riverbank Trust <receipts@example.org>' }
];

/** the fold on a page of its own, with `pending` in flight. */
function drawn(pending: string | null): string {
	const router = createMemoryRouter([
		{
			path: '/',
			Component: () =>
				createElement(SmtpFold, {
					values: { vars: { kind: 'read', vars: VARS } },
					workerName: 'better-giving',
					accountName: 'Riverbank Trust',
					stored: orgBoxes({ notification_email: 'alerts@example.org' }),
					secrets: null,
					freed: null,
					test: null,
					pending
				})
		}
	]);
	return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

const REMOVE = /<button[^>]*>(?:(?!<\/button>).)*Remove SMTP_PASSWORD/s;

/** the Remove press as drawn. */
const remove = (pending: string | null): string => {
	const tag = drawn(pending).match(REMOVE)?.[0];
	expect(tag).toBeDefined();
	return tag as string;
};

describe('the press that frees a withheld mail value', () => {
	it('is held while the credentials press beside it is writing', () => {
		expect(remove(groupIntent(MAIL))).toContain('aria-disabled="true"');
	});

	it('stands open while a test send is on its way, which writes nowhere these values are', () => {
		expect(remove(TEST_EMAIL_INTENT)).not.toContain('aria-disabled');
	});

	it('is held while it is itself writing, and says it is busy', () => {
		const tag = remove(FREE_INTENT);
		expect(tag).toContain('aria-disabled="true"');
		expect(tag).toContain('aria-busy="true"');
	});

	it('stands open where nothing is writing', () => {
		expect(remove(null)).not.toContain('aria-disabled');
	});
});
