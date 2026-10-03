import { AI_MODELS, DEFAULT_MODEL } from '@better-giving/operator/ai-models';
import { createElement } from 'react';
import { prerenderToNodeStream } from 'react-dom/static';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { DeployedVar, ModelCredits } from '../api/types';
import { MODEL_INTENT, modelEdit } from './ai-model';
import { ModelSection, type ModelSectionProps } from './ai-model-section';

// the model page's section as markup: the choices in the list's order and what each is marked, the
// one the deployment holds ticked, what the press posts for each, and the credits line held and not
// read. the readings themselves are ./ai-model.spec.ts's. ../../vite.config.ts pins `node` and there
// is no dom, so a press is never made here: what is held is that the form it submits carries each
// choice under the name and intent the route reads (`modelEdit`).

const CLAUDE = 'anthropic/claude-sonnet-4.6';
const UNREAD =
	"This console's Cloudflare sign-in cannot read the account's credits. If they run out, the chat answers from the default model and says so.";

const stored = (value: string): DeployedVar => ({ name: 'AI_MODEL', kind: 'value', value });

async function drawn(over: Partial<ModelSectionProps> = {}): Promise<string> {
	const props: ModelSectionProps = {
		model: stored(CLAUDE),
		credits: { kind: 'held', balance: 12.5 },
		withheld: [],
		written: null,
		freed: null,
		workerName: 'better-giving',
		accountName: 'Riverbank Trust',
		busy: false,
		pending: null,
		revalidating: false,
		...over
	};
	// `Form` reads the router it is drawn in.
	const router = createMemoryRouter([
		{ path: '/', Component: () => createElement(ModelSection, props) }
	]);
	const { prelude } = await prerenderToNodeStream(createElement(RouterProvider, { router }));
	let page = '';
	for await (const chunk of prelude) page += chunk;
	return page;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'" };
const text = (markup: string) =>
	markup
		.replace(/<[^>]*>/g, '')
		.replace(/&(amp|lt|gt|quot|#x27);/g, (whole, name: string) => ENTITIES[name] ?? whole);

type Choice = { attrs: Record<string, string>; label: string; mark: string };

/** each choice as its radio's attributes, the words naming it and the line under it. */
function choices(page: string): Choice[] {
	const row =
		/<label class="adm-check[^"]*"><input ([^>]*)\/><span class="adm-check__text"[^>]*>(.*?)<\/span><span class="adm-check__(?:sub|note)"[^>]*>(.*?)<\/span><\/label>/g;
	return [...page.matchAll(row)].map(([, attrs = '', label = '', mark = '']) => ({
		attrs: Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])),
		label: text(label),
		mark: text(mark)
	}));
}

const ticked = (page: string) =>
	choices(page)
		.filter((choice) => 'checked' in choice.attrs)
		.map((choice) => choice.attrs.value);

/** the value a statement on the section stands at, by its label. */
function stated(page: string, label: string): string | null {
	const found = new RegExp(
		`<span class="adm-stated__label">${label}</span><span class="adm-stated__value[^"]*">(.*?)</span>`
	).exec(page);
	return found?.[1] === undefined ? null : text(found[1]);
}

describe('the model section', () => {
	it('draws every model in the list’s order, the default one marked Default and the rest as needing credits', async () => {
		const drawnChoices = choices(await drawn()).map(({ label, mark }) => [label, mark]);
		expect(drawnChoices).toEqual(
			AI_MODELS.map((model) => [
				model.label,
				model.creditBilled ? 'Needs Cloudflare credits' : 'Default'
			])
		);
		expect(drawnChoices[0]).toEqual([DEFAULT_MODEL.label, 'Default']);
	});

	it('ticks the model the deployment holds', async () => {
		expect(ticked(await drawn({ model: stored(CLAUDE) }))).toEqual([CLAUDE]);
	});

	it('ticks the default model where nothing is stored', async () => {
		const absent: DeployedVar = { name: 'AI_MODEL', kind: 'absent' };
		expect(ticked(await drawn({ model: absent }))).toEqual([DEFAULT_MODEL.id]);
	});

	it('ticks nothing for a stored id off the list, and says which one it holds', async () => {
		const page = await drawn({ model: stored('openai/gpt-4') });
		expect(ticked(page)).toEqual([]);
		expect(text(page)).toContain(
			'This deployment holds openai/gpt-4, which this console doesn’t offer'
		);
	});

	it('posts each choice under the name and intent the press is read by', async () => {
		const page = await drawn();
		const press = /<button [^>]*>/.exec(page)?.[0] ?? '';
		expect(press).toContain('name="intent"');
		expect(press).toContain(`value="${MODEL_INTENT}"`);

		const edits = choices(page).map(({ attrs }) => {
			const body = new FormData();
			body.set(attrs.name ?? '', attrs.value ?? '');
			return modelEdit(body);
		});
		expect(edits).toEqual(
			AI_MODELS.map((model) => ({ AI_MODEL: model.id === DEFAULT_MODEL.id ? null : model.id }))
		);
	});

	it('states the balance the account holds under the choices', async () => {
		const credits: ModelCredits = { kind: 'held', balance: 12.5 };
		expect(stated(await drawn({ credits }), 'Cloudflare credits')).toBe('$12.50');
	});

	it('says the balance was not read, as the binary said it, and states no figure', async () => {
		const page = await drawn({ credits: { kind: 'unknown', detail: UNREAD } });
		expect(stated(page, 'Cloudflare credits')).toBeNull();
		expect(text(page)).toContain(UNREAD);
	});

	it('says what a read cloudflare turned down was about, rather than its bare words', async () => {
		const page = await drawn({ credits: { kind: 'unknown', detail: 'Authentication error' } });
		expect(text(page)).toContain('The credit balance could not be read: Authentication error.');
	});

	it('states a balance under half a cent as held', async () => {
		const credits: ModelCredits = { kind: 'held', balance: 0.003 };
		expect(stated(await drawn({ credits }), 'Cloudflare credits')).toBe('less than $0.01');
	});

	it('answers a save over a value held as a secret at the press, as a refusal', async () => {
		const page = await drawn({ written: { kind: 'withheld', names: ['AI_MODEL'] } });
		expect(text(page)).toContain(
			'This deployment holds AI_MODEL in a form nothing can read back, so this console can’t change it.'
		);
	});

	it('answers a save of the choice already stored at the press, in the status line', async () => {
		const page = await drawn({ written: { kind: 'unchanged' } });
		expect(page).toContain('<p role="status" class="adm-hint">That model was already saved.</p>');
	});

	it('holds the choices and the press closed while its own request is out', async () => {
		const page = await drawn({ busy: true, pending: MODEL_INTENT });
		expect(choices(page).every(({ attrs }) => 'disabled' in attrs)).toBe(true);
		expect(/<button [^>]*>/.exec(page)?.[0]).toContain('aria-busy="true"');
	});

	it('reopens the choices and the press on a refused answer while the page is read again', async () => {
		// the intent rides the re-read, which can change nothing a refusal left.
		const page = await drawn({
			busy: true,
			pending: MODEL_INTENT,
			revalidating: true,
			written: { kind: 'failed', detail: 'Internal error' }
		});
		expect(choices(page).some(({ attrs }) => 'disabled' in attrs)).toBe(false);
		expect(/<button [^>]*>/.exec(page)?.[0]).not.toContain('aria-busy');
	});
});
