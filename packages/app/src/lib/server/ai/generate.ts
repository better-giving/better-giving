import {
	AI_MODELS,
	DEFAULT_MODEL,
	modelById,
	type AiModel
} from '@better-giving/operator/ai-models';
import { setCommand } from '@better-giving/operator/deploy-split';
import { readConfigEnv } from '../config/env';

// the one way this deployment asks a model for text.
//
// every call is the Workers AI binding's `run` through AI Gateway's `default` gateway — the default
// model and the credit-billed ones alike, so no provider key exists to store
// (https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/). which model is
// `AI_MODEL`, a plain var the console writes; the list and what each entry costs are
// `@better-giving/operator/ai-models`.
//
// the binding is read off the env a request arrived on, per call, and nothing here holds it: the
// binding is the client, so there is nothing to construct and nothing to keep (CLAUDE.md, Runtime).
//
// nothing here throws. a caller is a screen someone is typing into, and a model that did not
// answer is a sentence on that screen rather than a 500. a credit-billed model that fails for any
// reason is answered by the default one and marked `fellBack`: no binding call reads the credit
// balance, and the error an empty one raises is undocumented, so an empty balance cannot be told
// from any other failure and each is treated as that model being unavailable. the default model
// failing is the end of the line. a reply stopped by the ceiling on its length is no answer
// either: it is text cut part way, and for JSON it does not parse.
//
// a local dev server with no remote session binds a stand-in whose every call throws
// (`LOCAL_STAND_IN` below). that is the same thing as no binding at all, and is refused the same
// way, before any other model is tried.

export interface ChatMessage {
	readonly role: 'user' | 'assistant';
	readonly content: string;
}

export interface GenerateRequest {
	readonly system: string;
	readonly messages: readonly ChatMessage[];
	/**
	 * a JSON Schema the reply should follow. sent as JSON mode where the format has one; Claude's
	 * has none, so its reply is text the caller parses and validates the same way either way.
	 */
	readonly jsonSchema?: Readonly<Record<string, unknown>>;
}

export type GenerateResult =
	| {
			readonly ok: true;
			readonly text: string;
			/** the model that answered, which is the default one whenever `fellBack` is set. */
			readonly model: string;
			/** the chosen credit-billed model failed and the default one answered in its place. */
			readonly fellBack: boolean;
	  }
	| GenerateFailure;

/** a call no model answered, naming the model it asked: `AI_MODEL` as set, or the default one. */
export type GenerateFailure = { readonly model: string } & (
	| {
			readonly ok: false;
			/** `AI_MODEL` names no model on the list. */
			readonly reason: 'off_list';
			readonly operatorFix: string;
	  }
	| {
			readonly ok: false;
			/** the worker was uploaded without the `AI` binding. */
			readonly reason: 'not_bound';
			readonly operatorFix: string;
	  }
	| {
			readonly ok: false;
			/** no model answered, which nothing on this deployment can fix; the logs say why. */
			readonly reason: 'unavailable';
			readonly operatorFix: null;
	  }
);

interface AiBinding {
	run(model: string, input: Record<string, unknown>, options: object): Promise<unknown>;
}

/**
 * the ceiling on a reply, in every format. the Messages API refuses a request without one, and
 * Workers AI's own default is 256 tokens, which cuts a page's JSON off part way.
 */
const MAX_OUTPUT_TOKENS = 8192;

const GATEWAY = { gateway: { id: 'default' } } as const;

export async function generate(source: unknown, request: GenerateRequest): Promise<GenerateResult> {
	const chosen = readConfigEnv(source).AI_MODEL;
	const model = chosen === undefined ? DEFAULT_MODEL : modelById(chosen);
	if (!model) {
		return {
			ok: false,
			reason: 'off_list',
			operatorFix: offListFix(chosen ?? ''),
			model: chosen ?? ''
		};
	}

	const binding = aiBinding(source);
	if (!binding)
		return { ok: false, reason: 'not_bound', operatorFix: NOT_BOUND_FIX, model: model.id };

	const answer = await ask(binding, model, request);
	if (answer.ok) return { ok: true, text: answer.text, model: model.id, fellBack: false };
	if (isLocalStandIn(answer.error)) {
		return { ok: false, reason: 'not_bound', operatorFix: LOCAL_STAND_IN_FIX, model: model.id };
	}
	console.error(`${model.id} did not answer:`, answer.error);

	if (model.creditBilled) {
		const fallback = await ask(binding, DEFAULT_MODEL, request);
		if (fallback.ok) {
			return { ok: true, text: fallback.text, model: DEFAULT_MODEL.id, fellBack: true };
		}
		console.error(`${DEFAULT_MODEL.id} did not answer:`, fallback.error);
	}
	return { ok: false, reason: 'unavailable', operatorFix: null, model: model.id };
}

async function ask(
	binding: AiBinding,
	model: AiModel,
	request: GenerateRequest
): Promise<{ ok: true; text: string } | { ok: false; error: unknown }> {
	try {
		const reply = await binding.run(model.id, input(model, request), GATEWAY);
		const answer = text(model, reply);
		return answer ? { ok: true, text: answer } : { ok: false, error: reply };
	} catch (error) {
		return { ok: false, error };
	}
}

