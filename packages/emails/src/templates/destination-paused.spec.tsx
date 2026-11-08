import { describe, expect, it } from 'vitest';
import { renderEmail } from '../render';
import * as destinationPaused from './destination-paused';
import type { DestinationPausedData } from './destination-paused';

const ADDRESS = 'https://crm.example.org/hooks/gifts';
const PATH = '/admin/integrations/webhooks/01926f3a-5b2c-7d4e-8f90-1a2b3c4d5e6f';
const LINK = `https://donate.example.org${PATH}`;

function data(overrides: Partial<DestinationPausedData> = {}): DestinationPausedData {
	return {
		url: ADDRESS,
		cause: { reason: 'failing', days: 3 },
		destinationPath: PATH,
		origin: 'https://donate.example.org',
		...overrides
	};
}

function rendered(overrides: Partial<DestinationPausedData> = {}) {
	return renderEmail(destinationPaused.template(data(overrides)));
}

describe('destinationPaused.template', () => {
	it('says a webhook destination was paused, in the subject and the heading', async () => {
		const message = await rendered();
		expect(message.subject).toBe('A webhook destination was paused');
		expect(message.text).toContain('A webhook destination was paused');
	});

	it('says every delivery failed for as long as the pause rule waits', async () => {
		const message = await rendered({ cause: { reason: 'failing', days: 3 } });
		for (const arm of [message.text, message.html]) {
			expect(arm).toContain('Every delivery to');
			expect(arm).toContain('has failed for 3 days');
			expect(arm).not.toContain('no longer exists');
		}
	});

	it('says the destination answered that it no longer exists', async () => {
		const message = await rendered({ cause: { reason: 'gone' } });
		for (const arm of [message.text, message.html]) {
			expect(arm).toContain('answered that it no longer exists');
			expect(arm).not.toContain('has failed for');
		}
	});

	it('names the destination by its URL in a mono chip, never in quote marks', async () => {
		const message = await rendered();
		expect(message.html).toMatch(
			new RegExp(`<code style="[^"]*font-family:[^"]*Red Hat Mono[^"]*">${ADDRESS}</code>`)
		);
		for (const arm of [message.text, message.html]) {
			expect(arm).not.toMatch(/["“”‘’']https:\/\/crm/);
		}
	});

	it('says new events are held, not lost, and that resuming re-sends them', async () => {
		const message = await rendered();
		for (const arm of [message.text, message.html]) {
			expect(arm).toContain('held, not lost');
			expect(arm).toContain('Resuming it sends everything that was held');
		}
	});

	it('sends the operator to the destination’s own page to resume it, never the list', async () => {
		const message = await rendered();
		for (const arm of [message.text, message.html]) {
			expect(arm).toContain('resume it from the destination’s page');
			expect(arm).not.toContain('Webhooks page');
		}
	});

	it('links to the destination’s page, printing the address once in the text arm', async () => {
		const message = await rendered();
		expect(message.html).toContain(`href="${LINK}"`);
		expect(message.text.split(LINK).length - 1).toBe(1);
	});

	// the deployment knows its own address only where an operator pinned one; a mail with no
	// address to link still says where the page is.
	it('names the page by its path where the deployment’s address is unknown', async () => {
		const message = await rendered({ origin: null });
		expect(message.html).not.toContain('href=');
		for (const arm of [message.text, message.html]) {
			expect(arm).toContain(PATH);
			expect(arm).toContain('under Integrations, then Webhooks');
		}
	});

	it('escapes the ADDRESS in the HTML arm', async () => {
		const message = await rendered({ url: 'https://x.example/<b>&' });
		expect(message.html).toContain('https://x.example/&lt;b&gt;&amp;');
		expect(message.html).not.toContain('<b>&');
	});
});
