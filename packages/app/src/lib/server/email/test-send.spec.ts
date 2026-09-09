import { describe, expect, it } from 'vitest';
import type { EmailMessage, SendResult } from './provider';
import { sendTestEmail, testSendStatus } from './test-send';

// the test send as a value: a destination and a send, both handed in.
//
// no SMTP host and no platform, which is the whole reason the act is a module — the surface that
// presses it builds its own provider per request from its own env, and what is worth asserting
// here is the message and the reading of what the transport said rather than that wiring.
// ../../../routes/console.workers.spec.ts is where the wiring and the destination's own rule are
// asserted against a real request.

/** a send that records what it was handed and reports it left. */
function accepting() {
	const sent: EmailMessage[] = [];
	return {
		sent,
		send: async (message: EmailMessage): Promise<SendResult> => {
			sent.push(message);
			return { ok: true };
		}
	};
}

describe('the test send', () => {
	it('sends one message, to the address the press named and nowhere else', async () => {
		const mail = accepting();
		const report = await sendTestEmail({ to: 'ops@hope.example', send: mail.send });

		expect(report.outcome).toBe('sent');
		expect(mail.sent.map((message) => message.to)).toEqual(['ops@hope.example']);
		expect(report.to).toBe('ops@hope.example');
		expect(report.detail).toBeNull();
	});

	/**
	 * both arms are required by the port and neither is a courtesy: a client with no HTML support
	 * has to read the same line.
	 */
	it('says what it is in both arms', async () => {
		const mail = accepting();
		await sendTestEmail({ to: 'ops@hope.example', send: mail.send });
		const message = mail.sent[0];

		expect(message?.subject).toContain('Test');
		expect(message?.text).toContain('Better Giving deployment');
		expect(message?.html).toContain(message?.subject ?? '');
	});

	/**
	 * the whole point of the change this message is: it checks a mail host and reports nothing
	 * else. a figure is what a receipt cannot be rendered without, so a body carrying one is a
	 * sample gift growing back.
	 */
	it('puts no figure and no gift on it', async () => {
		const mail = accepting();
		await sendTestEmail({ to: 'ops@hope.example', send: mail.send });
		const text = mail.sent[0]?.text ?? '';

		expect(text).not.toMatch(/\d/);
		expect(text.toLowerCase()).not.toContain('donation');
		expect(text.toLowerCase()).not.toContain('gift');
	});

	/**
	 * CLAUDE.md: a body that reports a failure names the offending value and where to fix it. those
	 * sentences are written once, in the port, and a friendlier paraphrase would throw away the only
	 * actionable part.
	 */
	it('repeats the port’s own sentence verbatim when the send did not land', async () => {
		const report = await sendTestEmail({
			to: 'ops@hope.example',
			send: async () => ({
				ok: false,
				reason: 'not_configured',
				detail: 'SMTP_HOST is not set. Run `pnpm run deploy --var SMTP_HOST:<value>`.',
				indeterminate: false
			})
		});

		expect(report.outcome).toBe('failed');
		expect(report.detail).toContain('SMTP_HOST');
		// and where it would have gone, so a console reports the address it actually tried.
		expect(report.to).toBe('ops@hope.example');
	});
});

describe('the status a report is answered under', () => {
	/**
	 * one mapping for every surface that presses this. the arm that sent is the only one that is
	 * not a failure — unconfigured mail is a failure and no outcome beside it may say otherwise.
	 */
	it('answers the arm that sent, and only it, as a success', () => {
		expect(testSendStatus('sent')).toBe(200);
		expect(testSendStatus('failed')).toBe(500);
	});
});