/** the request in the model's own format. */
function input(model: AiModel, request: GenerateRequest): Record<string, unknown> {
	switch (model.format) {
		case 'anthropic-messages':
			return {
				system: request.system,
				messages: request.messages,
				max_tokens: MAX_OUTPUT_TOKENS
			};
		case 'openai-chat':
			// GPT-5 models refuse `max_tokens` and take the same ceiling under this name.
			return {
				messages: [{ role: 'system', content: request.system }, ...request.messages],
				max_completion_tokens: MAX_OUTPUT_TOKENS,
				...(request.jsonSchema && {
					response_format: {
						type: 'json_schema',
						json_schema: { name: 'reply', schema: request.jsonSchema }
					}
				})
			};
		case 'workers-ai-chat':
			// the `reasoning_effort` and `json_schema` shapes are `ChatCompletionsCommonOptions` in
			// worker-configuration.d.ts. reasoning tokens are spent from `max_tokens`, and a page's JSON
			// needs little of it.
			return {
				messages: [{ role: 'system', content: request.system }, ...request.messages],
				max_tokens: MAX_OUTPUT_TOKENS,
				reasoning_effort: 'low',
				...(request.jsonSchema && {
					response_format: {
						type: 'json_schema',
						json_schema: { name: 'reply', schema: withoutPropertyNames(request.jsonSchema) }
					}
				})
			};
		case 'workers-ai':
			// https://developers.cloudflare.com/workers-ai/features/json-mode/
			return {
				messages: [{ role: 'system', content: request.system }, ...request.messages],
				max_tokens: MAX_OUTPUT_TOKENS,
				...(request.jsonSchema && {
					response_format: {
						type: 'json_schema',
						json_schema: withoutPropertyNames(request.jsonSchema)
					}
				})
			};
	}
}

/**
 * the schema with every `propertyNames` dropped, which Workers AI's JSON mode refuses with a 400
 * ("The provided JSON schema contains features not supported by xgrammar.") before inference. it
 * only loosens what is sent: the reply is still validated by the caller. `z.record` emits it.
 */
function withoutPropertyNames(schema: unknown): unknown {
	if (Array.isArray(schema)) return schema.map(withoutPropertyNames);
	if (typeof schema !== 'object' || schema === null) return schema;
	return Object.fromEntries(
		Object.entries(schema)
			.filter(([key]) => key !== 'propertyNames')
			.map(([key, value]) => [key, withoutPropertyNames(value)])
	);
}

/**
 * the reply's text in the model's own format, or `null` where the reply holds none or was stopped
 * by `MAX_OUTPUT_TOKENS`.
 */
function text(model: AiModel, reply: unknown): string | null {
	const body = record(reply);
	switch (model.format) {
		case 'anthropic-messages': {
			if (body.stop_reason === 'max_tokens') return null;
			const blocks = Array.isArray(body.content) ? body.content.map(record) : [];
			const texts = blocks.flatMap((block) => (typeof block.text === 'string' ? [block.text] : []));
			return texts.length > 0 ? texts.join('') : null;
		}
		case 'openai-chat':
		case 'workers-ai-chat': {
			const first = Array.isArray(body.choices) ? record(body.choices[0]) : {};
			if (first.finish_reason === 'length') return null;
			const content = record(first.message).content;
			return typeof content === 'string' ? content : null;
		}
		case 'workers-ai':
			// Workers AI reports no stop reason, so a reply that spent the whole ceiling is read as
			// stopped by it.
			if (Number(record(body.usage).completion_tokens) >= MAX_OUTPUT_TOKENS) return null;
			// in JSON mode `response` arrives already parsed.
			if (typeof body.response === 'string') return body.response;
			return typeof body.response === 'object' && body.response !== null
				? JSON.stringify(body.response)
				: null;
	}
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** the `AI` binding on the env `source` is, or null where there is none. */
export function aiBinding(source: unknown): AiBinding | null {
	const binding = record(source).AI;
	return typeof binding === 'object' &&
		binding !== null &&
		typeof (binding as { run?: unknown }).run === 'function'
		? (binding as AiBinding)
		: null;
}

/**
 * what miniflare's stand-in for a remote-only binding throws on every call
 * (`throwRemoteRequired` in its remote-proxy-client worker).
 */
const LOCAL_STAND_IN = /^Binding \S+ needs to be run remotely$/;

export function isLocalStandIn(error: unknown): boolean {
	return error instanceof Error && LOCAL_STAND_IN.test(error.message);
}

function offListFix(value: string): string {
	return (
		`\`AI_MODEL\` is \`${value}\`, which is not a model this deployment can call. Choose one on ` +
		`the console's model setting, or run \`${setCommand('AI_MODEL')}\` with one of ` +
		`${AI_MODELS.map((model) => `\`${model.id}\``).join(', ')}.`
	);
}

const NOT_BOUND_FIX =
	'This deployment was uploaded without the Workers AI binding `AI`, so no model can be called. ' +
	'Deploy this release again: `better-giving start`, or `pnpm run deploy` from a checkout.';

const LOCAL_STAND_IN_FIX =
	'This dev server has no remote session for the Workers AI binding `AI`, so no model can be ' +
	'called. Run `pnpm run login`, then start it again with `BETTER_GIVING_REMOTE_AI=1`.';
