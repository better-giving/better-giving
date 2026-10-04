import { readFileSync } from 'node:fs';
import { AI_MODELS, DEFAULT_MODEL } from '@better-giving/operator/ai-models';
import { describe, expect, it } from 'vitest';
import type { DeployedVar } from '../api/types';
import {
	CREDITS_UNREAD_ON_SIGN_IN,
	MODEL_FIELD,
	chosenModel,
	creditsLine,
	modelEdit,
	modelOptions,
	modelPhase,
	pressSays,
	settles
} from './ai-model';

// the model page as values: which choice the deployment holds, what one press stores, and what the
// account's credits say beside it. this package has no DOM pool (../../vite.config.ts), so the page
// is drawn out of these and they are what is held.

const CLAUDE = 'anthropic/claude-sonnet-4.6';

const stored = (value: string): DeployedVar => ({ name: 'AI_MODEL', kind: 'value', value });

describe('the choice the deployment holds', () => {
	it('is the default model where nothing is stored, which is what the deployment answers with', () => {
		expect(chosenModel({ name: 'AI_MODEL', kind: 'absent' })).toBe(DEFAULT_MODEL.id);
	});

	it('is the stored id where it is one on the list', () => {
		expect(chosenModel(stored(CLAUDE))).toBe(CLAUDE);
		expect(AI_MODELS.map((model) => chosenModel(stored(model.id)))).toEqual(
			AI_MODELS.map((model) => model.id)
		);
	});

	it('is no choice at all for an id off the list, rather than the default model it is not', () => {
		// the deployment refuses such an id rather than falling back, so ticking the default model over
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
	it('takes the name off for the default model, which is what an unset one answers with', () => {
		expect(modelEdit(posted(DEFAULT_MODEL.id))).toEqual({ AI_MODEL: null });
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

describe('what a press that stored nothing says at the press', () => {
	it('says the choice was already stored where the deployment held it, as a status', () => {
		expect(pressSays({ kind: 'unchanged' })).toEqual({
			tone: 'status',
			sentence: 'That model was already saved.'
		});
	});

	it('refuses a value held as a secret, saying why and where the way out is', () => {
		expect(pressSays({ kind: 'withheld', names: ['AI_MODEL'] })).toEqual({
			tone: 'refused',
			sentence:
				'This deployment holds AI_MODEL in a form nothing can read back, so this console can’t change it. Remove it above, then save a model again.'
		});
	});

	it('says nothing for a write that landed, which the button confirms, or one that failed, drawn as trouble', () => {
		expect(pressSays(null)).toBeNull();
		expect(pressSays({ kind: 'set' })).toBeNull();
		expect(pressSays({ kind: 'failed', detail: 'Internal error' })).toBeNull();
	});
});

describe('whether a save leaves the choice to be put back', () => {
	it('does for a write that landed and for a choice the deployment already held', () => {
		expect(settles({ kind: 'set' })).toBe(true);
		expect(settles({ kind: 'unchanged' })).toBe(true);
	});

	it('does not for a press that stored nothing, or before any press', () => {
		expect(settles(null)).toBe(false);
		expect(settles({ kind: 'withheld', names: ['AI_MODEL'] })).toBe(false);
		expect(settles({ kind: 'failed', detail: 'Internal error' })).toBe(false);
	});
});

describe('where the save stands, and whether the choices are closed with it', () => {
	const phase = (over: Partial<Parameters<typeof modelPhase>[0]>) =>
		modelPhase({
			own: true,
			revalidating: false,
			busy: true,
			settled: false,
			spent: false,
			...over
		});

	it('is underway and closed while its own request is out', () => {
		expect(phase({})).toEqual({ underway: true, closed: true });
	});

	it('reopens on the answer to a press that stored nothing, while the page is read again', () => {
		// the intent rides the re-read too, and that re-read can change nothing a refusal left.
		expect(phase({ revalidating: true })).toEqual({ underway: false, closed: false });
	});

	it('stays underway after a settled press until the reading it left behind puts the choice back', () => {
		expect(phase({ revalidating: true, settled: true })).toEqual({ underway: true, closed: true });
		expect(phase({ own: false, busy: false, settled: true })).toEqual({
			underway: true,
			closed: true
		});
		expect(phase({ own: false, busy: false, settled: true, spent: true })).toEqual({
			underway: false,
			closed: false
		});
	});

	it('is closed and not underway while another press on the page writes', () => {
		expect(phase({ own: false })).toEqual({ underway: false, closed: true });
	});
});

describe('the choices offered', () => {
	it('is the list in its order, the default model marked default and the credit-billed ones marked as spending credits', () => {
		expect(modelOptions()).toEqual([
			{ id: DEFAULT_MODEL.id, label: 'GPT-OSS 120B on Workers AI', sub: 'Default', note: null },
			{
				id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
				label: 'Llama 3.3 70B on Workers AI',
				sub: null,
				note: null
			},
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

	it('states a balance under half a cent as held, rather than as a figure of none', () => {
		// the binary reports anything above zero as held, and two decimals round it to $0.00.
		expect(creditsLine({ kind: 'held', balance: 0.003 })).toEqual({
			kind: 'held',
			figure: 'less than $0.01'
		});
		expect(creditsLine({ kind: 'held', balance: 0.005 })).toEqual({
			kind: 'held',
			figure: '$0.01'
		});
	});

	it('reports no credits at or under zero, with no figure, since a debt is not a balance to spend', () => {
		expect(creditsLine({ kind: 'missing', balance: 0 })).toEqual({ kind: 'missing' });
		expect(creditsLine({ kind: 'missing', balance: -3.2 })).toEqual({ kind: 'missing' });
	});

	it('carries the fixed sentence of a sign-in that never asks as given, since it already names the balance', () => {
		const detail =
			"This console's Cloudflare sign-in cannot read the account's credits. If they run out, the chat answers from the default model and says so.";
		expect(creditsLine({ kind: 'unknown', detail })).toEqual({ kind: 'unknown', detail });
	});

	it('knows the sign-in sentence by the words the binary sends it in', () => {
		// read off the go source by path, as ../never-deployed.spec.ts reads embed.go: a sentence that
		// drifted on either side would be framed as a read cloudflare turned down.
		const go = readFileSync('../console/internal/deployment/aimodel.go', 'utf8');
		const declared = go.match(/const CreditsUnreadOnSignIn = ((?:"[^"]*"(?:\s*\+\s*)?)+)/)?.[1];
		const sent = [...(declared ?? '').matchAll(/"([^"]*)"/g)].map((part) => part[1]).join('');
		expect(sent).toBe(CREDITS_UNREAD_ON_SIGN_IN);
	});

	it("frames cloudflare's own words about a read it turned down as a sentence about the balance", () => {
		// a token without AI Gateway Read is the common one, and cloudflare's answer names no subject:
		// drawn bare beside the save it reads as the save failing.
		expect(creditsLine({ kind: 'unknown', detail: 'Authentication error' })).toEqual({
			kind: 'unknown',
			detail: 'The credit balance could not be read: Authentication error.'
		});
	});

	it('ends a framed sentence once where the words already end in one', () => {
		expect(creditsLine({ kind: 'unknown', detail: 'Cloudflare took too long to answer.' })).toEqual(
			{
				kind: 'unknown',
				detail: 'The credit balance could not be read: Cloudflare took too long to answer.'
			}
		);
	});
});
