import { AI_MODELS, FREE_MODEL } from '@better-giving/operator/ai-models';
import { describe, expect, it } from 'vitest';
import type { DeployedVar } from '../api/types';
import { MODEL_FIELD, chosenModel, creditsLine, modelEdit, modelOptions } from './ai-model';

// the model page as values: which choice the deployment holds, what one press stores, and what the
// account's credits say beside it. this package has no DOM pool (../../vite.config.ts), so the page
// is drawn out of these and they are what is held.

const CLAUDE = 'anthropic/claude-sonnet-4.6';

const stored = (value: string): DeployedVar => ({ name: 'AI_MODEL', kind: 'value', value });

describe('the choice the deployment holds', () => {
	it('is the free model where nothing is stored, which is what the deployment answers with', () => {
		expect(chosenModel({ name: 'AI_MODEL', kind: 'absent' })).toBe(FREE_MODEL.id);
	});

	it('is the stored id where it is one on the list', () => {
		expect(chosenModel(stored(CLAUDE))).toBe(CLAUDE);
		expect(AI_MODELS.map((model) => chosenModel(stored(model.id)))).toEqual(
			AI_MODELS.map((model) => model.id)
		);
	});

	it('is no choice at all for an id off the list, rather than the free model it is not', () => {
		// the deployment refuses such an id rather than falling back, so ticking the free model over
		// it would say the chat answers when it does not.
		expect(chosenModel(stored('openai/gpt-4'))).toBeNull();
	});

	it('is no choice at all for a value held as a secret, which nothing can read back', () => {
		expect(chosenModel({ name: 'AI_MODEL', kind: 'withheld' })).toBeNull();
	});
});

const posted = (value?: string): FormData => {
	const body = new FormData();
	if (value !== undefined) body.set(MODEL_FIELD, value);
	return body;
};

describe('what one press stores', () => {
	it('takes the name off for the free model, which is what an unset one answers with', () => {
		expect(modelEdit(posted(FREE_MODEL.id))).toEqual({ AI_MODEL: null });
	});

	it('stores the id of a model billed to credits', () => {
		expect(modelEdit(posted(CLAUDE))).toEqual({ AI_MODEL: CLAUDE });
		expect(modelEdit(posted('openai/gpt-5-mini'))).toEqual({ AI_MODEL: 'openai/gpt-5-mini' });
	});

	it('stores nothing for an id off the list, or for no choice at all', () => {
		// composed from the list rather than from the body, so the door's 400 for an off-list id is
		// unreachable from this page rather than merely unlikely.
		expect(modelEdit(posted('openai/gpt-4'))).toBeNull();
		expect(modelEdit(posted())).toBeNull();
	});
});

describe('the choices offered', () => {
	it('is the list in its order, the free model marked free and the rest marked as spending credits', () => {
		expect(modelOptions()).toEqual([
			{ id: FREE_MODEL.id, label: 'Llama 3.3 70B on Workers AI', sub: 'Free', note: null },
			{ id: CLAUDE, label: 'Claude Sonnet 4.6', sub: null, note: 'Needs Cloudflare credits' },
			{ id: 'openai/gpt-5-mini', label: 'GPT-5 mini', sub: null, note: 'Needs Cloudflare credits' }
		]);
	});
});

describe('what the credits say beside the choice', () => {
	it('says nothing for a choice that spends none', () => {
		expect(creditsLine({ kind: 'not-asked' })).toBeNull();
	});

	it('states a balance the account holds, in dollars', () => {
		expect(creditsLine({ kind: 'held', balance: 24.1 })).toEqual({
			kind: 'held',
			figure: '$24.10'
		});
		expect(creditsLine({ kind: 'held', balance: 1250 })).toEqual({
			kind: 'held',
			figure: '$1,250.00'
		});
	});

	it('reports no credits at or under zero, with no figure, since a debt is not a balance to spend', () => {
		expect(creditsLine({ kind: 'missing', balance: 0 })).toEqual({ kind: 'missing' });
		expect(creditsLine({ kind: 'missing', balance: -3.2 })).toEqual({ kind: 'missing' });
	});

	it('carries the sentence the binary gave where the balance was not read, as given', () => {
		const detail =
			"This console's Cloudflare sign-in cannot read the account's credits. If they run out, the chat answers from the free model and says so.";
		expect(creditsLine({ kind: 'unknown', detail })).toEqual({ kind: 'unknown', detail });
	});
});
