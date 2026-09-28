import { describe, expect, it } from 'vitest';
import { WEBHOOK_EVENT_TYPES } from '../../webhooks/catalog';
import { agentPromptFor } from './agent-prompt';

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

	it('names every event a destination can be sent', () => {
		for (const type of WEBHOOK_EVENT_TYPES) expect(prompt).toContain(`\`${type}\``);
	});
});
