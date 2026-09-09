import { receipt, testSend } from '@better-giving/emails';
import { renderEmail } from '@better-giving/emails/render';
import { describe, expect, it } from 'vitest';

// that a template renders on the runtime this app actually sends from.
//
// the workers pool for a spec that touches no database, which is the one exception to
// CONTRIBUTING.md's split and is named there. `@better-giving/emails` renders jsx through
// react-dom's server renderer and strips a plain-text arm out of the markup, and the package's own
// specs run both in node — node proves they work in node. a receipt is rendered inside workerd, on
// a request that has already committed a gift to the ledger, and nothing but workerd answers
// whether the renderer resolves there at all.
//
// so it asserts almost nothing about content — that is
// packages/emails/src/templates/receipt.spec.tsx's, and repeating it here would be a second copy
// of the words on a tax document.

const CONTRIBUTION = {
	totalMinor: 10_000,
	nonDeductibleMinor: 0,
	currency: 'USD',
	receivedAt: new Date('2026-01-05T12:00:00Z')
};

const ORG = {
	legalName: 'Hope Foundation',
	taxId: '12-3456789',
	addressLine1: '1 Charity Way',
	addressLine2: null,
	city: 'Springfield',
	region: 'IL',
	postalCode: '62701',
	country: 'United States'
};

describe('rendering a template inside workerd', () => {
	// the arm a template hands over itself: the receipt's text is its own, laid out in a column
	// nothing strips markup into. the html assertions are the proof the renderer ran; the text one
	// only that the arm came through untouched.
	it('renders a receipt, both arms', async () => {
		const message = await renderEmail(
			receipt.template({
				org: ORG,
				donorName: 'Ada Lovelace',
				contribution: CONTRIBUTION,
				goodsOrServices: { kind: 'none' },
				tribute: null,
				program: null
			})
		);

		expect(message.subject).toContain('Hope Foundation');
		expect(message.html).toContain(message.subject);
		expect(message.html).toContain('USD 100.00');
		expect(message.text).toContain('USD 100.00');
	});

	// and the arm the package derives: the test send hands no text of its own, so what comes back
	// is html-to-text having run on workerd over markup react-dom produced there.
	it('renders the test send, stripping its own text arm', async () => {
		const message = await renderEmail(testSend.template());

		expect(message.subject).not.toBe('');
		expect(message.html).toContain(message.subject);
		expect(message.text).toContain('Hi from your Better Giving deployment');
		expect(message.text).not.toContain('<p');
	});
});
