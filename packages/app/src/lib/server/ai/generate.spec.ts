import { setCommand } from '@better-giving/operator/deploy-split';
import { describe, expect, it, vi } from 'vitest';
import { generate } from './generate';

/** a binding whose calls answer with `replies` in turn, throwing each one that is an `Error`. */
function answering(...replies: unknown[]) {
	const run = vi.fn();
	for (const reply of replies) {
		run.mockImplementationOnce(async () => {
			if (reply instanceof Error) throw reply;
			return reply;
		});
	}
	return { run };
}

/** a chat-completions reply, the shape gpt-oss and GPT answer in. */
function completion(content: string | null, finish_reason = 'stop') {
	return { choices: [{ message: { role: 'assistant', content }, finish_reason }] };
}

const GPT_OSS = '@cf/openai/gpt-oss-120b';
const LLAMA = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const REQUEST = {
	system: 'You write donation pages.',
	messages: [{ role: 'user', content: 'A page for the food bank.' }]
} as const;

describe('the model a deployment answers with', () => {
	it('is gpt-oss-120b on Workers AI when nothing is chosen, called through the default gateway', async () => {
		const AI = answering(completion('A page.'));

		const result = await generate({ AI }, REQUEST);

		expect(result).toEqual({ ok: true, text: 'A page.', model: GPT_OSS, fellBack: false });
		expect(AI.run).toHaveBeenCalledOnce();
		const [model, input, options] = AI.run.mock.calls[0] ?? [];
		expect(model).toBe(GPT_OSS);
		expect(input).toEqual({
			messages: [
				{ role: 'system', content: 'You write donation pages.' },
				{ role: 'user', content: 'A page for the food bank.' }
			],
			max_tokens: 8192,
			reasoning_effort: 'low'
		});
		expect(options).toEqual({ gateway: { id: 'default' } });
	});

	it('is Llama 3.3 on Workers AI when the console chose it', async () => {
		const AI = answering({ response: 'A page.' });

		const result = await generate({ AI, AI_MODEL: LLAMA }, REQUEST);

		expect(result).toEqual({ ok: true, text: 'A page.', model: LLAMA, fellBack: false });
		const [model, input, options] = AI.run.mock.calls[0] ?? [];
		expect(model).toBe(LLAMA);
		expect(input.messages).toEqual([
			{ role: 'system', content: 'You write donation pages.' },
			{ role: 'user', content: 'A page for the food bank.' }
		]);
		expect(options).toEqual({ gateway: { id: 'default' } });
	});

	it('is Claude through the default gateway when the console chose Claude', async () => {
		const AI = answering({
			content: [
				{ type: 'text', text: 'A page ' },
				{ type: 'text', text: 'for you.' }
			]
		});

		const result = await generate({ AI, AI_MODEL: 'anthropic/claude-sonnet-4.6' }, REQUEST);

		expect(result).toEqual({
			ok: true,
			text: 'A page for you.',
			model: 'anthropic/claude-sonnet-4.6',
			fellBack: false
		});
		const [model, input, options] = AI.run.mock.calls[0] ?? [];
		expect(model).toBe('anthropic/claude-sonnet-4.6');
		// the Messages API takes the system prompt beside the messages, and refuses a request
		// with no ceiling on the reply.
		expect(input.system).toBe('You write donation pages.');
		expect(input.messages).toEqual([{ role: 'user', content: 'A page for the food bank.' }]);
		expect(input.max_tokens).toBeGreaterThan(0);
		expect(options).toEqual({ gateway: { id: 'default' } });
	});

	it('is GPT through the default gateway when the console chose GPT', async () => {
		const AI = answering({ choices: [{ message: { role: 'assistant', content: 'A page.' } }] });

		const result = await generate({ AI, AI_MODEL: 'openai/gpt-5-mini' }, REQUEST);

		expect(result).toEqual({
			ok: true,
			text: 'A page.',
			model: 'openai/gpt-5-mini',
			fellBack: false
		});
		const [model, input, options] = AI.run.mock.calls[0] ?? [];
		expect(model).toBe('openai/gpt-5-mini');
		expect(input.messages).toEqual([
			{ role: 'system', content: 'You write donation pages.' },
			{ role: 'user', content: 'A page for the food bank.' }
		]);
		// GPT-5 models refuse `max_tokens` and take this name for the same ceiling.
		expect(input.max_tokens).toBeUndefined();
		expect(input.max_completion_tokens).toBeGreaterThan(0);
		expect(options).toEqual({ gateway: { id: 'default' } });
	});

	it('is refused, naming the value and where it is set, when the choice is off the list', async () => {
		const AI = answering({ response: 'never asked' });

		const result = await generate({ AI, AI_MODEL: 'anthropic/claude-opus-9' }, REQUEST);

		expect(result).toMatchObject({
			ok: false,
			reason: 'off_list',
			model: 'anthropic/claude-opus-9'
		});
		if (result.ok) return;
		expect(result.operatorFix).toContain('`anthropic/claude-opus-9`');
		expect(result.operatorFix).toContain('console');
		expect(result.operatorFix).toContain(`\`${setCommand('AI_MODEL')}\``);
		expect(AI.run).not.toHaveBeenCalled();
	});

	it('is called on the binding of the env each call is handed, and no other', async () => {
		const first = answering(completion('first'));
		const second = answering(completion('second'));

		expect(await generate({ AI: first }, REQUEST)).toMatchObject({ text: 'first' });
		expect(await generate({ AI: second }, REQUEST)).toMatchObject({ text: 'second' });
		expect(first.run).toHaveBeenCalledOnce();
		expect(second.run).toHaveBeenCalledOnce();
	});
});

