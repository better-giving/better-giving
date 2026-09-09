import { describe, expect, it } from 'vitest';
import { renderEmail } from '../render';
import * as adminAlert from './admin-alert';
import type { AdminAlertData } from './admin-alert';

function data(overrides: Partial<AdminAlertData> = {}): AdminAlertData {
	return {
		headline: 'A Stripe webhook could not be processed',
		body: 'One payment event was received and not recorded. The books are unchanged.',
		facts: [{ label: 'Event', value: 'evt_123' }],
		action: 'Replay the event from the Stripe dashboard.',
		...overrides
	};
}

/** renders both arms. */
function rendered(overrides: Partial<AdminAlertData> = {}) {
	return renderEmail(adminAlert.template(data(overrides)));
}

describe('adminAlert.template', () => {
	it('uses the headline as the subject, with no bracketed prefix', async () => {
		const message = await rendered();
		expect(message.subject).toBe('A Stripe webhook could not be processed');
	});

	it('carries the headline, body, facts and action in both arms', async () => {
		const message = await rendered();
		for (const arm of [message.text, message.html]) {
			expect(arm).toContain('A Stripe webhook could not be processed');
			expect(arm).toContain('The books are unchanged.');
			expect(arm).toContain('Event: evt_123');
			expect(arm).toContain('Replay the event from the Stripe dashboard.');
		}
	});

	// both arms, always — the same rule the receipt keeps, for the plainer reason that an
	// operator's client is whatever their organisation runs.
	it('always produces both arms', async () => {
		const message = await rendered();
		expect(message.text.length).toBeGreaterThan(0);
		// the doctype is the one react-email writes and not one this package chose, so the claim is
		// that there is one and that `<html>` follows.
		expect(message.html.toLowerCase()).toContain('<!doctype html');
		expect(message.html).toContain('<html');
	});

	/**
	 * it never refuses, which is the asymmetry with the receipt. this is the message that
	 * reports the state of a deployment nobody has finished setting up — the send test the
	 * console offers on a fresh install is its first ever use — so it cannot need an organisation
	 * profile, or a legal name, or anything but what it was handed.
	 */
	it('renders with no facts and nothing to do', async () => {
		const message = await rendered({
			headline: 'Test email',
			body: 'Email is working.',
			facts: [],
			action: null
		});
		expect(message.subject).toBe('Test email');
		expect(message.text).toContain('Email is working.');
		expect(message.text).not.toContain('What to do');
		expect(message.html).not.toContain('What to do');
	});

	/**
	 * the shape a message about a gift that settled takes: facts to read, nothing to do.
	 *
	 * the two blocks are decided independently, so "no facts and no action" does not cover it —
	 * a template that hid the facts along with the action would print a notice naming no amount,
	 * no donor and no form.
	 */
	it('prints the facts of a message that asks for nothing', async () => {
		const message = await rendered({
			headline: 'A gift of USD 100.00 was received',
			body: 'The gift is in the books.',
			facts: [{ label: 'Amount', value: 'USD 100.00' }],
			action: null
		});
		for (const arm of [message.text, message.html]) {
			expect(arm).toContain('Amount: USD 100.00');
			expect(arm).not.toContain('What to do');
		}
	});

	// a fact's value is frequently something a third party sent — an error string off a
	// webhook, a host's SMTP reply — and it lands in markup.
	it('escapes every value in the HTML arm', async () => {
		const message = await rendered({
			headline: '<script>alert(1)</script>',
			facts: [{ label: 'Reply', value: '550 <bad> & worse' }],
			action: '<b>fix it</b>'
		});
		expect(message.html).not.toContain('<script>');
		expect(message.html).toContain('550 &lt;bad&gt; &amp; worse');
		expect(message.html).not.toContain('<b>fix it</b>');
	});
});
