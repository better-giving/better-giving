import { describe, expect, it } from 'vitest';
import { renderEmail } from '../render';
import * as testSend from './test-send';

/** the one line the body is. */
const LINE = 'Hi from your Better Giving deployment :)';

describe('testSend.template', () => {
	it('says what the message is in the subject', async () => {
		const message = await renderEmail(testSend.template());
		expect(message.subject).toBe('Test email from your deployment');
	});

	it('carries the one line in both arms', async () => {
		const message = await renderEmail(testSend.template());
		expect(message.text).toContain(LINE);
		expect(message.html).toContain(LINE);
	});
});