describe('a deployment uploaded without the Workers AI binding', () => {
	it('is refused, telling the operator to deploy this release, rather than thrown', async () => {
		const result = await generate({ AI_MODEL: 'anthropic/claude-sonnet-4.6' }, REQUEST);

		expect(result).toMatchObject({
			ok: false,
			reason: 'not_bound',
			model: 'anthropic/claude-sonnet-4.6'
		});
		if (result.ok) return;
		expect(result.operatorFix).toContain('`AI`');
	});

	// what a local dev server binds when no remote session was opened: the binding exists and every
	// call throws this (miniflare's remote-proxy-client worker).
	it('is refused the same way when the binding is the local stand-in, and tries no other model', async () => {
		const AI = answering(new Error('Binding AI needs to be run remotely'));

		const result = await generate({ AI, AI_MODEL: 'anthropic/claude-sonnet-4.6' }, REQUEST);

		expect(result).toMatchObject({ ok: false, reason: 'not_bound' });
		if (result.ok) return;
		expect(result.operatorFix).toContain('BETTER_GIVING_REMOTE_AI=1');
		expect(AI.run).toHaveBeenCalledOnce();
	});
});

describe('a request for JSON', () => {
	const SCHEMA = {
		type: 'object',
		properties: { headline: { type: 'string' } },
		required: ['headline']
	};

	it('asks the default model in JSON mode, under the name chat completions give it', async () => {
		const AI = answering(completion('{"headline":"Feed a family"}'));

		const result = await generate({ AI }, { ...REQUEST, jsonSchema: SCHEMA });

		expect(result).toMatchObject({ ok: true, text: '{"headline":"Feed a family"}' });
		const [, input] = AI.run.mock.calls[0] ?? [];
		expect(input.response_format).toEqual({
			type: 'json_schema',
			json_schema: { name: 'reply', schema: SCHEMA }
		});
	});

	it('asks Llama in JSON mode, and hands back the object it answers as text', async () => {
		const AI = answering({ response: { headline: 'Feed a family' } });

		const result = await generate({ AI, AI_MODEL: LLAMA }, { ...REQUEST, jsonSchema: SCHEMA });

		expect(result).toMatchObject({ ok: true, text: '{"headline":"Feed a family"}' });
		const [, input] = AI.run.mock.calls[0] ?? [];
		expect(input.response_format).toEqual({ type: 'json_schema', json_schema: SCHEMA });
	});

	describe('sends a schema without `propertyNames`, which Workers AI JSON mode refuses with a 400', () => {
		const record = { type: 'object', propertyNames: { type: 'string' }, additionalProperties: {} };
		const withRecords = {
			type: 'object',
			properties: { doc: record, list: { type: 'array', items: { anyOf: [record] } } },
			$defs: { value: record }
		};
		const kept = { type: 'object', additionalProperties: {} };
		const stripped = {
			type: 'object',
			properties: { doc: kept, list: { type: 'array', items: { anyOf: [kept] } } },
			$defs: { value: kept }
		};

		it('to the default model', async () => {
			const AI = answering(completion('{}'));

			await generate({ AI }, { ...REQUEST, jsonSchema: withRecords });

			const [, input] = AI.run.mock.calls[0] ?? [];
			expect(input.response_format.json_schema.schema).toEqual(stripped);
		});

		it('to Llama', async () => {
			const AI = answering({ response: {} });

			await generate({ AI, AI_MODEL: LLAMA }, { ...REQUEST, jsonSchema: withRecords });

			const [, input] = AI.run.mock.calls[0] ?? [];
			expect(input.response_format.json_schema).toEqual(stripped);
		});
	});

	it('asks GPT in its own JSON mode', async () => {
		const AI = answering({ choices: [{ message: { content: '{"headline":"Feed a family"}' } }] });

		const result = await generate(
			{ AI, AI_MODEL: 'openai/gpt-5-mini' },
			{ ...REQUEST, jsonSchema: SCHEMA }
		);

		expect(result).toMatchObject({ ok: true, text: '{"headline":"Feed a family"}' });
		const [, input] = AI.run.mock.calls[0] ?? [];
		expect(input.response_format).toEqual({
			type: 'json_schema',
			json_schema: { name: 'reply', schema: SCHEMA }
		});
	});

	it('asks Claude without one, since the Messages API has no JSON mode', async () => {
		const AI = answering({ content: [{ type: 'text', text: '{"headline":"Feed a family"}' }] });

		const result = await generate(
			{ AI, AI_MODEL: 'anthropic/claude-sonnet-4.6' },
			{ ...REQUEST, jsonSchema: SCHEMA }
		);

		expect(result).toMatchObject({ ok: true, text: '{"headline":"Feed a family"}' });
		const [, input] = AI.run.mock.calls[0] ?? [];
		expect(input).not.toHaveProperty('response_format');
	});
});

