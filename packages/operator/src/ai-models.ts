// the models a deployment may answer with, and the one `AI_MODEL` names.
//
// a closed list, in this leaf because both ends read it: the deployment calls the chosen one
// (`generate` in packages/app/src/lib/server/ai/generate.ts), and the console offers the choice
// and writes it as the plain var `AI_MODEL` (`DEPLOY_VARS` in ./deploy-split.ts). a second list on
// the console side would be an id the deployment refuses, with nothing able to see the
// disagreement.
//
// every model is called through the Workers AI binding and AI Gateway's `default` gateway, the
// one gateway that creates itself on first use. the first entry is free on Workers AI and is what
// an unset `AI_MODEL` means. the others are billed to the account's Cloudflare credits through
// AI Gateway's unified billing, so no provider key is stored anywhere
// (https://developers.cloudflare.com/ai-gateway/features/unified-billing/). no binding call
// reads the credit balance and the error an empty balance raises is undocumented, so any failure
// of a credit-billed model is answered by the free one.
//
// an id is what an operator's deployment stores, so one taken off this list turns that stored
// value into a refusal until the console writes another.

/**
 * how a model is asked and how it answers, one per provider's native shape.
 *
 * `workers-ai` takes `messages` and answers `{ response }`; `openai-chat` is chat completions,
 * answering `choices[0].message.content`; `anthropic-messages` is the Messages API, with the system
 * prompt beside the messages rather than among them, answering `content[].text`.
 */
export type RequestFormat = 'workers-ai' | 'openai-chat' | 'anthropic-messages';

export interface AiModel {
	/** the id `env.AI.run` takes, and the value `AI_MODEL` holds. */
	readonly id: string;
	/** what the console calls it. */
	readonly label: string;
	readonly format: RequestFormat;
	/** spent from the account's Cloudflare credits, where the free model is not. */
	readonly creditBilled: boolean;
}

export const AI_MODELS = [
	{
		id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
		label: 'Llama 3.3 70B on Workers AI',
		format: 'workers-ai',
		creditBilled: false
	},
	{
		id: 'anthropic/claude-sonnet-4.6',
		label: 'Claude Sonnet 4.6',
		format: 'anthropic-messages',
		creditBilled: true
	},
	{
		id: 'openai/gpt-5-mini',
		label: 'GPT-5 mini',
		format: 'openai-chat',
		creditBilled: true
	}
] as const satisfies readonly AiModel[];

/** what an unset `AI_MODEL` answers with, and what a failed credit-billed call falls back to. */
export const FREE_MODEL: AiModel = AI_MODELS[0];

/** the entry `id` names, or `undefined` for an id off the list. */
export function modelById(id: string): AiModel | undefined {
	return AI_MODELS.find((model) => model.id === id);
}
