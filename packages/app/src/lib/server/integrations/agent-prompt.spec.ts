import { describe, expect, it } from 'vitest';
import { WEBHOOK_EVENT_TYPES } from '../../webhooks/catalog';
import { WEBHOOK_POST_TIMEOUT_MS } from '../webhooks/deliver';
import { API_KEY_VARIABLE, agentPromptFor, WEBHOOK_SECRET_VARIABLE } from './agent-prompt';
import { WEBHOOK_EVENT_DATA } from './openapi';

// the prompt an organisation's developer pastes into an AI coding agent, held to the deployment it
// names. src/routes/integrations.openapi[.]json.workers.spec.ts follows its instructions against a
// real key.

const ORIGIN = 'https://give.example.org';
const prompt = agentPromptFor(ORIGIN);

describe('agentPromptFor()', () => {
	it('names this deployment by the request’s own origin', () => {
		expect(prompt).toContain(`${ORIGIN}/integrations/v1/gifts`);
	});

	it('points at the OpenAPI document as the whole contract', () => {
		expect(prompt).toContain(`${ORIGIN}/integrations/openapi.json`);
	});

	it('says how to present the key, where it comes from, and that it stays on a server', () => {
		expect(prompt).toContain('Authorization: Bearer');
		expect(prompt).toContain('Integrations → API');
		expect(prompt).toMatch(/never in a browser/);
	});

	it('says how to keep a copy in sync', () => {
		expect(prompt).toContain('`resume_updated_since`');
		expect(prompt).toContain('`updated_since`');
		expect(prompt).toContain('`next_cursor`');
	});

	it('spells out the webhook signature, the retries and the pause', () => {
		expect(prompt).toContain('HMAC-SHA256');
		expect(prompt).toContain('{webhook-id}.{webhook-timestamp}.{body}');
		expect(prompt).toContain('`whsec_`');
		expect(prompt).toContain('1 minute, 5 minutes, 30 minutes, 2 hours, 5 hours');
		expect(prompt).toContain('72 hours');
	});

	it('names every event a destination can be sent, and the record each one carries', () => {
		for (const type of WEBHOOK_EVENT_TYPES) {
			const line = prompt.split('\n').find((text) => text.startsWith(`- \`${type}\``));
			const { at } = WEBHOOK_EVENT_DATA[type].record;
			expect(line).toContain(`keep the latest per \`${at}.id\` by \`${at}.updated_at\``);
		}
	});

	it('says how long a receiver has to answer', () => {
		expect(prompt).toContain(`within ${WEBHOOK_POST_TIMEOUT_MS / 1_000} seconds`);
	});

	it('has the developer set both secrets in the environment themselves, before the conversation', () => {
		expect(prompt).toContain(`export ${API_KEY_VARIABLE}=`);
		expect(prompt).toContain(`export ${WEBHOOK_SECRET_VARIABLE}=`);
		expect(prompt).toContain(`"Authorization: Bearer $${API_KEY_VARIABLE}"`);
		expect(prompt).toMatch(/unset/);
	});

	it('never has the agent ask for a secret or print one', () => {
		expect(prompt).not.toMatch(/ask (the user|them|the developer) for (it|a live one|the key)/i);
		expect(prompt).toMatch(/never ask for either/i);
	});
});