describe('a chosen model that fails', () => {
	it('is answered by the default model, marked as a fallback, when the chosen one is credit-billed', async () => {
		const AI = answering(new Error('AiError: 402 insufficient credits'), completion('A page.'));

		const result = await generate({ AI, AI_MODEL: 'anthropic/claude-sonnet-4.6' }, REQUEST);

		expect(result).toEqual({ ok: true, text: 'A page.', model: GPT_OSS, fellBack: true });
		expect(AI.run).toHaveBeenCalledTimes(2);
		const [model, input, options] = AI.run.mock.calls[1] ?? [];
		expect(model).toBe(GPT_OSS);
		// the same request, in the default model's own shape.
		expect(input.messages).toEqual([
			{ role: 'system', content: 'You write donation pages.' },
			{ role: 'user', content: 'A page for the food bank.' }
		]);
		expect(options).toEqual({ gateway: { id: 'default' } });
	});

	it('is refused rather than thrown when the default model fails', async () => {
		const AI = answering(new Error('AiError: 3040: capacity temporarily exceeded'));

		const result = await generate({ AI }, REQUEST);

		expect(result).toMatchObject({ ok: false, reason: 'unavailable', model: GPT_OSS });
		expect(AI.run).toHaveBeenCalledOnce();
	});

	it('is refused rather than thrown when the default model fails after a credit-billed one did', async () => {
		const AI = answering(new Error('credits'), new Error('capacity'));

		const result = await generate({ AI, AI_MODEL: 'openai/gpt-5-mini' }, REQUEST);

		expect(result).toMatchObject({ ok: false, reason: 'unavailable', model: 'openai/gpt-5-mini' });
		expect(AI.run).toHaveBeenCalledTimes(2);
	});

	it.each([
		['no reply field', undefined, {}],
		['no choice', undefined, { choices: [] }],
		['a choice with no content, its reasoning having spent the reply', undefined, completion(null)],
		['no reply field', LLAMA, {}],
		['an empty reply', LLAMA, { response: '' }],
		['a reply that is not text', LLAMA, { response: 42 }]
	])('counts %s as no answer from %s', async (_, model, reply) => {
		const AI = answering(reply);

		expect(await generate({ AI, AI_MODEL: model }, REQUEST)).toMatchObject({
			ok: false,
			reason: 'unavailable'
		});
	});

	it('counts a credit-billed reply with no text as a failure, and falls back', async () => {
		const AI = answering({ choices: [] }, completion('A page.'));

		const result = await generate({ AI, AI_MODEL: 'openai/gpt-5-mini' }, REQUEST);

		expect(result).toMatchObject({ ok: true, text: 'A page.', fellBack: true });
	});

	describe('a reply cut off at the ceiling on its length', () => {
		/** a binding that answers whatever ceiling it was asked for, spent to the last token. */
		function spendingTheCeiling() {
			return {
				run: vi.fn(async (_: string, input: Record<string, unknown>) => ({
					response: '{"headline":"Feed a',
					usage: { completion_tokens: input.max_tokens }
				}))
			};
		}

		it('is no answer from the default model', async () => {
			const AI = answering(completion('{"headline":"Feed a', 'length'));

			expect(await generate({ AI }, REQUEST)).toMatchObject({ ok: false, reason: 'unavailable' });
		});

		it('is no answer from Llama', async () => {
			const AI = spendingTheCeiling();

			expect(await generate({ AI, AI_MODEL: LLAMA }, REQUEST)).toMatchObject({
				ok: false,
				reason: 'unavailable'
			});
		});

		it.each([
			[
				'anthropic/claude-sonnet-4.6',
				{ content: [{ type: 'text', text: '{"headline":"Feed a' }], stop_reason: 'max_tokens' }
			],
			[
				'openai/gpt-5-mini',
				{ choices: [{ message: { content: '{"headline":"Feed a' }, finish_reason: 'length' }] }
			]
		])('is no answer from %s, which falls back', async (model, cut) => {
			const AI = answering(cut, completion('A page.'));

			const result = await generate({ AI, AI_MODEL: model }, REQUEST);

			expect(result).toMatchObject({ ok: true, text: 'A page.', fellBack: true });
		});

		it('is an answer when the model stopped on its own', async () => {
			const AI = answering(
				{ content: [{ type: 'text', text: 'A page.' }], stop_reason: 'end_turn' },
				completion('A page.'),
				{ response: 'A page.', usage: { completion_tokens: 3 } },
				completion('A page.')
			);

			for (const model of ['anthropic/claude-sonnet-4.6', 'openai/gpt-5-mini', LLAMA, undefined]) {
				expect(await generate({ AI, AI_MODEL: model }, REQUEST)).toMatchObject({
					ok: true,
					fellBack: false
				});
			}
		});
	});
});
