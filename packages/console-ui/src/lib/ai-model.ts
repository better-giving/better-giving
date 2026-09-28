import { AI_MODELS, FREE_MODEL, modelById } from '@better-giving/operator/ai-models';
import type { DeployVarName, DeployedVar, ModelCredits } from '../api/types';

// the model the donation page's chat answers from, as this console offers and stores it.

/** the one value this page writes, through the vars press every other value goes through. */
export const MODEL_VAR: DeployVarName = 'AI_MODEL';

/** what the press posts as its intent, and what its outcome is reported against. */
export const MODEL_INTENT = 'ai-model';

/** the radios' shared name, which is what the press reads the choice off. */
export const MODEL_FIELD = 'ai-model';

/** what the page and its rail cell are called. */
export const MODEL_TITLE = 'AI model';

/** where the page is. */
export const MODEL_PAGE = '/ai-model';

/**
 * the id the choice is drawn holding, or `null` where no choice on the list is what the deployment
 * answers with.
 *
 * nothing stored is the free model, which is what the deployment calls then. an id off the list is
 * a refusal on every request that reaches a model rather than a fall back to the free one
 * (packages/operator/src/ai-models.ts), and a value held as a secret cannot be read back, so both
 * draw no choice taken rather than one the deployment is not answering with.
 */
export function chosenModel(row: DeployedVar): string | null {
	if (row.kind === 'absent') return FREE_MODEL.id;
	if (row.kind === 'withheld') return null;
	return modelById(row.value)?.id ?? null;
}

/**
 * what one press puts on the deployment, or `null` where the body names no model on the list.
 *
 * composed from the list and never from the body, so an id off it — which the door refuses with a
 * 400 (`POST /api/values/vars` in packages/console/internal/server/values.go) — cannot be carried
 * whatever the body claimed. the free model is the name taken off rather than stored, because an
 * unset one is what the deployment answers the free model for, and `null` is what deletes a name.
 */
export function modelEdit(posted: FormData): Record<string, string | null> | null {
	const value = posted.get(MODEL_FIELD);
	const model = typeof value === 'string' ? modelById(value) : undefined;
	if (model === undefined) return null;
	return { [MODEL_VAR]: model.id === FREE_MODEL.id ? null : model.id };
}

/** one choice as the page draws it: the free one says so under its name, the rest what they spend. */
export type ModelOption = {
	id: string;
	label: string;
	sub: 'Free' | null;
	note: 'Needs Cloudflare credits' | null;
};

/** every model on the list, in its order, which is the free one first. */
export const modelOptions = (): ModelOption[] =>
	AI_MODELS.map((model) => ({
		id: model.id,
		label: model.label,
		sub: model.creditBilled ? null : 'Free',
		note: model.creditBilled ? 'Needs Cloudflare credits' : null
	}));

/**
 * what the account's credits say beside the choice the deployment holds, or `null` where it spends
 * none.
 *
 * the balance is AI Gateway's, in dollars. at or under zero it can be a debt, so it is reported as
 * no credits with no figure. a balance not read is the binary's own sentence, carried as given: it
 * is cloudflare's words where the read was refused and a fixed one on the browser sign-in, which
 * never asks (`CreditsUnreadOnSignIn` in packages/console/internal/deployment/aimodel.go).
 */
export type CreditsLine =
	| { kind: 'held'; figure: string }
	| { kind: 'missing' }
	| { kind: 'unknown'; detail: string };

const DOLLARS = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function creditsLine(credits: ModelCredits): CreditsLine | null {
	switch (credits.kind) {
		case 'not-asked':
			return null;
		case 'held':
			return { kind: 'held', figure: DOLLARS.format(credits.balance) };
		case 'missing':
			return { kind: 'missing' };
		case 'unknown':
			return { kind: 'unknown', detail: credits.detail };
	}
}
